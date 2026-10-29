import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { requireOptionalNativeModule } from 'expo';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { daysUntil, formatDate, type ConfirmReason, type Interpretation } from '../scanner/dateParser';
import { guessCategory } from '../scanner/categoryGuess';
import { useNativeScan, type Detection } from '../scanner/useNativeScan';

type TextExtractorModule = {
  isSupported: boolean;
  extractTextFromImage: (uri: string) => Promise<string[]>;
};

// On-device text recognition: Apple Vision on iOS, Google ML Kit on Android.
// Native code — present only in a development/release build. Expo Go does not
// include it; the notice below says so instead of pretending to scan.
const TextExtractor = Platform.OS !== 'web' ? requireOptionalNativeModule<TextExtractorModule>('ExpoTextExtractor') : null;

// The scanner keeps the app's dark palette in both themes, like every camera UI
// (mirrors SCANNER_COLORS in the app's src/theme.tsx).
const C = {
  bg: '#050D10',
  sheet: '#081316',
  surface: '#0B161A',
  border: '#1A2A2E',
  text: '#F2F6F7',
  muted: '#9AA7AD',
  mint: '#2EE8B6',
  scan: '#41F8C5',
  ink: '#04241B',
  amberText: '#F5B83D',
  red: '#FF3B4E',
  iconTile: '#1C2C35',
};

const HAS_GLASS = isLiquidGlassAvailable();

// The category list as the website reports it over the bridge (id, display
// name, and for custom folders the Ionicons glyph chosen in Settings). Until
// the first report arrives the five built-ins stand in.
export type ShellCategory = { id: string; name: string; icon?: keyof typeof Ionicons.glyphMap };

const BUILTIN_CATEGORIES: ShellCategory[] = [
  { id: 'food', name: 'Food', icon: 'nutrition' },
  { id: 'medicine', name: 'Medicine', icon: 'medkit' },
  { id: 'household', name: 'Household', icon: 'home' },
  { id: 'skincare', name: 'Skincare', icon: 'water' },
  { id: 'pantry', name: 'Pantry', icon: 'archive' },
];

const HINTS: Record<string, { icon: keyof typeof Ionicons.glyphMap; text: string }> = {
  aim: { icon: 'scan-outline', text: 'Keep the date inside the frame' },
  'text-found': { icon: 'text-outline', text: 'Text found. Looking for the expiry date…' },
  'hold-steady': { icon: 'hourglass-outline', text: 'Reading the date… hold steady' },
  'low-light': { icon: 'sunny-outline', text: 'No text yet — try better lighting' },
  closer: { icon: 'resize-outline', text: 'Move closer so the date fills the frame' },
  manufacture: { icon: 'alert-circle-outline', text: 'That looks like a production date. Look for EXP or BEST BEFORE' },
  unclear: { icon: 'eye-outline', text: "Couldn't read that date clearly. Hold steady" },
  'ocr-error': { icon: 'refresh-outline', text: 'Having trouble reading. Hold the camera steady' },
};

const REASON_TEXT: Partial<Record<ConfirmReason, string>> = {
  'no-label': 'No EXP or BEST BEFORE label was found next to this date.',
  'multiple-dates': 'More than one date was found, so the latest one was picked.',
  'month-only': 'Only a month is printed. The item will expire at the end of that month.',
  'in-past': 'This date has already passed.',
  'sell-by': 'This is a sell-by date, which can be earlier than the real expiry date.',
  'no-year': 'No year is printed, so the next time this date comes round was used. Check the year.',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Expires in 5 days", "Expired 2 days ago" (port of the app's items.tsx helper).
function expiryPhrase(iso: string, today = new Date()) {
  const days = daysUntil(iso, today);
  if (days < -1) return `Expired ${-days} days ago`;
  if (days === -1) return 'Expired yesterday';
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `Expires in ${days} days`;
}

function titleize(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// The OS reduce-motion setting collapses every animation duration to zero
// (the native counterpart of the app's Animations setting).
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => {
        if (active) setReduced(!!v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduced(!!v));
    return () => {
      active = false;
      sub?.remove();
    };
  }, []);
  return reduced;
}

// The shell's own press feedback (port of the app's PressScale): press-in
// ~130 ms, soft ~200 ms return, a same-element double-tap lock, and no motion
// at all when the OS asks for reduced motion.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_IN_MS = 130;
const PRESS_OUT_MS = 200;
const DOUBLE_TAP_MS = 300;

function PressScale({
  children,
  scaleTo = 0.98,
  style,
  onPress,
  ...rest
}: {
  children?: ReactNode;
  scaleTo?: number;
  style?: object | Array<object | undefined | false>;
  onPress?: () => void;
} & Omit<React.ComponentProps<typeof Pressable>, 'style' | 'onPress' | 'children'>) {
  const reduced = useReducedMotion();
  const press = useRef(new Animated.Value(0)).current;
  const lastFire = useRef(0);
  const down = useCallback(() => {
    Animated.timing(press, { toValue: 1, duration: reduced ? 0 : PRESS_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [press, reduced]);
  const up = useCallback(() => {
    Animated.timing(press, { toValue: 0, duration: reduced ? 0 : PRESS_OUT_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [press, reduced]);
  const handle = useCallback(() => {
    const now = Date.now();
    if (now - lastFire.current < DOUBLE_TAP_MS) return;
    lastFire.current = now;
    onPress?.();
  }, [onPress]);
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] });
  // Scale only — no inline opacity, so a static disabled opacity (like the
  // Add item button's 0.45) is never overridden while the button reads enabled.
  return (
    <AnimatedPressable {...rest} onPress={handle} onPressIn={down} onPressOut={up} style={[style as object, { transform: [{ scale }] }]}>
      {children}
    </AnimatedPressable>
  );
}

// One circular liquid-glass control (back, flashlight): the same glass, size
// and hairline as the tab bar's chrome. Where real liquid glass is unavailable
// (Android / iOS < 26) GlassView renders as a plain View, so a smoked
// translucent fill stands in.
function GlassCircle({
  onPress,
  label,
  children,
  on,
  disabled,
}: {
  onPress: () => void;
  label: string;
  children: ReactNode;
  on?: boolean;
  disabled?: boolean;
}) {
  return (
    <GlassView glassEffectStyle="regular" tintColor="rgba(11,22,26,0.35)" style={[s.glass, !HAS_GLASS && s.glassFallback, on && s.glassOn, disabled && s.glassDisabled]}>
      <PressScale onPress={onPress} scaleTo={0.94} style={s.glassBtn} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}>
        {children}
      </PressScale>
    </GlassView>
  );
}

// The scanning guide: four mint corner brackets with a soft sweep line while
// passes run, and a solid soft outline once a date is confirmed (port of the
// app's ScanFrame). pointerEvents none - it never blocks camera gestures.
function ScanFrame({ width, height, scanning, success, reduced }: { width: number; height: number; scanning: boolean; success: boolean; reduced: boolean }) {
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      sweep.stopAnimation();
      sweep.setValue(0.5);
      return;
    }
    if (!scanning) {
      sweep.stopAnimation();
      sweep.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scanning, sweep, reduced]);

  const color = success ? C.mint : C.scan;
  const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: [10, Math.max(10, height - 12)] });
  return (
    <View
      style={{ width, height }}
      pointerEvents="none"
      accessible
      accessibilityRole="image"
      accessibilityLabel={success ? 'Date detected' : scanning ? 'Scanning for an expiry date' : 'Scanning frame'}
    >
      {success && <View style={[s.frameOutline]} />}
      {scanning && !reduced && <Animated.View style={[s.sweep, { transform: [{ translateY }] }]} />}
      <View style={[s.corner, { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 14, borderColor: color }]} />
      <View style={[s.corner, { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 14, borderColor: color }]} />
      <View style={[s.corner, { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 14, borderColor: color }]} />
      <View style={[s.corner, { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 14, borderColor: color }]} />
    </View>
  );
}

