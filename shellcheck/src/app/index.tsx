import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { GlassTabBar, type ShellTab } from '../components/GlassTabBar';
import { NativeScanner, type ShellCategory } from '../components/NativeScanner';

// Where do these files live?
//   this file      -> src/app/index.tsx   (your shell's entry route — replace its contents)
//   GlassTabBar    -> src/components/GlassTabBar.tsx
//   NativeScanner  -> src/components/NativeScanner.tsx
//   scanner/       -> src/scanner/        (dateParser, categoryGuess, productGuess, useNativeScan)
// The '../components/...' and '../../'-free relative imports work for both the
// src/app/ and app/ layouts.

const SITE = 'https://prexpire.vercel.app/';

// The item the scanner panel asks the website to save through its real
// persistence pipeline (the bridge's prexpire:save event). The decoded
// barcode rides along and is stored on the item.
type SaveRequest = { name: string; category?: string; barcode?: string; dateIso: string; datePrecision: 'day' | 'month' };
type SaveOutcome = { ok: boolean; error?: string };

// Icons for the website's five built-in categories (custom folders carry the
// glyph the user picked in Settings); used when a live categories report has
// no icon field, so the stand-in and live lists agree.
const BUILTIN_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  food: 'nutrition',
  medicine: 'medkit',
  household: 'home',
  skincare: 'water',
  pantry: 'archive',
};

