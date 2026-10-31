import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type LayoutRectangle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCameraPermissions } from 'expo-camera';
import { getLocales } from 'expo-localization';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SCANNER_COLORS as colors, useTheme, withAlpha, radius } from '../theme';
import { ScanFrame } from '../components/ScanFrame';
import { ResultSheet, type SaveInput } from '../components/ResultSheet';
import { useItems, type CategoryId, type Item } from '../items';
import { useCategories } from '../categories';
import { useSettings } from '../settings';
import { dayOrderForFormat } from '../preferences';
import { dayOrderForRegion } from '../scanner/dateParser';
import { ocrAvailability } from '../scanner/ocr';
import { guessCategory } from '../scanner/categoryGuess';
import { looksLikeTechnicalTitle } from '../scanner/productGuess';
import { lookupBarcode, type BarcodeOutcome } from '../scanner/productLookup';
import { fetchProductImage } from '../scanner/productImage';
import { useExpiryScanner, type Detection, type ScanHint } from '../scanner/useExpiryScanner';
import { PressScale } from '../components/Press';
import { OfflineNotice, useOffline } from '../components/OfflineNotice';
import { GLASS_FX } from '../components/HomeComponents';
import { useWebKeyboardInset } from '../components/WebKeyboardInset';
import type { Size } from '../scanner/cropMath';
import { ScannerCamera } from '../scanner/ScannerCamera';
import type { CameraErrorKind, FrameGeometry, ScannerCameraHandle } from '../scanner/ScannerCamera.types';

type Props = {
  onClose: () => void;
  onSaved: (item: Item) => void;
  // Category to preselect when the scanner is opened from a category.
  category?: CategoryId;
  // A detection handed in by a native WebView shell (docs/native-shell.md): the save
  // sheet opens straight away pre-filled and no camera is started.
  initialDetection?: Detection | null;
  // Open straight into manual entry ("Add manually"): the save form without
  // the camera - the user types the product and its date instead of scanning.
  initialManual?: boolean;
};

// The scan runs as ONE continuous process: the expiry date is read inside the
// frame on every pass, while product barcodes decoded from the same frames
// are looked up across the public barcode databases in the background — the
// recognized name and photo ride along when the sheet opens. Barcodes are
// OPTIONAL: a scan works with no barcode at all, an unrecognized one, a
// failed lookup or a manually typed product, because date reading never
// waits on any of them.
//   • Workflow A (product-first): aim at the barcode, the name appears in the
//     banner, then point at the expiry date.
//   • Workflow B (date-first): point straight at the expiry date; the product
//     name can be typed in the save sheet.
// Both end in the same confirmation sheet and item-saving flow.

// What the barcode lookup established about the product being scanned.
type ProductStatus = 'idle' | 'checking' | 'found' | 'not-found' | 'unreachable';

// The recognized product carried from the product stage into the sheet.
type ProductContext = {
  barcode: string;
  name: string;
  // The product's real photo: a data URI shrunk from the database's image.
  image?: string;
  // The category the lookup's words suggest (already keyword-scored).
  categoryHint: CategoryId | null;
  sourceLabel: string;
};

const HINTS: Record<ScanHint, { icon: keyof typeof Ionicons.glyphMap; text: string }> = {
  aim: { icon: 'scan-outline', text: 'Scanning...' },
  'text-found': { icon: 'text-outline', text: 'Processing scan...' },
  'hold-steady': { icon: 'hourglass-outline', text: 'Date found. Checking...' },
  'low-light': { icon: 'sunny-outline', text: 'Too dark. Try better light.' },
  closer: { icon: 'resize-outline', text: 'Move closer to the date.' },
  manufacture: { icon: 'alert-circle-outline', text: 'That is a production date. Find the expiry date.' },
  unclear: { icon: 'eye-outline', text: 'Date unclear. Try again or enter it manually.' },
  'ocr-error': { icon: 'refresh-outline', text: 'Hard to read. Hold the camera steady.' },
};