type SaveOutcome = { ok: boolean; error?: string };

type SaveRequest = { name: string; category?: string; barcode?: string; dateIso: string; datePrecision: 'day' | 'month' };

type Props = {
  onClose: () => void;
  // Legacy hand-off: hand the OCR lines to the website, which opens its own
  // save sheet pre-filled (the bridge's prexpire:native-scan event).
  onScanned: (lines: string[]) => void;
  // "Enter date manually": close the scanner and open the website's manual form.
  onManualEntry: () => void;
  // One-tap save through the website's real persistence pipeline (bridge:
  // prexpire:save / save-result). Resolves { ok: false } on failure so the
  // panel can keep the user's edits and offer the hand-off instead.
  onSaveAttempt: (item: SaveRequest) => Promise<SaveOutcome>;
  // The website's live category list (reported over the bridge), or null until
  // the first report arrives.
  categories: ShellCategory[] | null;
};

// The best product evidence the scanner holds at any moment. Offline-first:
// the LOCAL barcode catalog (records learned from earlier scans and saves on
// this device) is authoritative; a fresh online lookup only enriches it, and
// the label-derived name is an explicitly marked best-effort guess.
type ProductEvidence = {
  name: string;
  image?: string;
  categoryHint: string | null;
  barcode?: string;
  // 'catalog' — matched by barcode against the on-device catalog (offline).
  // 'online'  — identified by barcode via the optional Open Food Facts lookup.
  // 'label'   — best-effort guess from the label's printed words (uncertain).
  source: 'catalog' | 'online' | 'label';
};

// The on-device barcode catalog: records are written when the user saves a
// scanned product (name + barcode + category) and when an optional online
// lookup lands, so later scans identify the same product with NO network.
// AsyncStorage works offline; the map is trimmed to the newest records.
type CatalogRecord = { code: string; name: string; image?: string; categoryHint?: string | null; at: number };
const CATALOG_KEY = 'prexpire.shellBarcodeCatalog.v1';
const CATALOG_MAX = 300;

