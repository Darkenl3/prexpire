import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { ItemsScreen } from './src/screens/ItemsScreen';
import { RemindersScreen } from './src/screens/RemindersScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { BottomNav, type TabId } from './src/components/HomeComponents';
import { ExpiryAlertLayer } from './src/components/ExpiryAlert';
import { CategoriesProvider, readCustomCategories, useCategories } from './src/categories';
import { CATEGORY_IDS, ItemsProvider, useItems, type CategoryId, type Item } from './src/items';
import { SettingsProvider, useSettings } from './src/settings';
import { ShoppingProvider } from './src/shopping';
import { LIGHT, ThemeProvider, useTheme } from './src/theme';
import { remindersDue, dayOrderForFormat } from './src/preferences';
import { useLayout } from './src/layout';
import { dayOrderForRegion, parseExpiry } from './src/scanner/dateParser';
import type { Detection } from './src/scanner/useExpiryScanner';

type Route = { tab: TabId; category?: CategoryId; shopping?: boolean; settingsPage?: 'categories' } | { tab: 'scan'; manual?: boolean };

const TABS: TabId[] = ['home', 'items', 'reminders', 'settings'];
const WEB = Platform.OS === 'web';

// On the web the open tab is kept in the address (#settings), so a refresh stays on it.
// The Shopping List is a VIEW of the Lists tab (#items/shopping), and the
// retired #shop tab still lands there so old bookmarks keep working.
function routeFromHash(): Route {
  if (!WEB || typeof window === 'undefined') return { tab: 'home' };
  const [tab, second] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (tab === 'shop') return { tab: 'items', shopping: true };
  if (!TABS.includes(tab as TabId)) return { tab: 'home' };
  if (tab === 'items' && second === 'shopping') return { tab: 'items', shopping: true };
  // Custom categories are read synchronously here: the hash is parsed in a
  // state initialiser, before any context exists.
  const known = CATEGORY_IDS.includes(second) || readCustomCategories().some((c) => c.id === second);
  return { tab: tab as TabId, category: known ? (second as CategoryId) : undefined };
}

function writeHash(route: Route) {
  if (!WEB || typeof window === 'undefined' || route.tab === 'scan') return;
  let hash = route.tab === 'home' ? '' : `#${route.tab}`;
  if (route.tab === 'items' && route.shopping) hash = '#items/shopping';
  else if ('category' in route && route.category) hash += `/${route.category}`;
  try {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  } catch {
    // Sandboxed frames can refuse history changes; the tab still opens.
  }
}

// Keyboard focus rings for the web build (react-native-web leaves them to the
// browser). The ring follows the active theme: the bright lime on the dark
// page, the deep readable green on the light one.
function useFocusStyles() {
  const t = useTheme();
  useEffect(() => {
    if (!WEB || typeof document === 'undefined') return;
    const ring = t === LIGHT ? t.green : t.mint;
    const style = document.createElement('style');
    style.textContent =
      '[role=button]:focus-visible,[role=radio]:focus-visible,[role=switch]:focus-visible,[role=tab]:focus-visible,[role=link]:focus-visible,input:focus-visible{outline:2px solid ' +
      ring +
      ';outline-offset:2px;border-radius:10px}';
    document.head.appendChild(style);
    return () => style.remove();
  }, [t]);
}

