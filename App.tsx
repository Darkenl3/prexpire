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
import WelcomeScreen from './src/screens/WelcomeScreen';
import { AccountDeletedSheet, DeletionPendingSheet, SignInSheet } from './src/components/SignInSheet';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BottomNav, type TabId } from './src/components/HomeComponents';
import { ExpiryAlertLayer } from './src/components/ExpiryAlert';
import { CategoriesProvider, presetIcon, readCustomCategories, useCategories } from './src/categories';
import { CATEGORY_IDS, ItemsProvider, useItems, type CategoryId, type Item } from './src/items';
import { SettingsProvider, useSettings } from './src/settings';
import { AuthProvider, useAuth } from './src/auth';
import { planReminders, wasteRisk } from './src/reminderPlan';
import { nativeReminders, notificationStatus, requestNotificationPermission, scheduleReminders } from './src/platform/notifications';
import { SyncProvider } from './src/sync';
import { ProProvider, takeWelcomeOffer, useMonthlyAdds, usePro, useProLimits } from './src/pro';
import { Paywall } from './src/components/Paywall';
import { UpdateNotice, checkForUpdate, maybeAskForRating, noteAppUsed } from './src/appStore';
import { ShoppingProvider } from './src/shopping';
import { LIGHT, ThemeProvider, useTheme } from './src/theme';
import { remindersDue, dayOrderForFormat, warningFor } from './src/preferences';
import { buildWidgetReport } from './src/widgetReport';
import { useLayout } from './src/layout';
import { dayOrderForRegion, parseExpiry } from './src/scanner/dateParser';
import type { Detection } from './src/scanner/useExpiryScanner';

type Route = { tab: TabId; category?: CategoryId; shopping?: boolean; settingsPage?: 'categories' | 'signin' } | { tab: 'scan'; manual?: boolean };

const TABS: TabId[] = ['home', 'items', 'reminders', 'settings'];
const WEB = Platform.OS === 'web';

// iOS zooms the page into a text field when it's tapped (and leaves it
// zoomed). maximum-scale=1 stops that focus zoom; iOS still lets people pinch
// to zoom, so it costs no accessibility.
if (WEB && typeof document !== 'undefined') {
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta && !/maximum-scale/.test(meta.getAttribute('content') ?? '')) {
    meta.setAttribute('content', `${meta.getAttribute('content')}, maximum-scale=1, viewport-fit=cover`);
  }
}

// Set once the get-started screen has been answered (or skipped because the
// person already had items), so it shows on a fresh install only.
const WELCOME_KEY = 'prexpire.welcomed.v1';

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
// page, the deep readable green on the light one. Text fields are NOT ringed:
// each one sits inside its own rounded box, which turns lime itself while the
// field is active — a browser ring on top drew a second, inner box.
function useFocusStyles() {
  const t = useTheme();
  useEffect(() => {
    if (!WEB || typeof document === 'undefined') return;
    const ring = t === LIGHT ? t.green : t.mint;
    const style = document.createElement('style');
    style.textContent =
      '[role=button]:focus-visible,[role=radio]:focus-visible,[role=switch]:focus-visible,[role=tab]:focus-visible,[role=link]:focus-visible{outline:2px solid ' +
      ring +
      ';outline-offset:2px;border-radius:10px}' +
      'input,input:focus,input:focus-visible,textarea,textarea:focus,textarea:focus-visible{outline:none}';
    document.head.appendChild(style);
    return () => style.remove();
  }, [t]);
}