// Scan photos are one-off cache files: always delete them, best-effort.
// SDK 54+ ships the new File class (the classic deleteAsync there is a
// throwing deprecation stub); older SDKs keep the classic promise API —
// and on SDKs where neither exists the call is simply skipped.
const deleteQuietly = (uri: string) => {
  try {
    const FS = FileSystem as unknown as {
      File?: new (uri: string) => { exists: boolean; delete: () => void };
      deleteAsync?: (uri: string, opts?: { idempotent?: boolean }) => Promise<void>;
    };
    if (typeof FS.File === 'function') {
      const f = new FS.File(uri);
      if (f.exists) f.delete();
      return;
    }
    const p = FS.deleteAsync?.(uri, { idempotent: true });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {
    // Cache cleanup is best-effort.
  }
};

export function NativeScanner({ onClose, onScanned, onManualEntry, onSaveAttempt, categories }: Props) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [root, setRoot] = useState({ width: 0, height: 0 });
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [panel, setPanel] = useState<Detection | null>(null);
  const [panelLines, setPanelLines] = useState<string[]>([]);
  const [barcodeProduct, setBarcodeProduct] = useState<ProductEvidence | null>(null);
  // The last decoded barcode, displayed in the panel even when no record for
  // it exists (an unknown barcode is still useful evidence).
  const [barcode, setBarcode] = useState<string | null>(null);
  // Bumped by remounting the camera after a start failure ("Try again").
  const [camKey, setCamKey] = useState(0);

  const catList = categories ?? BUILTIN_CATEGORIES;
  const knownCategory = useCallback((id: string | null) => (id ? catList.some((c) => c.id === id) : false), [catList]);

  const granted = !!permission?.granted;
  const ocrSupported = !!TextExtractor?.isSupported;
  const scanLive = granted && cameraReady && appActive && ocrSupported && !cameraError && !panel;

  // Stop the torch and the scan loop in the background / on lock.
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
      // With the result panel up, back dismisses the panel (back to live
      // scanning); otherwise it closes the scanner, as before.
      if (panel) {
        scanAgainRef.current();
        return true;
      }
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose, panel]);

  // One pass: photo → downscale → on-device OCR → lines (null on failure).
  // The photo and its resized copy are deleted afterwards, so a scan session
  // never leaves a growing pile of full-resolution cache files behind.
  const capture = useCallback(async (): Promise<string[] | null> => {
    const c = cam.current;
    if (!c || !TextExtractor?.isSupported) return null;
    let original: string | null = null;
    let resized: string | null = null;
    try {
      const photo = await c.takePictureAsync({ quality: 0.7, exif: false, shutterSound: false });
      if (!photo?.uri) return null;
      original = photo.uri;
      // Downscale before OCR (full photos are many megapixels); the original
      // aspect is kept — the parser reads the whole label while the frame
      // guides the aim. Best-effort: on failure the full photo is used.
      let ocrUri = original;
      try {
        if (photo.width && photo.width > 1600 && typeof ImageManipulator.manipulateAsync === 'function') {
          const small = await ImageManipulator.manipulateAsync(original, [{ resize: { width: 1600 } }], { compress: 0.8 });
          if (small?.uri) {
            resized = small.uri;
            ocrUri = resized;
          }
        }
      } catch {
        // Resize is an optimization, not a requirement.
      }
      const lines = await TextExtractor.extractTextFromImage(ocrUri.replace('file://', ''));
      return Array.isArray(lines) ? lines.filter((l) => typeof l === 'string' && l.trim()) : null;
    } catch {
      return null;
    } finally {
      if (resized) deleteQuietly(resized);
      if (original) deleteQuietly(original);
    }
  }, []);

  const { state, product: labelProduct, reset } = useNativeScan({ capture, enabled: scanLive });

  // A confirmed date opens the result panel (and only the panel stops the loop).
  useEffect(() => {
    if (state.status !== 'detected') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    AccessibilityInfo.announceForAccessibility?.('Expiry date detected');
    setPanel(state.detection);
    setPanelLines(state.lines);
  }, [state]);

  // --- The on-device barcode catalog (offline product memory) ---
  // Loaded once per scanner session; written whenever a product is identified
  // (locally saved or online-enriched). Works with zero connectivity.
  const catalog = useRef(new Map<string, CatalogRecord>());
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CATALOG_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (alive && Array.isArray(parsed)) {
          for (const r of parsed as unknown[]) {
            const rec = r as Partial<CatalogRecord>;
            if (rec && typeof rec.code === 'string' && typeof rec.name === 'string' && rec.name.trim()) {
              catalog.current.set(rec.code, {
                code: rec.code,
                name: rec.name.slice(0, 80),
                image: typeof rec.image === 'string' && /^https:\/\//.test(rec.image) ? rec.image : undefined,
                categoryHint: typeof rec.categoryHint === 'string' ? rec.categoryHint : null,
                at: typeof rec.at === 'number' ? rec.at : 0,
              });
            }
          }
        }
      } catch {
        // An unreadable catalog starts empty; scanning (and saving) rebuilds it.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persistCatalog = useCallback(() => {
    const entries = [...catalog.current.values()].sort((a, b) => b.at - a.at).slice(0, CATALOG_MAX);
    AsyncStorage.setItem(CATALOG_KEY, JSON.stringify(entries)).catch(() => {
      // Storage full/unavailable: the in-memory record still works this session.
    });
  }, []);

  // Remember a decoded barcode's product — from the user's own save (the name
  // they confirmed) or from an online enrichment — so the NEXT scan of the
  // same product identifies it offline, instantly.
  const rememberBarcode = useCallback(
    (code: string, rec: { name: string; image?: string; categoryHint?: string | null }, source: 'catalog' | 'online') => {
      // Merge, not overwrite: a save that carries no image keeps the photo an
      // earlier lookup cached for this product.
      const image = rec.image ?? catalog.current.get(code)?.image;
      catalog.current.set(code, { code, name: rec.name.slice(0, 80), image, categoryHint: rec.categoryHint ?? null, at: Date.now() });
      persistCatalog();
      setBarcodeProduct({ name: rec.name.slice(0, 80), image, categoryHint: rec.categoryHint ?? null, barcode: code, source });
    },
    [persistCatalog],
  );

  // --- Barcode → product evidence, offline-first ---
  // Decoding is on-device (expo-camera's native scanner). Identification:
  //   1. the on-device catalog (offline, authoritative);
  //   2. otherwise the OCR label guess keeps running (offline);
  //   3. in parallel, an OPTIONAL Open Food Facts lookup (free, no key) runs
  //      only as background enrichment — it never blocks or delays the local
  //      pipeline, and its result is cached into the local catalog.
  // Only definite server answers are negatively cached ("this code has no
  // record"); offline/timeout failures are not, so a later online session can
  // still enrich that product.
  const negatives = useRef(new Set<string>());
  const inFlight = useRef(new Set<string>());
  const lastDecode = useRef<{ code: string; at: number } | null>(null);
  // Bumped by "Scan again": in-flight lookups from the previous item are
  // dropped instead of leaking their product into the next scan.
  const lookupGen = useRef(0);

  const onBarcode = useCallback(
    ({ data }: { data: string }) => {
      if (!scanLive) return;
      const code = data.trim();
      if (!/^\d{6,14}$/.test(code)) return;
      const now = Date.now();
      if (lastDecode.current?.code === code && now - lastDecode.current.at < 3000) return;
      lastDecode.current = { code, at: now };
      setBarcode(code);

      // 1. The local catalog wins — no network involved.
      const local = catalog.current.get(code);
      if (local) {
        setBarcodeProduct({ name: local.name, image: local.image, categoryHint: local.categoryHint ?? null, barcode: code, source: 'catalog' });
        return;
      }

      // 2. Nothing local: the offline OCR guess keeps doing its job (nothing
      //    to do here), and the optional online enrichment starts in the
      //    background. It never blocks the camera or the scan loop.
      if (negatives.current.has(code) || inFlight.current.has(code)) return;
      inFlight.current.add(code);
      const gen = lookupGen.current;
      (async () => {
        let fetched: { name: string; image?: string; categoryHint: string | null } | null = null;
        let answered = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const ctrl = new AbortController();
          timer = setTimeout(() => ctrl.abort(), 6000);
          const res = await fetch(
            `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=status,product_name,brands,image_front_small_url,categories_tags`,
            { signal: ctrl.signal },
          );
          const json: unknown = res.ok ? await res.json() : null;
          answered = !!json;
          const p = (json as { status?: number; product?: { product_name?: unknown; brands?: unknown; image_front_small_url?: unknown; categories_tags?: unknown } } | null)?.product;
          if (json && (json as { status?: number }).status === 1 && p) {
            const productName = typeof p.product_name === 'string' ? p.product_name.split(',')[0].trim() : '';
            const brand = typeof p.brands === 'string' ? p.brands.split(',')[0].trim() : '';
            const image = typeof p.image_front_small_url === 'string' && /^https:\/\//.test(p.image_front_small_url) ? p.image_front_small_url : undefined;
            const tags = Array.isArray(p.categories_tags) ? p.categories_tags.filter((t): t is string => typeof t === 'string').join(' ') : '';
            // The name comes only from what the catalog actually states; when the
            // product name already starts with the brand, the brand is not repeated.
            const name = (
              brand && productName && productName.toLowerCase().startsWith(brand.toLowerCase())
                ? productName
                : [brand, productName].filter(Boolean).join(' ')
            ).slice(0, 80);
            if (name) fetched = { name, image, categoryHint: guessCategory(`${brand} ${productName} ${tags}`) };
          }
        } catch {
          // Offline or timeout: no evidence from this code for now (not cached
          // negatively — a later online session may still enrich it).
        } finally {
          if (timer) clearTimeout(timer);
          inFlight.current.delete(code);
        }
        if (gen !== lookupGen.current) return; // the user scanned again meanwhile
        if (fetched) rememberBarcode(code, fetched, 'online');
        else if (answered) negatives.current.add(code); // the server says: no record for this code
      })();
    },
    [scanLive, rememberBarcode],
  );

  // The product evidence the panel should show right now.
  const product: ProductEvidence | null = useMemo<ProductEvidence | null>(
    () => barcodeProduct ?? (labelProduct ? { name: labelProduct, image: undefined, categoryHint: null, source: 'label' } : null),
    [barcodeProduct, labelProduct],
  );

  const scanAgain = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    reset();
    setPanel(null);
    setPanelLines([]);
    setBarcodeProduct(null);
    setBarcode(null);
    lastDecode.current = null;
    // Drop in-flight lookups from the item the user just left behind.
    lookupGen.current += 1;
    inFlight.current.clear();
  }, [reset]);

  // The hardware-back handler reads this through a ref so it always calls the
  // latest scanAgain without resubscribing.
  const scanAgainRef = useRef(scanAgain);
  scanAgainRef.current = scanAgain;

  // --- Layout: the camera fills the screen edge-to-edge; the chrome positions
  // itself with the safe-area insets it applies itself (exactly once — the
  // scanner is mounted outside the shell's SafeAreaView).
  const headerBottom = insets.top + 8 + 48;
  const frame = useMemo(() => {
    if (!root.width || !root.height) return null;
    const width = Math.max(220, Math.min(root.width - 48, 560));
    const height = Math.min(Math.max(width * 0.42, 110), 230);
    // Keep the frame clear of the header above and the result panel below.
    const reserve = 200;
    const room = Math.max(90, root.height - headerBottom - reserve);
    const y = headerBottom + Math.max(10, (room - height) / 2);
    const x = (root.width - width) / 2;
    return { x, y, width, height };
  }, [root.width, root.height, headerBottom]);

  if (!permission) return <View style={s.fill} />;
  if (!permission.granted) {
    return (
      <View style={s.center}>
        <View style={s.noticeIcon}>
          <Ionicons name={permission.status === 'denied' ? 'lock-closed-outline' : 'camera-outline'} size={28} color={C.mint} />
        </View>
        <Text style={s.noticeTitle}>{permission.status === 'denied' ? 'Camera access blocked' : 'Allow camera access'}</Text>
        <Text style={s.noticeText}>
          {permission.status === 'denied'
            ? 'Prexpire needs the camera to read expiry dates. Allow it in Settings, then come back.'
            : 'Prexpire reads expiry dates through your camera, on this device only.'}
        </Text>
        <PressScale
          onPress={() => {
            if (permission.canAskAgain) requestPermission();
            else onManualEntry();
          }}
          scaleTo={0.98}
          style={s.noticeBtn}
          accessibilityRole="button"
        >
          <Text style={s.noticeBtnText}>{permission.status === 'denied' && !permission.canAskAgain ? 'Enter date manually' : 'Allow camera'}</Text>
        </PressScale>
        <PressScale onPress={onClose} scaleTo={0.97} style={s.linkBtn} accessibilityRole="button">
          <Text style={s.linkText}>Cancel</Text>
        </PressScale>
      </View>
    );
  }

  // Expo Go has no native OCR: say so honestly and offer the manual form
  // instead of pretending to scan (after the permission states, hooks all run).
  if (!ocrSupported) {
    return (
      <View style={s.center}>
        <View style={s.noticeIcon}>
          <Ionicons name="document-text-outline" size={28} color={C.mint} />
        </View>
        <Text style={s.noticeTitle}>Text reader unavailable</Text>
        <Text style={s.noticeText}>
          Reading dates needs the Prexpire development build (eas build --profile development). Expo Go can open the camera but cannot read text.
        </Text>
        <PressScale onPress={onManualEntry} scaleTo={0.98} style={s.noticeBtn} accessibilityRole="button">
          <Text style={s.noticeBtnText}>Enter date manually</Text>
        </PressScale>
        <PressScale onPress={onClose} scaleTo={0.97} style={s.linkBtn} accessibilityRole="button">
          <Text style={s.linkText}>Cancel</Text>
        </PressScale>
      </View>
    );
  }

  // The camera failed to start (another app holds it, a native error): say so
  // honestly and offer a real retry (remount) plus the manual escape.
  if (cameraError) {
    return (
      <View style={s.center}>
        <View style={s.noticeIcon}>
          <Ionicons name="videocam-off-outline" size={28} color={C.mint} />
        </View>
        <Text style={s.noticeTitle}>Camera unavailable</Text>
        <Text style={s.noticeText}>{cameraError}</Text>
        <PressScale
          onPress={() => {
            setCameraError(null);
            setCameraReady(false);
            setCamKey((k) => k + 1);
          }}
          scaleTo={0.98}
          style={s.noticeBtn}
          accessibilityRole="button"
        >
          <Text style={s.noticeBtnText}>Try again</Text>
        </PressScale>
        <PressScale onPress={onManualEntry} scaleTo={0.97} style={s.linkBtn} accessibilityRole="button">
          <Text style={s.linkText}>Enter date manually</Text>
        </PressScale>
      </View>
    );
  }

  const productKnown = !!product;
  const hint = state.status === 'detected' ? null : HINTS[state.hint];
  const hintText =
    !cameraReady
      ? 'Starting the scanner…'
      : state.status === 'detected'
        ? 'Expiry date detected'
        : productKnown && (state.hint === 'aim' || state.hint === 'low-light' || state.hint === 'closer')
          ? product && product.name.length <= 22
            ? `${product.name} — looking for the expiry date`
            : 'Product found — looking for the expiry date'
          : barcode && (state.hint === 'aim' || state.hint === 'low-light' || state.hint === 'closer')
            ? 'Barcode read — reading the label…'
            : (hint?.text ?? 'Keep the date inside the frame');
  const hintIcon: keyof typeof Ionicons.glyphMap =
    state.status === 'detected'
      ? 'checkmark-circle'
      : productKnown && state.hint === 'aim'
        ? 'checkmark-circle-outline'
        : barcode && !productKnown && state.hint === 'aim'
          ? 'barcode-outline'
          : (hint?.icon ?? 'scan-outline');
  const showSpinner = !cameraReady || (state.status === 'scanning' && state.hint === 'hold-steady');

  return (
    <View
      style={s.fill}
      onLayout={(e) => {
        const l = e.nativeEvent.layout;
        setRoot((prev) => (prev.width === l.width && prev.height === l.height ? prev : { width: l.width, height: l.height }));
      }}
    >
      <CameraView
        key={camKey}
        ref={cam}
        style={s.camera}
        facing="back"
        active={appActive}
        enableTorch={torch && appActive && !panel}
        animateShutter={false}
        // The handler's presence toggles barcode scanning (works on every SDK);
        // while the panel is up the scanner is fully paused.
        onBarcodeScanned={scanLive ? onBarcode : undefined}
        barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
        onCameraReady={() => setCameraReady(true)}
        onMountError={() => setCameraError('The camera could not start. Another app may be using it — close it and try again.')}
      />

      {frame && !cameraError && (
        <>
          {/* Dim everything except the frame so the date stands out. */}
          <View pointerEvents="none" style={[s.dim, { left: 0, right: 0, top: 0, height: frame.y }]} />
          <View pointerEvents="none" style={[s.dim, { left: 0, right: 0, top: frame.y + frame.height, bottom: 0 }]} />
          <View pointerEvents="none" style={[s.dim, { left: 0, width: frame.x, top: frame.y, height: frame.height }]} />
          <View pointerEvents="none" style={[s.dim, { right: 0, width: frame.x, top: frame.y, height: frame.height }]} />

          <View style={{ position: 'absolute', left: frame.x, top: frame.y }}>
            <ScanFrame width={frame.width} height={frame.height} scanning={scanLive} success={!!panel} reduced={reduced} />
          </View>

          <View
            style={[
              s.hintWrap,
              { top: frame.y + frame.height + 14, left: Math.max(24, insets.left), right: Math.max(24, insets.right) },
            ]}
            pointerEvents="none"
          >
            <View style={s.hint} accessibilityLiveRegion="polite">
              {showSpinner ? <ActivityIndicator size="small" color={C.scan} /> : <Ionicons name={hintIcon} size={17} color={panel ? C.mint : C.scan} />}
              <Text style={s.hintText} numberOfLines={2}>
                {hintText}
              </Text>
            </View>
          </View>
        </>
      )}

      {/* Top navigation, below the status bar / Dynamic Island (inset applied
          here, exactly once - the scanner fills the screen edge to edge). In
          landscape the side insets keep the glass circles clear of the notch. */}
      <View style={[s.topBar, { top: insets.top + 8, left: Math.max(14, insets.left), right: Math.max(14, insets.right) }]}>
        <GlassCircle onPress={onClose} label="Close scanner">
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </GlassCircle>
        <View style={s.titleBlock}>
          <Text style={s.title} accessibilityRole="header">
            Live Scan
          </Text>
          <Text style={s.subtitle}>Point your camera at an expiry date.</Text>
        </View>
        <GlassCircle onPress={() => setTorch((t) => !t)} label="Flashlight" on={torch}>
          <Ionicons name={torch ? 'flash' : 'flash-outline'} size={21} color={torch ? C.mint : C.text} />
        </GlassCircle>
      </View>

      {panel && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.panelAvoid} pointerEvents="box-none">
          <ResultPanel
            key={panel.key}
            detection={panel}
            lines={panelLines}
            product={product}
            barcode={barcode}
            categories={catList}
            knownCategory={knownCategory}
            bottomInset={insets.bottom}
            maxHeight={Math.max(240, root.height - insets.top - 120)}
            reduced={reduced}
            onSaveAttempt={onSaveAttempt}
            onRememberBarcode={rememberBarcode}
            onScanAgain={scanAgain}
            onFallback={onScanned}
            onClose={onClose}
          />
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

type PanelProps = {
  detection: Detection;
  // The OCR lines that confirmed the date - used by the "finish in the app" hand-off.
  lines: string[];
  product: ProductEvidence | null;
  // The decoded barcode (shown in the panel, saved with the item, and learned
  // into the local catalog on a successful save).
  barcode: string | null;
  categories: ShellCategory[];
  knownCategory: (id: string | null) => boolean;
  bottomInset: number;
  maxHeight: number;
  reduced: boolean;
  onSaveAttempt: (item: SaveRequest) => Promise<SaveOutcome>;
  // Learns { code, name, category } into the on-device catalog on save, so the
  // next scan of the same product identifies it offline.
  onRememberBarcode: (code: string, rec: { name: string; categoryHint?: string | null }, source: 'catalog' | 'online') => void;
  onScanAgain: () => void;
  onFallback: (lines: string[]) => void;
  onClose: () => void;
};

// The bottom product-result panel (the reference screenshot's sheet): dark
// surface, drag handle, product name + category chips, the detected date with
// an editor, and Add item / Scan again. A port of the app's ResultSheet
// interaction model - including ambiguous-date choice and confirm reasons.
function ResultPanel({ detection, lines, product, barcode, categories, knownCategory, bottomInset, maxHeight, reduced, onSaveAttempt, onRememberBarcode, onScanAgain, onFallback, onClose }: PanelProps) {
  const [name, setName] = useState(product?.name ?? '');
  const [image, setImage] = useState<string | undefined>(product?.image);
  // A remote product photo that fails to load (e.g. offline) falls back to the
  // category icon instead of a blank tile.
  const [imageFailed, setImageFailed] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [nameError, setNameError] = useState(false);
  const nameEdited = useRef(false);
  const [category, setCategory] = useState<string | null>(() => {
    const g = product?.categoryHint ?? guessCategory(detection.text);
    return knownCategory(g) ? g : null;
  });
  const categoryTouched = useRef(false);
  const [categoryGuessed, setCategoryGuessed] = useState(() => {
    const g = product?.categoryHint ?? guessCategory(detection.text);
    return knownCategory(g);
  });
  const readings = useMemo(() => [detection.primary, ...detection.alternatives], [detection]);
  const ambiguous = readings.length > 1;
  // For an ambiguous day/month order the user must pick a reading; nothing is
  // preselected (the app's own ResultSheet behaves identically).
  const [picked, setPicked] = useState<number | null>(ambiguous ? null : 0);
  const [edited, setEdited] = useState<Interpretation | null>(null);
  const [editing, setEditing] = useState(false);
  // Dates that are not high confidence need an explicit "this is the expiry date".
  const needsTick = detection.confidence === 'medium' && detection.reasons.some((r) => r !== 'ambiguous-order' && r !== 'month-only');
  const [ticked, setTicked] = useState(false);
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      mounted.current = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  // Better barcode evidence (a local-catalog hit or a late online enrichment)
  // upgrades the panel, unless the user already typed a name or picked a
  // category. Label guesses never overwrite anything.
  useEffect(() => {
    if (!product) return;
    if (!nameEdited.current && product.source !== 'label') {
      setName(product.name);
      setImage(product.image);
      setImageFailed(false);
    }
    if (!categoryTouched.current && product.source !== 'label' && product.categoryHint && knownCategory(product.categoryHint)) {
      setCategory(product.categoryHint);
      setCategoryGuessed(true);
    }
  }, [product, knownCategory]);

  // Slide up + fade in, like the glass bar's transition.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: reduced ? 0 : 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter, reduced]);

  const date: Interpretation | null = edited ?? (picked !== null ? readings[picked] : null);
  const confirmed = !!date && (!!edited || !needsTick || ticked);
  const canSave = confirmed && save !== 'saving' && save !== 'saved';

  const catName = categories.find((c) => c.id === category)?.name ?? 'Auto';

  const submit = async () => {
    if (!canSave || !date || busy.current) return;
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    busy.current = true;
    setSave('saving');
    setSaveError(null);
    const trimmed = name.trim().slice(0, 80);
    // A rejecting bridge must never wedge the panel in "saving".
    let out: SaveOutcome;
    try {
      out = await onSaveAttempt({
        name: trimmed,
        category: category ?? undefined,
        barcode: barcode ?? undefined,
        dateIso: date.iso,
        datePrecision: date.precision,
      });
    } catch {
      out = { ok: false };
    }
    if (!mounted.current) return;
    if (out.ok) {
      // Learn this product into the on-device catalog: the next scan of the
      // same barcode names it instantly, with no network needed.
      if (barcode) onRememberBarcode(barcode, { name: trimmed, categoryHint: category }, 'catalog');
      busy.current = false;
      setSave('saved');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      closeTimer.current = setTimeout(onClose, 850);
    } else {
      busy.current = false;
      setSave('error');
      setSaveError(
        out.error === 'timeout'
          ? "Couldn't reach Prexpire to save. It may already be saved — check your list first; if not, finish saving in the app."
          : out.error ?? "Couldn't save the item. Please try again.",
      );
    }
  };

  const reasons = detection.reasons.filter((r) => REASON_TEXT[r]);
  const dateTitle = edited ? 'Expiry date (edited)' : confirmed ? 'Detected expiry date' : 'Check the expiry date';
  const metaParts = [catName === 'Auto' ? null : catName, date ? expiryPhrase(date.iso) : null].filter(Boolean);
  const meta = metaParts.join(' · ');
  // Honest provenance under the name: an exact barcode match (local or the
  // optional online lookup) is stated as identified; a label-derived name is
  // explicitly marked as a guess to check; a decoded-but-unknown barcode says
  // so instead of inventing a product.
  const provenance = product
    ? barcode
      ? product.source === 'label'
        ? `Named from the label text — check it · Barcode ${barcode}`
        : product.source === 'catalog'
          ? `Identified by barcode, saved on this device · Barcode ${barcode}`
          : `Identified by barcode (online) · Barcode ${barcode}`
      : 'Named from the label text — check it'
    : barcode
      ? `Barcode ${barcode} — no saved record for it; type a name`
      : 'Type a name for this product';

  return (
    <Animated.View
      style={[
        s.panelWrap,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }) }],
        },
      ]}
    >
      <View style={[s.panel, { maxHeight, paddingBottom: Math.max(bottomInset, 14) }]}>
        <View style={s.handle} />
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} bounces={false} keyboardShouldPersistTaps="handled">
          <View style={s.nameBlock}>
            <Text style={s.nameLabel}>Product name</Text>
            <View style={[s.nameField, nameFocused && !nameError && s.nameFieldFocus, nameError && s.nameFieldWarn]}>
              <View style={s.thumb}>
                {image && !imageFailed ? (
                  <Image source={{ uri: image }} style={s.thumbImage} accessibilityLabel="Product photo" onError={() => setImageFailed(true)} />
                ) : (
                  <Ionicons
                    name={categories.find((c) => c.id === category)?.icon ?? 'cube'}
                    size={24}
                    color={C.mint}
                    accessibilityLabel={catName === 'Auto' ? 'Category not chosen' : `${catName} category`}
                  />
                )}
              </View>
              <TextInput
                value={name}
                onChangeText={(t) => {
                  nameEdited.current = true;
                  setName(t);
                  if (nameError && t.trim()) setNameError(false);
                }}
                placeholder="e.g. Greek yogurt"
                placeholderTextColor={C.muted}
                style={s.nameInput}
                returnKeyType="done"
                maxLength={80}
                autoCorrect={false}
                accessibilityLabel="Product name"
                onFocus={() => setNameFocused(true)}
                onBlur={() => setNameFocused(false)}
              />
            </View>
            {nameError && <Text style={s.nameError}>Give the product a name first.</Text>}
            <Text style={s.provenance}>{provenance}</Text>
            {meta ? <Text style={s.meta}>{meta}</Text> : null}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
            {categories.map((cat) => (
              <PressScale
                key={cat.id}
                onPress={() => {
                  categoryTouched.current = true;
                  setCategory(cat.id);
                }}
                scaleTo={0.95}
                style={[s.chip, category === cat.id && s.chipOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: category === cat.id }}
                accessibilityLabel={`Category ${titleize(cat.name)}`}
              >
                <Text style={[s.chipText, category === cat.id && s.chipTextOn]} numberOfLines={1}>
                  {titleize(cat.name)}
                </Text>
              </PressScale>
            ))}
          </ScrollView>
          {categoryGuessed && !categoryTouched.current && <Text style={s.guessed}>Category picked from the label; tap another to change it.</Text>}

          <View style={s.divider} />

          <PressScale
            onPress={() => setEditing((e) => !e)}
            scaleTo={0.985}
            style={s.dateRow}
            accessibilityRole="button"
            accessibilityLabel={`${dateTitle}: ${date ? formatDate(date) : 'not chosen'}. Edit date`}
          >
            <View style={[s.calendar, !confirmed && s.calendarWarn]}>
              <Ionicons name="calendar" size={22} color={confirmed ? C.mint : C.amberText} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.dateLabel, !confirmed && { color: C.amberText }]}>{dateTitle}</Text>
              <Text style={s.dateValue}>{date ? formatDate(date) : 'Choose the date below'}</Text>
            </View>
            <Ionicons name={editing ? 'chevron-down' : 'chevron-forward'} size={20} color={C.muted} />
          </PressScale>

          {ambiguous && !edited && (
            <View style={s.block}>
              <Text style={s.question}>The day and month could be either way round. Which is it?</Text>
              <View style={s.choiceRow}>
                {readings.map((r, i) => (
                  <PressScale
                    key={r.iso}
                    onPress={() => setPicked(i)}
                    scaleTo={0.97}
                    style={[s.choice, picked === i && s.choiceOn]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: picked === i }}
                  >
                    <Text style={[s.choiceText, picked === i && s.choiceTextOn]}>{formatDate(r)}</Text>
                  </PressScale>
                ))}
              </View>
            </View>
          )}

          {!edited && reasons.length > 0 && (
            <View style={s.block}>
              {reasons.map((r) => (
                <View key={r} style={s.reason}>
                  <Ionicons name="information-circle-outline" size={16} color={C.amberText} />
                  <Text style={s.reasonText}>{REASON_TEXT[r]}</Text>
                </View>
              ))}
              <Text style={s.raw}>
                Read on the label: “{detection.labelText ? `${detection.labelText} ` : ''}
                {detection.raw}”
              </Text>
            </View>
          )}

          {editing && (
            <DateEditor
              value={date ?? readings[0]}
              onChange={(iso) => setEdited({ iso, precision: 'day' })}
            />
          )}
        </ScrollView>

        {needsTick && !edited && (
          <PressScale
            onPress={() => setTicked((t) => !t)}
            scaleTo={0.99}
            style={s.tickRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: ticked }}
          >
            <Ionicons name={ticked ? 'checkbox' : 'square-outline'} size={22} color={ticked ? C.mint : C.muted} />
            <Text style={s.tickText}>Yes, this is the expiry date</Text>
          </PressScale>
        )}

        {save === 'error' && (
          <View style={s.errorBlock}>
            <Text style={s.errorText}>{saveError}</Text>
            <PressScale onPress={() => onFallback(lines)} scaleTo={0.97} style={s.linkBtn} accessibilityRole="button">
              <Text style={s.linkText}>Finish saving in the app</Text>
            </PressScale>
          </View>
        )}

        <PressScale
          onPress={submit}
          disabled={!canSave}
          scaleTo={0.98}
          style={[s.primary, !canSave && save !== 'saved' && s.disabled]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave, busy: save === 'saving' }}
          accessibilityLabel={save === 'saved' ? 'Item added' : 'Add item'}
        >
          {save === 'saving' ? (
            <ActivityIndicator color={C.ink} />
          ) : save === 'saved' ? (
            <View style={s.savedRow}>
              <Ionicons name="checkmark-circle" size={20} color={C.ink} />
              <Text style={s.primaryText}>Added</Text>
            </View>
          ) : (
            <Text style={s.primaryText}>Add item</Text>
          )}
        </PressScale>
        <PressScale
          onPress={onScanAgain}
          disabled={save === 'saving' || save === 'saved'}
          scaleTo={0.98}
          style={s.secondary}
          accessibilityRole="button"
          accessibilityLabel="Scan again"
        >
          <Text style={s.secondaryText}>Scan again</Text>
        </PressScale>
      </View>
    </Animated.View>
  );
}

