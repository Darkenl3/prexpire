import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { HomeScreen } from './src/screens/HomeScreen';
import { ItemsScreen } from './src/screens/ItemsScreen';
import { RemindersScreen } from './src/screens/RemindersScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ShoppingScreen } from './src/screens/ShoppingScreen';
import { BottomNav, type TabId } from './src/components/HomeComponents';
import { ExpiryAlertLayer } from './src/components/ExpiryAlert';
import { CategoriesProvider, readCustomCategories, useCategories } from './src/categories';
import { CATEGORY_IDS, ItemsProvider, useItems, type CategoryId, type Item } from './src/items';
import { SettingsProvider, useSettings } from './src/settings';
import { ShoppingProvider, useShopping } from './src/shopping';
import { LIGHT, ThemeProvider, useTheme } from './src/theme';
import { remindersDue } from './src/preferences';
import { useLayout } from './src/layout';
import { dayOrderForRegion, parseExpiry } from './src/scanner/dateParser';
import type { Detection } from './src/scanner/useExpiryScanner';

type Route = { tab: TabId; category?: CategoryId; settingsPage?: 'categories' } | { tab: 'scan' };

const TABS: TabId[] = ['home', 'items', 'shop', 'reminders', 'settings'];
const WEB = Platform.OS === 'web';

// On the web the open tab is kept in the address (#settings), so a refresh stays on it.
function routeFromHash(): Route {
  if (!WEB || typeof window === 'undefined') return { tab: 'home' };
  const [tab, category] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (!TABS.includes(tab as TabId)) return { tab: 'home' };
  // Custom categories are read synchronously here: the hash is parsed in a
  // state initialiser, before any context exists.
  const known = CATEGORY_IDS.includes(category) || readCustomCategories().some((c) => c.id === category);
  return { tab: tab as TabId, category: known ? (category as CategoryId) : undefined };
}

function writeHash(route: Route) {
  if (!WEB || typeof window === 'undefined' || route.tab === 'scan') return;
  const hash = route.tab === 'home' ? '' : `#${route.tab}${'category' in route && route.category ? `/${route.category}` : ''}`;
  try {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
  } catch {
    // Sandboxed frames can refuse history changes; the tab still opens.
  }
}

// Keyboard focus rings for the web build (react-native-web leaves them to the browser).
function useFocusStyles() {
  useEffect(() => {
    if (!WEB || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent =
      '[role=button]:focus-visible,[role=radio]:focus-visible,[role=switch]:focus-visible,[role=tab]:focus-visible,[role=link]:focus-visible,input:focus-visible{outline:2px solid #2EE8B6;outline-offset:2px;border-radius:10px}';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
}

function Shell() {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const { items } = useItems();
  const { settings, formatDate } = useSettings();
  const { ids: categoryIds } = useCategories();
  const { toBuyCount } = useShopping();
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
  useEffect(() => {
    if (!WEB || typeof window === 'undefined') return;
    const onNativeScan = (event: Event) => {
      const detail = (event as CustomEvent<{ lines?: unknown }>).detail;
      const lines = Array.isArray(detail?.lines) ? detail.lines.filter((l): l is string => typeof l === 'string') : [];
      if (!lines.length) return;
      const region = typeof navigator !== 'undefined' ? navigator.language.split('-')[1] : undefined;
      const result = parseExpiry(lines, { today: new Date(), preferredOrder: dayOrderForRegion(region) });
      if (result.kind !== 'found') return;
      setNativeScan(result);
      setRoute({ tab: 'scan' });
    };
    window.addEventListener('prexpire:native-scan', onNativeScan);
    return () => window.removeEventListener('prexpire:native-scan', onNativeScan);
  }, []);

  useEffect(() => writeHash(route), [route]);

  const badge = useMemo(
    () => (settings.reminders ? remindersDue(items, settings.reminderLead).length : 0),
    [items, settings.reminders, settings.reminderLead],
  );
  // Open Shopping List entries, shown on the Shopping tab (information, not urgency).
  const shopBadge = useMemo(() => Math.min(toBuyCount, 99), [toBuyCount]);

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
      if (to.startsWith('tab:')) {
        const tab = to.slice(4) as TabId;
        if (TABS.includes(tab)) {
          setRoute({ tab });
          setLastTab(tab);
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

  // The screens report their scroll direction (see navAutohide.tsx) so the browser's
  // own bottom nav can hide on scroll-down and return on scroll-up, YouTube-style.
  // Inside the native shell the glass tab bar follows the same motion via the
  // { type: 'scroll', dir } bridge message the tracker posts directly.
  const [webNavHidden, setWebNavHidden] = useState(false);
  useEffect(() => {
    if (!WEB || typeof window === 'undefined') return;
    const onNavVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ hidden?: unknown }>).detail;
      if (typeof detail?.hidden === 'boolean') setWebNavHidden(detail.hidden);
    };
    window.addEventListener('prexpire:nav', onNavVisibility);
    return () => window.removeEventListener('prexpire:nav', onNavVisibility);
  }, []);

  // Keep the shell's tab bar in sync: report the active tab and the badges
  // whenever either changes, so the shell can highlight its active tab, show
  // the badges, and hide its bar while the scanner screen is open (tab === 'scan').
  useEffect(() => {
    if (!WEB || typeof window === 'undefined') return;
    const shell = (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView;
    if (!shell?.postMessage) return;
    try {
      shell.postMessage(JSON.stringify({ type: 'route', tab: route.tab, badge, shopBadge }));
    } catch {
      // The shell went away; navigation still works locally.
    }
  }, [route, badge, shopBadge]);

  // The scanner replaces the tabs (and the bottom nav) while open, so the camera
  // is only mounted, and only running, while the user is scanning.
  if (route.tab === 'scan') return <ScannerScreen onClose={closeScanner} onSaved={onSaved} initialDetection={nativeScan} />;

  const screen =
    route.tab === 'items' ? (
      <ItemsScreen key={route.category ?? 'all'} badge={badge} category={route.category} onNavigate={onNavigate} />
    ) : route.tab === 'shop' ? (
      <ShoppingScreen badge={badge} onNavigate={onNavigate} />
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
          badge={badge}
          shopBadge={shopBadge}
          hidden={webNavHidden}
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
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      {/* expo-status-bar's "style" is the CONTENT colour: light text on the
          dark theme, dark text on the light one. */}
      <StatusBar style={c === LIGHT ? 'dark' : 'light'} />
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