function Shell() {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const { items, ready: itemsReady, defaultCategory, addItem, history } = useItems();
  // The App Store: remember the days the app is used (for a well-timed rating
  // request) and check for a newer version once a day.
  useEffect(() => {
    noteAppUsed();
    checkForUpdate();
  }, []);
  const { settings, formatDate } = useSettings();
  // The get-started screen: 'show' on a fresh install, 'done' once answered,
  // 'unknown' for the moment it takes to read storage. Anyone who already has
  // items is an existing user: marked done without ever seeing it.
  const [welcome, setWelcome] = useState<'unknown' | 'show' | 'done'>('unknown');
  const [welcomeSignIn, setWelcomeSignIn] = useState(false);
  // After setup (and its Pro offer), an invitation to keep the items safe in
  // a free account: without one they live only on this phone.
  const [askSignup, setAskSignup] = useState(false);
  useEffect(() => {
    if (!itemsReady || welcome !== 'unknown') return;
    let cancelled = false;
    AsyncStorage.getItem(WELCOME_KEY)
      .then((seen) => {
        if (cancelled) return;
        if (seen || items.length > 0) {
          if (!seen) AsyncStorage.setItem(WELCOME_KEY, '1').catch(() => {});
          setWelcome('done');
        } else setWelcome('show');
      })
      .catch(() => !cancelled && setWelcome('done'));
    return () => {
      cancelled = true;
    };
  }, [itemsReady, items.length, welcome]);
  const { ids: categoryIds, all: allCategories, custom: customCategories, lookOf } = useCategories();
  const { openPaywall, paywall } = usePro();
  const { session } = useAuth();
  const signedInRef = useRef(!!session);
  signedInRef.current = !!session;
  const addedThisMonth = useMonthlyAdds();
  const { itemsLocked } = useProLimits(addedThisMonth, customCategories.length);
  const finishWelcome = useCallback(() => {
    setWelcome('done');
    AsyncStorage.setItem(WELCOME_KEY, '1').catch(() => {});
    (async () => {
      // 1. Reminders are the point of the app: iPhone's "Allow
      //    notifications?" comes first, right as setup ends. Its answer is
      //    awaited, so nothing opens underneath it.
      if (nativeReminders() && notificationStatus() === 'default') {
        try {
          localStorage.setItem('prexpire.notifAsked.v1', '1');
        } catch {}
        await new Promise((r) => setTimeout(r, 400));
        await requestNotificationPermission();
      }
      // 2. The Pro offer, once. 3. Then (closed, or no offer) the account
      //    invitation.
      const offer = await takeWelcomeOffer();
      if (offer) setTimeout(() => openPaywall('welcome'), 350);
      else if (!signedInRef.current) setTimeout(() => setAskSignup(true), 500);
    })();
  }, [openPaywall]);
  // The setup offer closed (bought or skipped): next, the account invitation.
  const lastPaywall = useRef(paywall);
  useEffect(() => {
    if (lastPaywall.current === 'welcome' && !paywall && !signedInRef.current) setTimeout(() => setAskSignup(true), 450);
    lastPaywall.current = paywall;
  }, [paywall]);
  // The free plan is full: the shell's scan button opens the offer instead.
  useEffect(() => {
    const shell = WEB && typeof window !== 'undefined' ? (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView : undefined;
    try {
      shell?.postMessage?.(JSON.stringify({ type: 'scan-lock', locked: itemsLocked }));
    } catch {}
  }, [itemsLocked]);
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
    // The iPhone scanner's chips draw outline glyphs: picture-only names
    // (apple, capsule, pump, jar) leave it to the scanner's own glyph.
    const glyph = (icon?: string) => (icon && icon.endsWith('-outline') ? icon : undefined);
    return allCategories.map((c) => ({ id: c.id, name: c.name, icon: glyph(iconById.get(c.id) ?? lookOf(c.id).icon) }));
  }, [allCategories, customCategories, lookOf]);
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

  // The iPhone home-screen widgets: the shell gets the raw facts whenever
  // items, history or categories change (src/widgetReport.ts).
  useEffect(() => {
    if (!inShell || !itemsReady || typeof window === 'undefined') return;
    const w = window as { __prexpireWidgets?: number; ReactNativeWebView?: { postMessage?: (data: string) => void } };
    if (!w.__prexpireWidgets || !w.ReactNativeWebView?.postMessage) return;
    const t = setTimeout(() => {
      const iconById = new Map(customCategories.map((c) => [c.id, c.icon] as const));
      const report = buildWidgetReport(
        items,
        history,
        (category) => warningFor(settings, category),
        (category) => iconById.get(category) ?? lookOf(category).icon ?? presetIcon(category) ?? 'folder-outline',
        new Date(),
      );
      try {
        w.ReactNativeWebView?.postMessage?.(JSON.stringify({ type: 'widgets', report }));
      } catch {
        // The shell went away; the next change reports again.
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [inShell, itemsReady, items, history, settings, customCategories, lookOf]);

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
      maybeAskForRating(items.length + 1 + history.length);
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
    [formatDate, items.length, history.length],
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

  // Expiry reminders, automatically: whenever items or reminder settings
  // change (and every time the app opens), the iPhone app gets the full plan
  // and reschedules. Permission is asked when setup ends (finishWelcome);
  // anyone who set up before that is asked once at their first item.
  // Categories you often throw away get an earlier heads-up (Waste stats).
  const risk = useMemo(() => {
    const nameById = new Map(allCategories.map((c) => [c.id, c.name] as const));
    return wasteRisk(history, items, (id) => nameById.get(id) ?? 'items');
  }, [history, items, allCategories]);
  useEffect(() => {
    if (!nativeReminders()) return;
    const t = setTimeout(() => scheduleReminders(planReminders(items, settings, new Date(), risk)), 800);
    return () => clearTimeout(t);
  }, [items, settings, risk]);
  useEffect(() => {
    if (!nativeReminders() || items.length === 0) return;
    let asked = false;
    try {
      asked = localStorage.getItem('prexpire.notifAsked.v1') === '1';
      if (!asked) localStorage.setItem('prexpire.notifAsked.v1', '1');
    } catch {}
    if (asked || notificationStatus() !== 'default') return;
    // A moment after the save confirmation, then reschedule with permission.
    const t = setTimeout(() => {
      requestNotificationPermission().then((s) => s === 'granted' && scheduleReminders(planReminders(items, settings, new Date(), risk)));
    }, 1500);
    return () => clearTimeout(t);
  }, [items.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const badge = useMemo(
    () => (settings.reminders ? remindersDue(items, settings.reminderLead).length : 0),
    [items, settings.reminders, settings.reminderLead],
  );

  const onNavigate = useCallback(
    (to: string) => {
      if (to === 'paywall' || to.startsWith('paywall:')) return openPaywall(to === 'paywall:limit' ? 'limit' : 'settings');
      if ((to === 'scan' || to === 'manual') && itemsLocked) return openPaywall('limit');
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
    [categoryIds, itemsLocked, openPaywall],
  );
  const closeScanner = useCallback(() => {
    setNativeScan(null);
    setRoute({ tab: lastTab });
  }, [lastTab]);
  const onSaved = useCallback(
    (item: Item) => {
      maybeAskForRating(items.length + 1 + history.length);
      setNativeScan(null);
      setNotice(`${item.name} added · expires ${formatDate(item.expiresOn, item.datePrecision)}`);
      setRoute({ tab: 'home' });
      setLastTab('home');
    },
    [formatDate, items.length, history.length],
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
      // While the get-started screen is up it reports the scanner route: the
      // one route on which the shell hides its glass tab bar and switches the
      // status bar to light text (the screen is dark green in both themes).
      // The Pro paywall does the same: it's full screen and dark in both
      // themes, so the shell's tab bar steps aside (any app build).
      shell.postMessage(JSON.stringify({ type: 'route', tab: welcome === 'show' || paywall ? 'scan' : route.tab }));
    } catch {
      // The shell went away; navigation still works locally.
    }
  }, [route, welcome, paywall]);

  // First launch: one get-started screen, then straight into the app. Until
  // storage answers, a plain page (no flash of Home before it).
  if (welcome === 'unknown') return <View style={{ flex: 1 }} />;
  if (welcome === 'show')
    return (
      <>
        <WelcomeScreen onStart={finishWelcome} onSignIn={() => setWelcomeSignIn(true)} />
        {/* Sign-in opens ON the get-started screen: backing out (or cancelling
            Apple/Google) returns here; only a finished sign-in goes in. */}
        <SignInSheet
          visible={welcomeSignIn}
          onClose={() => setWelcomeSignIn(false)}
          onSignedIn={() => {
            setWelcomeSignIn(false);
            finishWelcome();
          }}
        />
      </>
    );

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
      <SignInSheet visible={askSignup && !session} onClose={() => setAskSignup(false)} onSignedIn={() => setAskSignup(false)} initialMode="signup" intro={KEEP_SAFE} />
    </>
  );
}

const KEEP_SAFE = {
  title: 'Keep your items safe',
  text: "Without an account, your items live only on this phone. Create a free account and a lost, broken or new phone never loses them.",
};

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
      {/* Signed in to an account scheduled for deletion: restore it or leave. */}
      <DeletionPendingSheet />
      <AccountDeletedSheet />
      <UpdateNotice />
      <Paywall />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      {/* The account sits above the data: sync reads and writes the same
          storage the providers below use, and when changes from another
          phone arrive it bumps `generation`, so they reload from storage. */}
      <AuthProvider>
        <ProProvider>
        <SyncProvider>
          {(generation) => (
            <CategoriesProvider key={generation}>
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
          )}
        </SyncProvider>
        </ProProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