// Day, month and year steppers. Works the same on iOS and Android without a
// native picker (port of the app's ResultSheet editor).
function DateEditor({ value, onChange }: { value: Interpretation; onChange: (iso: string) => void }) {
  const [y, m, d] = value.iso.split('-').map(Number);
  const set = (year: number, month: number, day: number) => {
    const max = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const dd = Math.min(Math.max(day, 1), max);
    onChange(`${year}-${String(month).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
  };
  const wrap = (n: number, lo: number, hi: number) => (n < lo ? hi : n > hi ? lo : n);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const thisYear = new Date().getFullYear();
  return (
    <View style={s.editor}>
      <Stepper label="Day" value={String(d)} onDown={() => set(y, m, wrap(d - 1, 1, daysInMonth))} onUp={() => set(y, m, wrap(d + 1, 1, daysInMonth))} />
      <Stepper label="Month" value={MONTHS[m - 1]} onDown={() => set(y, wrap(m - 1, 1, 12), d)} onUp={() => set(y, wrap(m + 1, 1, 12), d)} />
      <Stepper
        label="Year"
        value={String(y)}
        onDown={() => set(Math.max(y - 1, thisYear - 5), m, d)}
        onUp={() => set(Math.min(y + 1, thisYear + 15), m, d)}
      />
    </View>
  );
}

function Stepper({ label, value, onDown, onUp }: { label: string; value: string; onDown: () => void; onUp: () => void }) {
  return (
    <View style={s.stepper} accessible accessibilityLabel={`${label} ${value}`}>
      <PressScale onPress={onDown} scaleTo={0.9} style={s.stepBtn} accessibilityRole="button" accessibilityLabel={`Previous ${label.toLowerCase()}`} hitSlop={6}>
        <Ionicons name="remove" size={18} color={C.text} />
      </PressScale>
      <View style={s.stepValue}>
        <Text style={s.stepLabel}>{label}</Text>
        <Text style={s.stepText}>{value}</Text>
      </View>
      <PressScale onPress={onUp} scaleTo={0.9} style={s.stepBtn} accessibilityRole="button" accessibilityLabel={`Next ${label.toLowerCase()}`} hitSlop={6}>
        <Ionicons name="add" size={18} color={C.text} />
      </PressScale>
    </View>
  );
}

const s = StyleSheet.create({
  // The scanner fills the whole screen edge to edge (it is mounted outside the
  // shell's SafeAreaView and applies the insets itself, exactly once).
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg },
  camera: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dim: { position: 'absolute', backgroundColor: 'rgba(2,7,9,0.5)' },

  // Liquid-glass chrome (matches the tab bar's circles).
  topBar: { position: 'absolute', left: 14, right: 14, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  glass: { width: 46, height: 46, borderRadius: 23, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  glassFallback: { backgroundColor: 'rgba(12,24,27,0.55)' },
  glassOn: { borderColor: 'rgba(46,232,182,0.55)' },
  glassDisabled: { opacity: 0.4 },
  glassBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, alignItems: 'center', marginHorizontal: 10 },
  title: { color: C.text, fontSize: 18, fontWeight: '700', letterSpacing: -0.3, textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  subtitle: { color: 'rgba(242,246,247,0.72)', fontSize: 12.5, marginTop: 1, textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } },

  // Scanning guide.
  corner: { position: 'absolute', width: 30, height: 30 },
  frameOutline: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(46,232,182,0.45)' },
  sweep: {
    position: 'absolute',
    top: 0,
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 1,
    backgroundColor: C.scan,
    opacity: 0.55,
    shadowColor: C.scan,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },

  // Guidance pill under the frame.
  hintWrap: { position: 'absolute', left: 24, right: 24, alignItems: 'center' },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    minHeight: 40,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(5,13,16,0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    maxWidth: 460,
  },
  hintText: { color: C.text, fontSize: 14, fontWeight: '500', flexShrink: 1 },

  // Permission / unavailable notices.
  center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  noticeIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#0D2E28', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  noticeTitle: { color: C.text, fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  noticeText: { color: C.muted, fontSize: 14.5, lineHeight: 21, textAlign: 'center', marginBottom: 16 },
  noticeBtn: { height: 50, alignSelf: 'stretch', borderRadius: 999, backgroundColor: C.mint, alignItems: 'center', justifyContent: 'center' },
  noticeBtnText: { color: C.ink, fontSize: 16, fontWeight: '700' },

  // Result panel (the reference screenshot's bottom sheet).
  panelAvoid: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  panelWrap: { alignSelf: 'center', width: '100%', maxWidth: 560 },
  panel: { backgroundColor: C.sheet, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingHorizontal: 18, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: '#3A4A50', marginBottom: 12 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { paddingBottom: 10 },
  nameBlock: { gap: 8 },
  nameLabel: { color: C.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  nameField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: 10,
  },
  nameFieldFocus: { borderColor: 'rgba(46,232,182,0.55)' },
  nameFieldWarn: { borderColor: 'rgba(245,184,61,0.65)' },
  thumb: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.iconTile, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbImage: { width: 40, height: 40, borderRadius: 12 },
  nameInput: { flex: 1, color: C.text, fontSize: 16, fontWeight: '500', paddingVertical: 0 },
  nameError: { color: C.amberText, fontSize: 12.5 },
  // Provenance / uncertainty line: where the name came from, and the barcode.
  provenance: { color: C.muted, fontSize: 12, lineHeight: 16 },
  meta: { color: C.muted, fontSize: 13 },
  chips: { gap: 8, paddingTop: 14 },
  chip: { height: 32, borderRadius: 999, paddingHorizontal: 14, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: C.mint, backgroundColor: C.mint },
  chipText: { color: C.muted, fontSize: 13.5, fontWeight: '500' },
  chipTextOn: { color: C.ink, fontWeight: '700' },
  guessed: { color: C.muted, fontSize: 12, paddingTop: 8 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.border, marginTop: 14 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  calendar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#0D2E28', alignItems: 'center', justifyContent: 'center' },
  calendarWarn: { backgroundColor: '#3D2B0E' },
  dateLabel: { color: C.muted, fontSize: 13.5 },
  dateValue: { color: C.text, fontSize: 21, fontWeight: '700', letterSpacing: -0.3, marginTop: 2 },
  block: { gap: 8, paddingBottom: 10 },
  question: { color: C.text, fontSize: 14, fontWeight: '500' },
  choiceRow: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  choiceOn: { borderColor: C.mint, backgroundColor: C.mint },
  choiceText: { color: C.text, fontSize: 15, fontWeight: '500' },
  choiceTextOn: { color: C.ink, fontWeight: '700' },
  reason: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  reasonText: { color: C.amberText, fontSize: 13, flex: 1, lineHeight: 18 },
  raw: { color: C.muted, fontSize: 12.5 },
  editor: { flexDirection: 'row', gap: 8, paddingTop: 4, paddingBottom: 6 },
  stepper: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, height: 52 },
  stepBtn: { width: 30, height: '100%', alignItems: 'center', justifyContent: 'center' },
  stepValue: { flex: 1, alignItems: 'center' },
  stepLabel: { color: C.muted, fontSize: 11 },
  stepText: { color: C.text, fontSize: 15.5, fontWeight: '600' },
  tickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 2, paddingBottom: 10 },
  tickText: { color: C.text, fontSize: 14.5, fontWeight: '500' },
  errorBlock: { alignItems: 'center', gap: 2, paddingTop: 6, paddingBottom: 4 },
  errorText: { color: C.red, fontSize: 13, textAlign: 'center' },
  linkBtn: { paddingVertical: 8, paddingHorizontal: 12 },
  linkText: { color: C.mint, fontSize: 15, fontWeight: '600' },
  primary: { height: 52, borderRadius: 999, backgroundColor: C.mint, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: C.ink, fontSize: 16.5, fontWeight: '700' },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  disabled: { opacity: 0.45 },
  secondary: { height: 50, borderRadius: 999, borderWidth: 1, borderColor: '#2C3B40', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryText: { color: C.text, fontSize: 15.5, fontWeight: '500' },
});