// A product name for the status banner: shortened to fit one line WITHOUT
// ellipsis dots, cutting at a word boundary (mirrors the shell scanner's
// pillName so both UIs read identically).
function pillName(name: string, max = 34): string {
  const n = name.trim();
  if (n.length <= max) return n;
  const cut = n.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > 14 ? cut.slice(0, sp) : cut).trim();
}

function frameSize(area: Size, hintSpace: number) {
  const width = Math.max(220, Math.min(area.width - 40, 560));
  // A taller frame: the product (barcode area and name) and its expiry date
  // both fit comfortably inside the brackets at once.
  let height = Math.min(Math.max(width * 0.52, 128), 280);
  const room = area.height - hintSpace - 24;
  if (height > room) height = Math.max(90, room);
  return { width, height };
}

export function ScannerScreen({ onClose, onSaved, category, initialDetection, initialManual }: Props) {
  const insets = useSafeAreaInsets();
  const t = useTheme();
  // The scanner's accents come from the ACTIVE theme's lime (the same accent
  // as the app's buttons) while its camera chrome stays dark, like every
  // camera UI.
  const lime = t.mint;
  const { defaultCategory, addItem } = useItems();
  const { ids: keptCategoryIds } = useCategories();
  const { settings } = useSettings();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<ScannerCameraHandle>(null);

  const [root, setRoot] = useState<Size>({ width: 0, height: 0 });
  const [area, setArea] = useState<LayoutRectangle | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<{ kind: CameraErrorKind; message: string } | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  // Whether this device can decode product barcodes at all (native: always;
  // web: yes, the app ships its own decoder).
  const [barcodesSupported, setBarcodesSupported] = useState(true);
  // Bumped by "Try again" so a camera that failed to start is mounted afresh.
  const [cameraKey, setCameraKey] = useState(0);
  const [torch, setTorch] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [manual, setManual] = useState(!!initialManual);
  const [askedPermission, setAskedPermission] = useState(false);
  // Seeded by a native shell scan; set back to null by "Scan again"/closing.
  const [seeded, setSeeded] = useState<Detection | null>(initialDetection ?? null);
  // The recognized product carried into the sheet.
  const [product, setProduct] = useState<ProductContext | null>(null);
  const [productStatus, setProductStatus] = useState<ProductStatus>('idle');
  // The phone keyboard's footprint on the web (0 everywhere else).
  const webKeyboard = useWebKeyboardInset();
  // Manual entry buttons appear only while the device is offline (online the
  // camera does the work); updates live while the scanner is open.
  const offline = useOffline();

  // Barcode lookups already answered this session (and their fetched images),
  // so re-aiming at the same product answers instantly and offline.
  const lookupCache = useRef(new Map<string, BarcodeOutcome>());
  const imageCache = useRef(new Map<string, string | null>());
  // Codes already identified (or answered) this session: a code held in the
  // frame re-fires every few seconds, and an already-answered code must not
  // re-run its lookup, re-render the banner or buzz again.
  const answered = useRef(new Set<string>());
  // The barcode the camera currently sees; a lookup that resolves after the
  // user re-aimed at a DIFFERENT code must never attach its product to it.
  const liveCode = useRef<string | null>(null);
  // Bumped by "Scan again": a lookup that resolves afterwards belongs to the
  // item the user just left behind, not the next one.
  const lookupGen = useRef(0);

  const landscape = root.width > root.height && root.height > 0;
  const granted = !!permission?.granted;
  const ocrReady = ocrAvailability === 'available';

  // Stop the camera and analysis in the background or when the phone locks.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const active = next === 'active';
      setAppActive(active);
      if (!active) setTorch(false);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  // Geometry for cropping, kept in a ref so the scan loop reads it without re-rendering.
  // The hint stack below the frame is taller now (the recognized-product banner
  // plus the live guidance), so the frame reserves more room for it.
  const hintSpace = 120;
  const frame = useMemo(() => (area ? frameSize(area, hintSpace) : null), [area]);
  const frameInArea = useMemo(() => {
    if (!area || !frame) return null;
    const x = (area.width - frame.width) / 2;
    const y = Math.max(12, (area.height - frame.height - hintSpace) / 2);
    return { x, y, width: frame.width, height: frame.height };
  }, [area, frame]);
  const geometry = useRef<FrameGeometry | null>(null);
  geometry.current =
    area && frameInArea && root.width ? { view: root, frame: { ...frameInArea, x: frameInArea.x + area.x, y: frameInArea.y + area.y } } : null;
  // The frame in ROOT coordinates — the camera fills the root, so this is also
  // the frame in the camera view's coordinates (what bounds-checked barcode
  // events are compared against).
  const frameForBarcodes = useMemo(
    () => (area && frameInArea ? { x: frameInArea.x + area.x, y: frameInArea.y + area.y, width: frameInArea.width, height: frameInArea.height } : null),
    [area, frameInArea],
  );

  // Ambiguous numeric dates (03/04/2026) are read in the order the user's
  // Date format setting names — the same format every screen displays —
  // falling back to the device region when the setting says nothing (YMD).
  // `assumedOrder` tells the save sheet the setting itself resolved the
  // reading, so it trusts the preselected date instead of asking which
  // day/month order it is.
  const region = useMemo(() => getLocales()[0]?.regionCode, []);
  const preferredOrder = dayOrderForFormat(settings.dateFormat, dayOrderForRegion(region));
  const assumedOrder = settings.dateFormat === 'DMY' || settings.dateFormat === 'MDY' ? settings.dateFormat : null;

  // A product barcode was read inside the frame (the web loop reads it from
  // the cropped frame; the native camera reports bounds-checked events). The
  // databases are asked IN THE BACKGROUND — the expiry-date loop keeps
  // running the whole time, so the scan never waits on a lookup — and the
  // recognized product (name, image, category) rides along into the sheet.
  const onBarcodeInFrame = useCallback(
    (code: string) => {
      // Already answered this session (hit, miss or unreachable): a code held
      // in the frame re-fires periodically, and re-running its lookup would
      // only churn the banner and repeat the haptic.
      if (answered.current.has(code)) return;
      answered.current.add(code);
      liveCode.current = code;
      const gen = ++lookupGen.current;
      // A subtle tick for a NEW barcode detection — once per code, never per
      // camera frame (the guard above plus the camera's own dedupe).
      Haptics.selectionAsync().catch(() => {});
      const cached = lookupCache.current.get(code);
      const identify = async (outcome: BarcodeOutcome) => {
        lookupCache.current.set(code, outcome);
        const stale = gen !== lookupGen.current || liveCode.current !== code; // scan again / re-aimed meanwhile
        if (outcome.kind === 'hit' && !looksLikeTechnicalTitle(outcome.hit.name)) {
          let image: string | undefined;
          const hitImage = outcome.hit.image;
          if (hitImage) {
            if (imageCache.current.has(code)) {
              const cachedImage = imageCache.current.get(code);
              if (cachedImage) image = cachedImage;
            } else {
              const fetched = await fetchProductImage(hitImage);
              imageCache.current.set(code, fetched);
              if (fetched) image = fetched;
            }
          }
          if (stale) return;
          setProduct({ barcode: code, name: outcome.hit.name, image, categoryHint: outcome.hit.categoryHint, sourceLabel: outcome.hit.sourceLabel });
          setProductStatus('found');
          // A successful identification earns its tactile confirmation.
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          return;
        }
        if (stale) return;
        setProduct(null);
        // A hit whose "name" is lookup furniture counts as no name at all.
        setProductStatus(outcome.kind === 'miss' || outcome.kind === 'hit' ? 'not-found' : 'unreachable');
      };
      setProductStatus('checking');
      if (cached) void identify(cached);
      else void lookupBarcode(code).then(identify);
    },
    [],
  );

  const { state, reset } = useExpiryScanner({
    camera,
    geometry,
    // No analysis while the user types the item by hand; otherwise ONE loop
    // reads the expiry date on every pass while barcodes ride along in the
    // same passes (never blocking the date). The hook stops itself once a
    // date is confirmed.
    enabled: granted && cameraReady && appActive && !manual && !cameraError && !seeded && ocrReady,
    readBarcodes: barcodesSupported && cameraReady && !manual && !seeded && !cameraError && appActive,
    onBarcode: onBarcodeInFrame,
    preferredOrder,
  });
  const detection: Detection | null = seeded ?? (state.status === 'detected' ? state.detection : null);
  const detected = detection !== null;
  const sheetOpen = detected || manual;
  // Manual entry that began as manual (the "Add manually" routes): the camera
  // was never mounted this visit, so the sheet's secondary action closes the
  // screen instead of offering "Scan again".
  const manualOnly = manual && !!initialManual && !detected;
  // Auto-category: a barcode hit carries the database's keyword-scored
  // category; otherwise the words around the date usually name the product, so
  // the save sheet opens with the folder the item most likely belongs in. A
  // guess (or default) that names a category the user removed is ignored: they
  // chose not to track that folder, so the first category they keep wins.
  const guessedRaw = useMemo(() => {
    if (!detection) return null;
    const fromProduct = product?.categoryHint;
    if (fromProduct && keptCategoryIds.includes(fromProduct)) return fromProduct;
    return guessCategory(`${product?.name ?? ''} ${detection.text}`);
  }, [detection, product, keptCategoryIds]);
  const guessed = guessedRaw && keptCategoryIds.includes(guessedRaw) ? guessedRaw : null;
  const fallbackCategory = keptCategoryIds.includes(defaultCategory) ? defaultCategory : keptCategoryIds[0] ?? defaultCategory;

  useEffect(() => {
    if (detected) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [detected]);

  const onCameraReady = useCallback(({ torch: hasTorch, barcodes }: { torch: boolean; barcodes: boolean }) => {
    setCameraReady(true);
    setTorchSupported(hasTorch);
    setBarcodesSupported(barcodes);
  }, []);
  const onCameraError = useCallback((kind: CameraErrorKind, message: string) => {
    setCameraReady(false);
    setCameraError({ kind, message });
  }, []);
  const retryCamera = useCallback(() => {
    setCameraError(null);
    setCameraReady(false);
    setCameraKey((k) => k + 1);
  }, []);

  const onAdd = useCallback(
    async ({ name, category: cat, date, image }: SaveInput) => {
      const item = await addItem({
        name,
        category: cat,
        expiresOn: date.iso,
        datePrecision: date.precision,
        source: manual ? 'manual' : 'scan',
        ...(manual ? {} : product?.barcode ? { barcode: product.barcode } : {}),
        ...(manual ? {} : image ? { image } : {}),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Leave the "Added" state on screen for a moment before returning home.
      setTimeout(() => onSaved(item), 650);
    },
    [addItem, manual, onSaved, product],
  );

  // "Scan again" starts a FRESH scan: any lookup still resolving for the
  // previous item is retired, and the next barcode is free to fire again.
  const scanAgain = useCallback(() => {
    setManual(false);
    setSeeded(null);
    setProduct(null);
    setProductStatus('idle');
    lookupGen.current += 1;
    answered.current.clear();
    liveCode.current = null;
    reset();
  }, [reset]);

  // Inside the native WebView shell (docs/native-shell.md) the WebView camera
  // is blocked and a seeded sheet has no camera behind it either, so "Scan
  // again" hands control back to the shell's native scanner instead of trying
  // to start an impossible in-WebView camera session.
  const inShell = Platform.OS === 'web' && typeof window !== 'undefined' && !!(window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  const scanAgainInShell = useCallback(() => {
    const shell = (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView;
    if (shell?.postMessage) {
      try {
        shell.postMessage(JSON.stringify({ type: 'scan' }));
      } catch {
        // The shell went away; closing simply returns to the app.
      }
    }
    onClose();
  }, [onClose]);

  // Manual entry (offline escape hatch, or the permission/camera fallback
  // notices): opens the same save form the detected flow uses. 'product'
  // focuses the empty name field; 'date' opens with the date editor expanded.
  const openManual = useCallback((mode: 'date' | 'product') => {
    setManualMode(mode);
    setManual(true);
  }, []);
  const [manualMode, setManualMode] = useState<'date' | 'product' | null>(null);

  const onAreaLayout = (e: LayoutChangeEvent) => {
    const l = e.nativeEvent.layout;
    setArea((prev) => (prev && prev.x === l.x && prev.y === l.y && prev.width === l.width && prev.height === l.height ? prev : l));
  };

  const torchAvailable = torchSupported && granted && cameraReady && !cameraError;

  const header = (
    <View style={[s.header, { paddingTop: insets.top + 6, paddingLeft: insets.left + 16, paddingRight: (landscape && sheetOpen ? 0 : insets.right) + 16 }]}>
      <View style={s.headerRow}>
        <PressScale onPress={onClose} hitSlop={8} scaleTo={0.94} style={[s.roundBtn, GLASS_FX as ViewStyle]} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </PressScale>
        <Text style={s.title} accessibilityRole="header">
          {manual ? 'Add item' : 'Live Scan'}
        </Text>
        <PressScale
          onPress={() => setTorch((v) => !v)}
          disabled={!torchAvailable}
          hitSlop={8}
          scaleTo={0.94}
          style={[s.roundBtn, GLASS_FX as ViewStyle, torch && { backgroundColor: lime }, !torchAvailable && s.disabled]}
          accessibilityRole="switch"
          accessibilityLabel={torchAvailable ? 'Flashlight' : 'Flashlight unavailable'}
          accessibilityState={{ checked: torch, disabled: !torchAvailable }}
        >
          <Ionicons name={torch ? 'flash' : 'flash-outline'} size={21} color={torch ? t.scanInk : colors.text} />
        </PressScale>
      </View>
      <Text style={s.instruction}>
        {manual ? 'Type the product details.' : 'Point at an expiry date or barcode.'}
      </Text>
    </View>
  );

  let body: ReactNode;
  if (seeded) {
    // A native shell already read the label: no camera prompts, just the save sheet.
    body = null;
  } else if (manual) {
    // Manual entry: no camera, no frame - just the calm dark stage under the form.
    body = null;
  } else if (!permission) {
    body = null;
  } else if (!granted) {
    body = (
      <Notice
        icon={askedPermission && permission.status === 'denied' ? 'lock-closed-outline' : 'camera-outline'}
        title={askedPermission && permission.status === 'denied' ? 'Camera access blocked' : 'Allow camera access'}
        text={
          askedPermission && permission.status === 'denied'
            ? Platform.OS === 'web'
              ? 'Your browser blocked the camera for this site. Allow it in the browser’s site settings (in Safari: the aA button → Website Settings → Camera), then try again.'
              : 'Prexpire needs the camera to read expiry dates. Allow it in Settings, then come back.'
            : 'Prexpire reads expiry dates through your camera. Images are processed on this device and never uploaded.'
        }
        action={permission.canAskAgain || Platform.OS === 'web' ? (askedPermission ? 'Try again' : 'Allow camera') : 'Open Settings'}
        onAction={() => {
          setAskedPermission(true);
          if (permission.canAskAgain || Platform.OS === 'web') requestPermission();
          else Linking.openSettings();
        }}
        secondary="Enter date manually"
        onSecondary={() => openManual('date')}
        hidden={manual}
      />
    );
  } else if (cameraError) {
    body = (
      <Notice
        icon={cameraError.kind === 'ocr' ? 'document-text-outline' : cameraError.kind === 'denied' ? 'lock-closed-outline' : 'videocam-off-outline'}
        title={cameraError.kind === 'ocr' ? 'Text reader unavailable' : cameraError.kind === 'denied' ? 'Camera access blocked' : 'Camera unavailable'}
        text={cameraError.message}
        action="Try again"
        onAction={retryCamera}
        secondary="Enter date manually"
        onSecondary={() => openManual('date')}
        hidden={manual}
      />
    );
  } else if (frame && frameInArea) {
    const f = frameInArea;
    const hint = state.status === 'scanning' ? HINTS[state.hint] : null;
    // The live hint state (null once detected), kept separate so the JSX
    // below narrows cleanly.
    const liveHint = state.status === 'scanning' ? state.hint : null;
    // While a product banner is up, the generic "Scanning..." pill hides (the
    // banner already guides); every meaningful hint still shows.
    const bannerUp = !!product || productStatus === 'not-found' || productStatus === 'unreachable' || productStatus === 'checking';
    const showLiveHint = bannerUp ? liveHint !== 'aim' : true;
    body = (
      <>
        {/* Darken everything except the frame so the scanned content stands out. */}
        <View pointerEvents="none" style={[s.dim, { left: 0, right: 0, top: 0, height: f.y }]} />
        <View pointerEvents="none" style={[s.dim, { left: 0, right: 0, top: f.y + f.height, bottom: 0 }]} />
        <View pointerEvents="none" style={[s.dim, { left: 0, width: f.x, top: f.y, height: f.height }]} />
        <View pointerEvents="none" style={[s.dim, { right: 0, width: f.x, top: f.y, height: f.height }]} />
        <View pointerEvents="none" style={{ position: 'absolute', left: f.x, top: f.y }}>
          <ScanFrame width={f.width} height={f.height} scanning={cameraReady && !sheetOpen && appActive} success={detected} />
        </View>
        <View style={[s.hintWrap, { top: f.y + f.height + 14 }]}>
          {detected ? (
            <View style={[s.hint, { borderColor: withAlpha(lime, 0.55) }]} accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle" size={18} color={lime} />
              <Text style={[s.hintText, { color: lime }]}>Expiry date confirmed.</Text>
            </View>
          ) : !cameraReady ? (
            <View style={s.hint} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={lime} />
              <Text style={s.hintText}>Starting the scanner...</Text>
            </View>
          ) : !ocrReady ? (
            manual ? null : (
              <View style={s.unavailable}>
                <Text style={s.unavailableText}>
                  Reading dates needs the Prexpire development build. Expo Go can show the camera but cannot read text.
                </Text>
                <PressScale onPress={() => openManual('date')} scaleTo={0.97} style={s.linkBtn} accessibilityRole="button">
                  <Text style={[s.linkText, { color: lime }]}>Enter date manually</Text>
                </PressScale>
              </View>
            )
          ) : (
            <>
              {productStatus === 'checking' && (
                <View style={s.hint} accessibilityLiveRegion="polite">
                  <ActivityIndicator size="small" color={lime} />
                  <Text style={s.hintText}>Checking the product...</Text>
                </View>
              )}
              {product && productStatus === 'found' && (
                <View style={[s.hint, { borderColor: withAlpha(lime, 0.55) }]} accessibilityLiveRegion="polite">
                  <Ionicons name="checkmark-circle" size={18} color={lime} />
                  <View style={s.hintTextCol}>
                    <Text style={[s.hintText, { color: lime, fontWeight: '700' }]} numberOfLines={1}>
                      Product found: {pillName(product.name)}
                    </Text>
                    <Text style={s.hintSub}>Now scan the expiry date.</Text>
                  </View>
                </View>
              )}
              {productStatus === 'not-found' && (
                <View style={s.hint} accessibilityLiveRegion="polite">
                  <Ionicons name="help-circle-outline" size={18} color={colors.amberText} />
                  <Text style={s.hintText} numberOfLines={2}>
                    No product match for that barcode. Point at the expiry date.
                  </Text>
                </View>
              )}
              {productStatus === 'unreachable' && (
                <View style={s.hint} accessibilityLiveRegion="polite">
                  <Ionicons name="cloud-offline-outline" size={18} color={colors.amberText} />
                  <Text style={s.hintText} numberOfLines={2}>
                    Couldn't check the product online. Point at the expiry date.
                  </Text>
                </View>
              )}
              {showLiveHint &&
                hint &&
                (liveHint === 'hold-steady' ? (
                  // Text was found and is being read: a small spinner, the camera stays visible.
                  <View style={s.hint} accessibilityLiveRegion="polite">
                    <ActivityIndicator size="small" color={lime} />
                    <Text style={s.hintText}>{hint.text}</Text>
                  </View>
                ) : (
                  <View style={s.hint} accessibilityLiveRegion="polite">
                    <Ionicons name={hint.icon} size={17} color={liveHint !== 'aim' ? colors.amberText : lime} />
                    <Text style={s.hintText} numberOfLines={2}>
                      {hint.text}
                    </Text>
                  </View>
                ))}
            </>
          )}
          {/* Manual entry, OFFLINE ONLY: online the camera does the work and
              the interface stays clean. Two compact actions — Enter date and
              Enter product — that appear and disappear live with
              connectivity, both leading to the same save form as a scan. */}
          {offline && !detected && !manual && cameraReady && !cameraError && ocrReady && (
            <View style={s.manualRow}>
              <PressScale
                onPress={() => openManual('date')}
                scaleTo={0.94}
                style={s.manualBtn}
                accessibilityRole="button"
                accessibilityLabel="Enter the expiry date manually"
              >
                <Ionicons name="calendar-outline" size={15} color={lime} />
                <Text style={s.manualBtnText}>Enter date</Text>
              </PressScale>
              <PressScale
                onPress={() => openManual('product')}
                scaleTo={0.94}
                style={s.manualBtn}
                accessibilityRole="button"
                accessibilityLabel="Enter the product name manually"
              >
                <Ionicons name="create-outline" size={15} color={lime} />
                <Text style={s.manualBtnText}>Enter product</Text>
              </PressScale>
            </View>
          )}
        </View>
      </>
    );
  }

  const sheet = sheetOpen ? (
    <ResultSheet
      // A new detection gets a fresh sheet; "Scan again" then a new read starts clean.
      key={detected ? `${detection.key}:${product?.barcode ?? 'none'}` : 'manual'}
      detection={detected ? detection : null}
      // The recognized product flows into the form: its name is pre-filled and
      // its retrieved image rides along into the saved item.
      initialName={detected ? (product?.name ?? '') : ''}
      productImage={detected ? (product?.image ?? null) : null}
      // "Enter product" (offline) opens the same manual form with the cursor
      // straight in the empty name field.
      focusName={manual && manualMode === 'product'}
      initialCategory={category ?? guessed ?? fallbackCategory}
      categoryGuessed={!category && !!guessed}
      assumedOrder={assumedOrder}
      layout={landscape ? 'side' : 'bottom'}
      // Portrait is a FULL-SCREEN form now: everything below the header bar,
      // not the old half-height sheet (landscape keeps its side layout).
      full={!landscape}
      maxHeight={landscape ? root.height : Math.max(420, Math.round(root.height - insets.top - 104))}
      bottomInset={insets.bottom}
      // Entered straight from an "Add manually" entry point: the only way out
      // is Cancel (there is no camera session to return to). Switched over
      // from a live scan: "Scan again" brings the camera back - inside the
      // native shell, it reopens the shell's own native scanner.
      secondaryLabel={manualOnly ? 'Cancel' : seeded && inShell ? 'Scan again' : ocrReady && granted && !cameraError ? 'Scan again' : 'Cancel'}
      onAdd={onAdd}
      onSecondary={manualOnly ? onClose : seeded && inShell ? scanAgainInShell : ocrReady && granted && !cameraError ? scanAgain : onClose}
    />
  ) : null;

  return (
    <View style={s.root} onLayout={(e) => setRoot({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {/* The camera only mounts for an actual scanning session - never for
          manual entry, where it would idle behind the form. While the product
          stage is live the camera's own barcode scanner runs and reports only
          codes whose bounds sit inside the frame. */}
      {granted && !cameraError && !seeded && !manual && (
        <ScannerCamera
          key={cameraKey}
          ref={camera}
          active={appActive && !manual}
          torch={torch && appActive}
          // The camera's own barcode scanner runs the whole session (it is
          // OPTIONAL enrichment for the date scan) and reports only codes
          // whose bounds sit inside the frame. It pauses with the sheet up.
          scanBarcodes={!detected && cameraReady && appActive && !cameraError && barcodesSupported}
          barcodeFrame={frameForBarcodes}
          onBarcodeInFrame={onBarcodeInFrame}
          onReady={onCameraReady}
          onError={onCameraError}
        />
      )}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[StyleSheet.absoluteFill, landscape && s.row, webKeyboard > 0 && { paddingBottom: webKeyboard }]}
      >
        <View style={s.column}>
          {header}
          {/* The offline note sits under the header on the scanner screens
              (the only place the network matters): while the device is offline
              it reassures that saved items and manual entry still work. */}
          <OfflineNotice />
          <View style={[s.area, { marginLeft: insets.left, marginRight: landscape && sheetOpen ? 0 : insets.right }]} onLayout={onAreaLayout}>
            {body}
          </View>
        </View>
        {sheet && (
          <View style={landscape ? [s.side, { paddingRight: insets.right, width: Math.min(400, Math.max(320, root.width * 0.42)) }] : s.bottom}>{sheet}</View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

type NoticeProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
  secondary: string;
  onSecondary: () => void;
  hidden: boolean;
};

function Notice({ icon, title, text, action, onAction, secondary, onSecondary, hidden }: NoticeProps) {
  const t = useTheme();
  if (hidden) return null;
  return (
    <View style={s.noticeWrap}>
      <View style={s.notice}>
        <View style={s.noticeIcon}>
          <Ionicons name={icon} size={28} color={t.mint} />
        </View>
        <Text style={s.noticeTitle}>{title}</Text>
        <Text style={s.noticeText}>{text}</Text>
        {action && onAction && (
          <PressScale onPress={onAction} scaleTo={0.98} style={[s.noticeBtn, { backgroundColor: t.mint }]} accessibilityRole="button">
            <Text style={[s.noticeBtnText, { color: t.scanInk }]}>{action}</Text>
          </PressScale>
        )}
        <PressScale onPress={onSecondary} scaleTo={0.97} style={s.linkBtn} accessibilityRole="button">
          <Text style={[s.linkText, { color: t.mint }]}>{secondary}</Text>
        </PressScale>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  row: { flexDirection: 'row' },
  column: { flex: 1 },
  side: { justifyContent: 'flex-end' },
  // On tablets in portrait the sheet stays phone-width instead of stretching edge to edge.
  bottom: { width: '100%', maxWidth: 600, alignSelf: 'center' },
  header: { backgroundColor: 'rgba(5,12,14,0.82)', paddingBottom: 12, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 52 },
  // The scanner's glass circles: the same 46pt + hairline treatment the app's
  // other screens now use for their header buttons (GlassIconButton), pinned
  // to the scanner's fixed dark palette. Torch "on" fills with the theme green.
  roundBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.35 },
  title: { color: colors.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  instruction: { color: colors.textMuted, fontSize: 14.5, textAlign: 'center', marginTop: 6 },
  area: { flex: 1, overflow: 'hidden' },
  dim: { position: 'absolute', backgroundColor: 'rgba(2,5,7,0.5)' },
  hintWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  // The offline manual actions: compact dark pills under the live guidance,
  // the same height family as the hint pill but quieter.
  manualRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap', maxWidth: 460 },
  manualBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(5,12,14,0.62)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  manualBtnText: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    minHeight: 40,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(5,12,14,0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    maxWidth: 460,
  },
  // The recognized-product banner stacks its two lines inside the pill.
  hintTextCol: { flexShrink: 1, gap: 1 },
  hintText: { color: colors.text, fontSize: 14, fontWeight: '500', flexShrink: 1 },
  hintSub: { color: colors.textMuted, fontSize: 12.5, flexShrink: 1 },
  unavailable: { alignItems: 'center', maxWidth: 420, backgroundColor: 'rgba(5,12,14,0.85)', borderRadius: 16, padding: 14, gap: 6 },
  unavailableText: { color: colors.text, fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
  linkBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  linkText: { fontSize: 15, fontWeight: '600' },
  noticeWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  notice: { maxWidth: 420, width: '100%', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.surfaceBorder, borderWidth: 1, borderRadius: 20, padding: 22 },
  noticeIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#093426', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  noticeTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  noticeText: { color: colors.textMuted, fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginBottom: 16 },
  noticeBtn: { height: 50, alignSelf: 'stretch', borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  noticeBtnText: { fontSize: 16, fontWeight: '700' },
});