export default function HomeScreen() {
  const web = useRef<WebView>(null);
  const [scanning, setScanning] = useState(false);
  // The glass tab bar mirrors the website's navigation: the website reports
  // its active tab + reminder badge back through the bridge, hides its own
  // bottom nav inside the shell, and hides its own header on scroll-down.
  const [activeTab, setActiveTab] = useState<ShellTab>('home');
  const [badge, setBadge] = useState(0);
  // Open Shopping List entries, mirrored from the website's route reports (mint badge on the Shopping tab).
  const [shopBadge, setShopBadge] = useState(0);
  const [webScannerOpen, setWebScannerOpen] = useState(false);
  // True for a short window after the scanner hands OCR lines back to the
  // website: the bar stays hidden until the site reports its route, so it
  // never flashes in and straight back out during the hand-off.
  const [handingOff, setHandingOff] = useState(false);
  // The website's live category list (reported over the bridge), handed to the
  // scanner so its panel shows the user's real categories.
  const [categories, setCategories] = useState<ShellCategory[] | null>(null);

  // Pending one-tap saves: requestId -> resolver. The website answers each
  // prexpire:save with a save-result message; a timeout resolves the promise
  // so a stale site (pre-bridge) can never wedge the panel.
  const pendingSaves = useRef(new Map<string, (outcome: SaveOutcome) => void>());

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      // The website's Scan flow (and the glass bar's own scan button on the web side)
      // asks the shell to scan natively.
      if (msg?.type === 'scan') {
        setScanning(true);
        return;
      }
      // The scanner panel's save finished (prexpire:save bridge).
      if (msg?.type === 'save-result' && typeof msg.requestId === 'string') {
        const settle = pendingSaves.current.get(msg.requestId);
        if (settle) {
          pendingSaves.current.delete(msg.requestId);
          settle({ ok: !!msg.ok, error: typeof msg.error === 'string' ? msg.error : undefined });
        }
        return;
      }
      // The website's category list (its live categories, with the Ionicons
      // glyph of custom folders), so the scanner's result panel shows the
      // same folders the app itself uses.
      if (msg?.type === 'categories' && Array.isArray(msg.categories)) {
        const list: ShellCategory[] = msg.categories
          .filter((c: unknown) => !!c && typeof (c as { id?: unknown }).id === 'string' && typeof (c as { name?: unknown }).name === 'string')
          .map((c: { id: string; name: string; icon?: unknown }) => ({
            id: c.id,
            name: c.name,
            // Only glyphs the icon font actually has; built-ins get their
            // known icon when the site sends none.
            icon:
              typeof c.icon === 'string' && c.icon in Ionicons.glyphMap
                ? (c.icon as keyof typeof Ionicons.glyphMap)
                : BUILTIN_ICON[c.id],
          }));
        setCategories(list);
        return;
      }
      // Route report: keep the glass bar's active tab, badge, and visibility in sync
      // with the website (the bar hides while the website's scanner sheet is open).
      if (msg?.type === 'route') {
        if (handoffTimer.current) clearTimeout(handoffTimer.current);
        setHandingOff(false);
        setWebScannerOpen(msg.tab === 'scan');
        if (typeof msg.tab === 'string' && msg.tab !== 'scan') {
          setActiveTab(msg.tab as ShellTab);
          if (typeof msg.badge === 'number' && msg.badge >= 0) setBadge(msg.badge);
          if (typeof msg.shopBadge === 'number' && msg.shopBadge >= 0) setShopBadge(msg.shopBadge);
        }
        return;
      }
      // (The website no longer sends scroll messages at all: the bar is
      // permanent, so there is nothing for scrolling to say.)
    } catch {
      // Not ours; ignore.
    }
  };

  const inject = (js: string) => {
    web.current?.injectJavaScript(js);
  };
  const navigate = (to: string) =>
    inject(`window.dispatchEvent(new CustomEvent('prexpire:navigate',{detail:${JSON.stringify({ to })}}));true;`);

  // The native scanner read the label: hand the OCR lines back to the website.
  // It parses them with its own date parser and opens the save sheet pre-filled
  // (the website then reports its route back, which hides this bar until saved).
  const handoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScanned = (lines: string[]) => {
    setScanning(false);
    setHandingOff(true);
    if (handoffTimer.current) clearTimeout(handoffTimer.current);
    handoffTimer.current = setTimeout(() => setHandingOff(false), 3000); // safety if no route report arrives
    inject(`window.dispatchEvent(new CustomEvent('prexpire:native-scan',{detail:${JSON.stringify({ lines })}}));true;`);
  };
  useEffect(
    () => () => {
      if (handoffTimer.current) clearTimeout(handoffTimer.current);
    },
    [],
  );

  // One-tap save from the scanner's result panel: dispatch prexpire:save into
  // the website and wait (bounded) for its save-result reply. The website saves
  // through its real pipeline (validation, storage, reminders, shopping list)
  // and answers ok/failed, so the panel can show Added / keep the user's edits.
  const attemptSave = useCallback((item: SaveRequest) => {
    return new Promise<SaveOutcome>((resolve) => {
      const requestId = `sv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const timer = setTimeout(() => {
        if (pendingSaves.current.delete(requestId)) resolve({ ok: false, error: 'timeout' });
      }, 9000);
      pendingSaves.current.set(requestId, (outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      });
      inject(`window.dispatchEvent(new CustomEvent('prexpire:save',{detail:${JSON.stringify({ ...item, requestId })}}));true;`);
    });
  }, []);

  // A glass tab was tapped: drive the website's navigation through the bridge —
  // the active marker glides to the tapped tab, the website navigates with the
  // exact same logic its own bottom nav uses, then reports the route back.
  const onTab = (tab: ShellTab) => {
    setActiveTab(tab);
    navigate(`tab:${tab}`);
  };

  // One visibility rule, and it has nothing to do with scrolling: the bar is
  // on screen unless a scanner (the shell's own, the website's, or a hand-off
  // in progress) covers it.
  const barVisible = !scanning && !webScannerOpen && !handingOff;

  return (
    // SafeAreaProvider: the scanner and the glass bar read the safe-area
    // insets themselves, so they need a provider above them.
    <SafeAreaProvider>
      <View style={styles.root}>
        {/* The WebView lives in the safe area (top inset applied exactly once
            here). The scanner deliberately sits OUTSIDE it: it fills the
            screen edge to edge with its own camera and applies the insets
            itself, so the camera runs under the status bar like every camera
            app while its controls stay clear of it. */}
        <SafeAreaView style={styles.safe} edges={['top']}>
          <WebView
            ref={web}
            source={{ uri: SITE }}
            style={styles.webview}
            javaScriptEnabled
            domStorageEnabled
            allowsBackForwardNavigationGestures
            startInLoadingState
            onMessage={onMessage}
          />
        </SafeAreaView>
        <GlassTabBar
          active={activeTab}
          badge={badge}
          shopBadge={shopBadge}
          visible={barVisible}
          onTab={onTab}
          onScan={() => setScanning(true)}
        />
        {scanning && (
          <NativeScanner
            onClose={() => setScanning(false)}
            onScanned={onScanned}
            onManualEntry={() => {
              setScanning(false);
              navigate('manual');
            }}
            onSaveAttempt={attemptSave}
            categories={categories}
          />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#080D0C',
  },
  safe: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: '#080D0C',
  },
});