function Shell() {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const { items, defaultCategory, addItem } = useItems();
  const { settings, formatDate } = useSettings();
  const { ids: categoryIds, all: allCategories, custom: customCategories } = useCategories();
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [lastTab, setLastTab] = useState<TabId>(route.tab === 'scan' ? 'home' : route.tab);
  const [notice, setNotice] = useState<string | null>(null);
  // A detection handed in by a native wrapper (see docs/native-shell.md).
  const [nativeScan, setNativeScan] = useState<Detection | null>(null);
  useFocusStyles();
  // Inside the Expo WebView shell, the website hides its own bottom nav: the shell
  // renders a native liquid-glass tab bar instead (the same look, real glass) and
  // drives this app's navigation through the 'prexpire:navigate' bridge below.
  const inShell = WEB && typeof window !== 'undefined' && !!(window as { ReactNativeWebView?: unknown }).ReactNativeWebView;

  // Native bridge: when this app runs inside a React Native WebView shell, the shell can
  // scan a label with its own native camera + OCR (Apple Vision / ML Kit - far stronger
  // than the in-browser reader) and hand us the text lines. We parse them with the same
  // date parser the camera path uses and open the save sheet pre-filled.
  //
  // The parser's preferred day/month order comes from the user's Date format
  // setting (dayOrderForFormat), so a shell scan reads ambiguous dates exactly
  // like the in-app scanner does. The listener re-subscribes when the setting
  // changes, so it never parses with a stale format.
  useEffect(() => {
    if (!WEB || typeof window === 'undefined') return;
    const onNativeScan = (event: Event) => {
      const detail = (event as CustomEvent<{ lines?: unknown }>).detail;
      const lines = Array.isArray(detail?.lines) ? detail.lines.filter((l): l is string => typeof l === 'string') : [];
      if (!lines.length) return;
      const region = typeof navigator !== 'undefined' ? navigator.language.split('-')[1] : undefined;
      const result = parseExpiry(lines, { today: new Date(), preferredOrder: dayOrderForFormat(settings.dateFormat, dayOrderForRegion(region)) });
      if (result.kind !== 'found') return;
      setNativeScan(result);
      setRoute({ tab: 'scan' });
    };
    window.addEventListener('prexpire:native-scan', onNativeScan);
    return () => window.removeEventListener('prexpire:native-scan', onNativeScan);
  }, [settings.dateFormat]);

  // The live category list, reported to the native shell so its scanner result
  // panel shows the same folders this app uses (the built-ins the user keeps,
  // plus custom folders with their Ionicons glyph for the panel's chips).
  const shellCategories = useMemo(() => {
    const iconById = new Map(customCategories.map((c) => [c.id, c.icon] as const));
    return allCategories.map((c) => ({ id: c.id, name: c.name, icon: iconById.get(c.id) }));
  }, [allCategories, customCategories]);
  useEffect(() => {
    if (!inShell || typeof window === 'undefined') return;
    const shell = (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView;
    if (!shell?.postMessage) return;
    try {
      shell.postMessage(JSON.stringify({ type: 'categories', categories: shellCategories }));
    } catch {
      // The shell went away; the next change reports again.
    }
  }, [inShell, shellCategories]);

  // The Date format setting, reported so the shell's scanner reads ambiguous
  // numeric dates (03/04/2026) in the order the user chose — and its result
  // panel preselects that reading instead of asking which day/month order it
  // is. Sent on mount (as soon as settings load) and on every change.
  useEffect(() => {
    if (!inShell || typeof window === 'undefined') return;
    const shell = (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView;
    if (!shell?.postMessage) return;
    try {
      shell.postMessage(JSON.stringify({ type: 'date-format', format: settings.dateFormat }));
    } catch {
      // The shell went away; the next change reports again.
    }
  }, [inShell, settings.dateFormat]);

  // The Scanning Line Animation setting, reported so the shell's native
  // scanner hides or shows its moving sweep line exactly like the website's
  // own scanner does. Sent on mount and on every change; cosmetic only — the
  // shell's camera, barcode reading and date OCR are never affected by it.
  useEffect(() => {
    if (!inShell || typeof window === 'undefined') return;
    const shell = (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView;
    if (!shell?.postMessage) return;
    try {
      shell.postMessage(JSON.stringify({ type: 'scan-line', on: settings.scanLineAnimation !== false }));
    } catch {
      // The shell went away; the next change reports again.
    }
  }, [inShell, settings.scanLineAnimation]);

  // Native bridge, save path: the shell's scanner result panel saves directly
  // through this app's real pipeline (docs/native-shell.md). The shell
  // dispatches a prexpire:save event carrying a structured item plus a
  // requestId; this handler validates it, saves it, and replies over the
  // bridge so the panel can show "Added" or keep the user's edits after a
  // failure. RequestIds are idempotent, so a re-send can never double-save.
  const fallbackCategory = categoryIds.includes(defaultCategory) ? defaultCategory : (categoryIds[0] ?? defaultCategory);
  // Mirrors onSaved (with its 650 ms "Added" beat, so the home toast runs
  // its full length exactly like the app's own save flow): the notice and
  // route the app's own save flow shows, so a bridge save feels identical.
  const savedFromShell = useCallback(
    (item: Item) => {
      setNativeScan(null);
      setTimeout(
        () => {
          setNotice(`${item.name} added · expires ${formatDate(item.expiresOn, item.datePrecision)}`);
          setRoute({ tab: 'home' });
          setLastTab('home');
        },
        650,
      );
    },
    [formatDate],
  );
  // Completed save request ids, kept across listener re-subscriptions so a
  // re-delivered event can never save twice.
  const handledSaves = useRef(new Set<string>());
  useEffect(() => {
    if (!WEB || typeof window === 'undefined') return;
    const handled = handledSaves.current;
    const onSave = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: unknown; name?: unknown; category?: unknown; barcode?: unknown; image?: unknown; dateIso?: unknown; datePrecision?: unknown }>).detail ?? {};
      if (typeof detail.requestId !== 'string') return;
      const requestId = detail.requestId;
      const reply = (ok: boolean, error?: string) => {
        const shell = (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView;
        if (!shell?.postMessage) return;
        try {
          shell.postMessage(JSON.stringify({ type: 'save-result', requestId, ok, error }));
        } catch {
          // The shell went away; nothing to answer.
        }
      };
      if (handled.has(requestId)) return reply(true); // already completed: confirm, never duplicate
      const name = typeof detail.name === 'string' ? detail.name.trim().slice(0, 80) : '';
      const dateIso = typeof detail.dateIso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(detail.dateIso) ? detail.dateIso : null;
      const datePrecision = detail.datePrecision === 'month' ? ('month' as const) : ('day' as const);
      const barcode = typeof detail.barcode === 'string' && /^\d{6,14}$/.test(detail.barcode) ? detail.barcode : undefined;
      // The product photo the shell's scanner retrieved (an https URL from the
      // barcode databases; a data URI would be fine too). Accepted only in the
      // forms items.tsx itself trusts, so nothing else can ride in as an image.
      const image =
        typeof detail.image === 'string' && detail.image.length <= 300000 && (/^data:image\//.test(detail.image) || /^https:\/\//.test(detail.image))
          ? detail.image
          : undefined;
      if (!name) return reply(false, 'The product needs a name.');
      if (!dateIso) return reply(false, 'The expiry date could not be read.');
      const wanted = typeof detail.category === 'string' && detail.category ? (detail.category as CategoryId) : null;
      const category = wanted && categoryIds.includes(wanted) ? wanted : fallbackCategory;
      handled.add(requestId);
      addItem({ name, category, expiresOn: dateIso, datePrecision, source: 'scan', ...(barcode ? { barcode } : {}), ...(image ? { image } : {}) })
        .then((item) => {
          savedFromShell(item);
          reply(true);
        })
        .catch(() => {
          handled.delete(requestId);
          reply(false, "Couldn't save the item. Please try again.");
        });
    };
    window.addEventListener('prexpire:save', onSave);
    return () => window.removeEventListener('prexpire:save', onSave);
  }, [addItem, categoryIds, fallbackCategory, savedFromShell]);

  useEffect(() => writeHash(route), [route]);

  const badge = useMemo(
    () => (settings.reminders ? remindersDue(items, settings.reminderLead).length : 0),
    [items, settings.reminders, settings.reminderLead],
  );

  const onNavigate = useCallback(
    (to: string) => {
      if (to === 'scan') {
        // Inside a native WebView shell (docs/native-shell.md) let the shell scan with its
        // native camera + OCR (Apple Vision / ML Kit). The shell hands the reading back
        // via the 'prexpire:native-scan' event; outside a shell this is a no-op.
        const shell = WEB && typeof window !== 'undefined' ? (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView : undefined;
        if (shell?.postMessage) {
          try {
            shell.postMessage(JSON.stringify({ type: 'scan' }));
            return;
          } catch {
            // Fall through to the in-app scanner.
          }
        }
        return setRoute({ tab: 'scan' });
      }
      if (to === 'manual') {
        // Manual product entry: the save form without the camera (the user
        // types the product and its date instead of scanning a label).
        setNativeScan(null);
        return setRoute({ tab: 'scan', manual: true });
      }
      if (to.startsWith('tab:')) {
        const tab = to.slice(4);
        // The Shopping List is a view of the Lists tab: the tab:shop string
        // (the segmented control, the alert banner's button) opens it there.
        if (tab === 'shop') {
          setRoute({ tab: 'items', shopping: true });
          setLastTab('items');
          return;
        }
        if (TABS.includes(tab as TabId)) {
          setRoute({ tab: tab as TabId });
          setLastTab(tab as TabId);
        }
        return;
      }
      if (to.startsWith('settings:')) {
        // Home's Add-category tile opens Settings straight onto its category
        // page, so the user lands where the category list lives.
        if (to === 'settings:categories') {
          setRoute({ tab: 'settings', settingsPage: 'categories' });
          setLastTab('settings');
        }
        return;
      }
      if (to.startsWith('category:')) {
        const category = to.slice(9) as CategoryId;
        // Includes the user's custom categories (ids from the context).
        if (categoryIds.includes(category)) {
          setRoute({ tab: 'items', category });
          setLastTab('items');
        }
      }
    },
    [categoryIds],
  );
  const closeScanner = useCallback(() => {
    setNativeScan(null);
    setRoute({ tab: lastTab });
  }, [lastTab]);
  const onSaved = useCallback(
    (item: Item) => {
      setNativeScan(null);
      setNotice(`${item.name} added · expires ${formatDate(item.expiresOn, item.datePrecision)}`);
      setRoute({ tab: 'home' });
      setLastTab('home');
    },
    [formatDate],
  );
  const clearNotice = useCallback(() => setNotice(null), []);

  // Native bridge: the shell's liquid-glass tab bar navigates this app exactly like
  // the web bottom nav does - it dispatches 'prexpire:navigate' events carrying
  // { to: 'tab:home' | 'tab:items' | 'scan' | ... }, which reuse onNavigate verbatim.
  useEffect(() => {
    if (!WEB || typeof window === 'undefined') return;
    const onShellNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ to?: unknown }>).detail;
      if (typeof detail?.to !== 'string') return;
      onNavigate(detail.to);
    };
    window.addEventListener('prexpire:navigate', onShellNavigate);
    return () => window.removeEventListener('prexpire:navigate', onShellNavigate);
  }, [onNavigate]);

  // Keep the shell's tab bar in sync: report the active tab whenever it
  // changes, so the shell can highlight its active tab. Counts are
  // deliberately NOT reported — the shell's bar shows no badges; the reminder
  // counter lives on the website's own header bell (visible in the WebView).
  // The shell hides its bar only while the scanner screen is open
  // (tab === 'scan'); scrolling never affects it, matching the web bottom nav.
  useEffect(() => {
    if (!WEB || typeof window === 'undefined') return;
    const shell = (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView;
    if (!shell?.postMessage) return;
    try {
      shell.postMessage(JSON.stringify({ type: 'route', tab: route.tab }));
    } catch {
      // The shell went away; navigation still works locally.
    }
  }, [route]);

  // The scanner replaces the tabs (and the bottom nav) while open, so the camera
  // is only mounted, and only running, while the user is scanning. The manual
  // entry route opens the same screen with the form instead of the camera. The
  // key forces a fresh mount when the entry mode changes, so a scan route can
  // never reuse an instance whose props it should have picked up.
  if (route.tab === 'scan')
    return (
      <ScannerScreen
        key={route.manual ? 'manual' : 'scan'}
        onClose={closeScanner}
        onSaved={onSaved}
        initialDetection={nativeScan}
        initialManual={route.manual}
      />
    );

  const screen =
    route.tab === 'items' ? (
      // key: the shopping view and every category get a fresh mount, so a
      // view switch never reuses an instance whose props it should have
      // picked up (the filter starts on the arriving category, shopping
      // starts clean).
      <ItemsScreen key={route.shopping ? 'shopping' : (route.category ?? 'all')} badge={badge} category={route.category} shopping={route.shopping} onNavigate={onNavigate} />
    ) : route.tab === 'reminders' ? (
      <RemindersScreen badge={badge} onNavigate={onNavigate} />
    ) : route.tab === 'settings' ? (
      // key: arriving through settings:categories (Home's Add tile) remounts
      // Settings onto its category page; plain tab:settings opens the root.
      <SettingsScreen key={route.settingsPage ?? 'root'} initialPage={route.settingsPage} badge={badge} onNavigate={onNavigate} />
    ) : (
      <HomeScreen badge={badge} onNavigate={onNavigate} notice={notice} onNoticeDone={clearNotice} />
    );

  return (
    <>
      {/* The in-app expiry alert sits above whichever tab is open (and waits
          while the scanner covers the screen). Each screen reserves space for
          it, so it pushes content instead of covering it. */}
      <ExpiryAlertLayer onNavigate={onNavigate}>{screen}</ExpiryAlertLayer>
      {!inShell && (
        <BottomNav
          active={route.tab}
          insets={insets}
          maxWidth={layout.mode === 'phone' ? 560 : 520}
          onTab={(id) => onNavigate(`tab:${id}`)}
          onScan={() => onNavigate('scan')}
        />
      )}
    </>
  );
}

// Themed chrome: the page background and the status-bar style follow the theme.
function ThemedApp() {
  const c = useTheme();
  const light = c === LIGHT;
  // The shell AROUND the app follows the theme too: on native, the root view
  // behind the app (what shows at launch and behind translucent areas) is
  // re-tinted through expo-system-ui, so Light mode never flashes dark and
  // Dark mode never flashes light; on the web, the page body and the browser's
  // theme-color bar wear the active page colour. Both themes' backgrounds are
  // covered: #030709 on dark, #F8FCFB on light.
  useEffect(() => {
    if (WEB) {
      if (typeof document === 'undefined') return;
      document.body.style.backgroundColor = c.bg;
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', c.bg);
      return;
    }
    SystemUI.setBackgroundColorAsync(c.bg).catch(() => {
      // Not every device supports root background changes; the app still sets
      // its own View background below.
    });
  }, [c]);
  // Native bridge: report the resolved theme (the Dark/Light/System setting,
  // with 'system' already resolved by ThemeProvider) to the Expo shell. Inside
  // the shell's WebView the <StatusBar> below renders nothing — the shell owns
  // the REAL status bar — so this is what tells it to switch: dark text over
  // the light page, light text over the dark one. Sent on mount and on every
  // change; outside a shell there is nothing to report to.
  useEffect(() => {
    if (!WEB || typeof window === 'undefined') return;
    const shell = (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView;
    if (!shell?.postMessage) return;
    try {
      shell.postMessage(JSON.stringify({ type: 'theme', theme: light ? 'light' : 'dark' }));
    } catch {
      // The shell went away; the next change reports again.
    }
  }, [light]);
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {/* expo-status-bar's "style" is the CONTENT colour: light text on the
          dark theme, dark text on the light one. */}
      <StatusBar style={light ? 'dark' : 'light'} />
      <Shell />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <CategoriesProvider>
        <SettingsProvider>
          <ItemsProvider>
            <ShoppingProvider>
              <ThemeProvider>
                <ThemedApp />
              </ThemeProvider>
            </ShoppingProvider>
          </ItemsProvider>
        </SettingsProvider>
      </CategoriesProvider>
    </SafeAreaProvider>
  );
}
