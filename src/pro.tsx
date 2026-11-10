import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './auth';

// Prexpire Pro. Free forever: scanning, reminders, backup, everything —
// with FREE_ITEM_LIMIT new items a month and FREE_CUSTOM_CATEGORIES of your
// own categories. Pro removes both limits. Purchases go through Apple, in the iPhone app's shell (RevenueCat,
// src/purchases/proStore.ts there); this side asks over the bridge.
//
// Until the installed app can sell Pro (window.__prexpirePurchases, set by a
// shell with RevenueCat configured) nothing is limited: nobody is ever
// blocked from something they have no way to buy.

// Development only: localStorage "prexpire.devStore" = "1" fakes the iPhone
// app's App Store bridge in a browser (prices, a 7-day trial, buying), so
// the paywall can be seen and tried without a phone.
if (__DEV__ && Platform.OS === 'web' && typeof window !== 'undefined') {
  try {
    if (localStorage.getItem('prexpire.devStore') === '1' && !(window as { ReactNativeWebView?: unknown }).ReactNativeWebView) {
      let active = false;
      const state = () => ({ active, willRenew: active, expiresAt: null, lifetime: false });
      const reply = (d: object) => setTimeout(() => window.dispatchEvent(new CustomEvent('prexpire:iap', { detail: d })), 400);
      (window as { __prexpirePurchases?: number }).__prexpirePurchases = 1;
      (window as { ReactNativeWebView?: Shell }).ReactNativeWebView = {
        postMessage: (raw: string) => {
          const m = JSON.parse(raw) as { type: string; requestId?: string };
          if (m.type === 'iap-plans')
            reply({
              requestId: m.requestId,
              plans: [
                { id: '$rc_monthly', kind: 'monthly', price: '$2.99', priceValue: 2.99, currency: 'USD', perMonth: null, trialDays: 0 },
                { id: '$rc_annual', kind: 'annual', price: '$9.99', priceValue: 9.99, currency: 'USD', perMonth: '$0.83', trialDays: 7 },
                { id: '$rc_lifetime', kind: 'lifetime', price: '$24.99', priceValue: 24.99, currency: 'USD', perMonth: null, trialDays: 0 },
              ],
            });
          else if (m.type === 'iap-buy') (active = true), reply({ requestId: m.requestId, state: state() });
          else if (m.type.startsWith('iap-')) reply({ requestId: m.requestId, state: state() });
        },
      };
    }
  } catch {}
}

// Free: FREE_ITEM_LIMIT new items each calendar month (the count starts
// again on the 1st; using up or deleting an item doesn't give it back), and
// FREE_CUSTOM_CATEGORIES categories of your own. Items already in the app
// are never touched: only adding is paused until the month turns.
export const FREE_ITEM_LIMIT = 20;
export const FREE_CUSTOM_CATEGORIES = 1;

const USAGE_KEY = 'prexpire.proUsage.v1';
type Usage = { month: string; added: number };
const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const usageListeners = new Set<(n: number) => void>();

async function readLocalUsage(): Promise<number> {
  try {
    const u = JSON.parse((await AsyncStorage.getItem(USAGE_KEY)) ?? 'null') as Usage | null;
    return u && u.month === monthOf() && Number.isFinite(u.added) ? u.added : 0;
  } catch {
    return 0;
  }
}

// The iPhone app also keeps the count in the Keychain, which normally
// survives deleting and reinstalling Prexpire (window.__prexpireUsage).
const keychainUsage = () =>
  Platform.OS === 'web' && typeof window !== 'undefined' && !!(window as { __prexpireUsage?: number }).__prexpireUsage && !!shell()?.postMessage;
function askKeychain(type: 'usage-get' | 'usage-set', usage?: Usage): Promise<number> {
  if (!keychainUsage()) return Promise.resolve(0);
  return new Promise((resolve) => {
    const done = (n: number) => {
      window.removeEventListener('prexpire:usage', on);
      clearTimeout(timer);
      resolve(n);
    };
    const on = (e: Event) => {
      const u = (e as CustomEvent<{ usage?: Usage | null }>).detail?.usage;
      done(u && u.month === monthOf() && Number.isFinite(u.added) ? u.added : 0);
    };
    const timer = setTimeout(() => done(0), 1500);
    window.addEventListener('prexpire:usage', on);
    try {
      shell()?.postMessage?.(JSON.stringify({ type, ...(usage ?? {}) }));
    } catch {
      done(0);
    }
  });
}

// This month's count: the highest of this app's storage and the Keychain
// (a reinstall starts the app's storage empty, the Keychain doesn't).
async function readUsage(): Promise<number> {
  const [local, kept] = await Promise.all([readLocalUsage(), askKeychain('usage-get')]);
  if (kept > local) AsyncStorage.setItem(USAGE_KEY, JSON.stringify({ month: monthOf(), added: kept } satisfies Usage)).catch(() => {});
  return Math.max(local, kept);
}

// Called by ItemsProvider after every item added on this phone (items that
// arrive from a backup or another phone don't count again).
export async function noteItemAdded() {
  const n = (await readUsage()) + 1;
  usageListeners.forEach((f) => f(n));
  const usage: Usage = { month: monthOf(), added: n };
  AsyncStorage.setItem(USAGE_KEY, JSON.stringify(usage)).catch(() => {});
  void askKeychain('usage-set', usage);
}

// Items added this month, kept current.
export function useMonthlyAdds(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    readUsage().then((v) => live && setN(v));
    usageListeners.add(setN);
    // The month turning while the app stays open.
    const t = setInterval(() => readUsage().then((v) => live && setN(v)), 60_000);
    return () => {
      live = false;
      usageListeners.delete(setN);
      clearInterval(t);
    };
  }, []);
  return n;
}

// The 1st of next month, for "Resets on …".
export function nextReset(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

export type ProPlan = {
  id: string;
  kind: 'monthly' | 'annual' | 'lifetime' | 'other';
  price: string;
  priceValue: number;
  currency: string;
  perMonth: string | null;
  trialDays: number;
};
export type ProState = { active: boolean; willRenew: boolean; expiresAt: string | null; lifetime: boolean };
// Why the paywall opened: shapes its first line.
export type PaywallReason = 'welcome' | 'limit' | 'categories' | 'settings';

const CACHE_KEY = 'prexpire.pro.v1';
const OFFERED_KEY = 'prexpire.proOffered.v1';

type Shell = { postMessage?: (data: string) => void };
const shell = (): Shell | undefined =>
  Platform.OS === 'web' && typeof window !== 'undefined' ? (window as { ReactNativeWebView?: Shell }).ReactNativeWebView : undefined;
export const purchasesAvailable = () =>
  Platform.OS === 'web' && typeof window !== 'undefined' && !!(window as { __prexpirePurchases?: number }).__prexpirePurchases && !!shell()?.postMessage;

type Reply = { requestId?: string | null; error?: string; cancelled?: boolean; plans?: ProPlan[]; state?: ProState };

let seq = 0;
function ask(type: string, extra: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<Reply> {
  return new Promise((resolve) => {
    const requestId = `iap-${Date.now()}-${++seq}`;
    const done = (r: Reply) => {
      window.removeEventListener('prexpire:iap', on);
      clearTimeout(timer);
      resolve(r);
    };
    const on = (e: Event) => {
      const d = (e as CustomEvent<Reply>).detail;
      if (d?.requestId === requestId) done(d);
    };
    const timer = setTimeout(() => done({ error: 'timeout' }), timeoutMs);
    window.addEventListener('prexpire:iap', on);
    try {
      shell()?.postMessage?.(JSON.stringify({ type, requestId, ...extra }));
    } catch {
      done({ error: 'unavailable' });
    }
  });
}

type ProContext = {
  // The installed app can sell Pro (limits apply only then).
  available: boolean;
  isPro: boolean;
  state: ProState | null;
  plans: ProPlan[] | null;
  loadPlans: () => Promise<void>;
  // Resolves with a sentence when something went wrong; null when bought or
  // when the person closed Apple's sheet (`cancelled` tells which).
  buy: (planId: string) => Promise<{ error: string | null; cancelled: boolean }>;
  restore: () => Promise<{ error: string | null; found: boolean }>;
  manage: () => void;
  paywall: PaywallReason | null;
  openPaywall: (reason: PaywallReason) => void;
  closePaywall: () => void;
};

const Ctx = createContext<ProContext>({
  available: false,
  isPro: false,
  state: null,
  plans: null,
  loadPlans: async () => {},
  buy: async () => ({ error: null, cancelled: true }),
  restore: async () => ({ error: null, found: false }),
  manage: () => {},
  paywall: null,
  openPaywall: () => {},
  closePaywall: () => {},
});

const PROBLEM = "Couldn't reach the App Store. Check your connection and try again.";

export function ProProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [available] = useState(purchasesAvailable);
  const [state, setState] = useState<ProState | null>(null);
  const [plans, setPlans] = useState<ProPlan[] | null>(null);
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const loading = useRef<Promise<void> | null>(null);

  const apply = useCallback((s: ProState | undefined) => {
    if (!s) return;
    setState(s);
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(s)).catch(() => {});
  }, []);

  // The last known state first (works offline), then the App Store's.
  useEffect(() => {
    if (!available) return;
    AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => {
        if (!raw) return;
        const s = JSON.parse(raw) as ProState;
        // A cached subscription past its date isn't trusted offline.
        if (s.active && s.expiresAt && Date.parse(s.expiresAt) < Date.now()) return;
        setState((cur) => cur ?? s);
      })
      .catch(() => {});
    const onPush = (e: Event) => {
      const d = (e as CustomEvent<Reply>).detail;
      if (d && d.requestId == null && d.state) apply(d.state);
    };
    window.addEventListener('prexpire:iap', onPush);
    return () => window.removeEventListener('prexpire:iap', onPush);
  }, [available, apply]);

  // Purchases follow the account: tie them to it on sign-in, back to this
  // device on sign-out.
  useEffect(() => {
    if (!available) return;
    ask('iap-identify', { userId }).then((r) => apply(r.state));
  }, [available, userId, apply]);

  const loadPlans = useCallback(async () => {
    if (!available) return;
    if (!loading.current)
      loading.current = ask('iap-plans').then((r) => {
        loading.current = null;
        if (r.plans) setPlans(r.plans);
      });
    return loading.current;
  }, [available]);

  const buy = useCallback(
    async (planId: string) => {
      const r = await ask('iap-buy', { planId }, 10 * 60_000);
      if (r.cancelled) return { error: null, cancelled: true };
      if (r.error || !r.state) return { error: PROBLEM, cancelled: false };
      apply(r.state);
      return { error: r.state.active ? null : PROBLEM, cancelled: false };
    },
    [apply],
  );

  const restore = useCallback(async () => {
    const r = await ask('iap-restore', {}, 60_000);
    if (r.error || !r.state) return { error: PROBLEM, found: false };
    apply(r.state);
    return { error: null, found: r.state.active };
  }, [apply]);

  const manage = useCallback(() => {
    try {
      shell()?.postMessage?.(JSON.stringify({ type: 'iap-manage' }));
    } catch {}
  }, []);

  const openPaywall = useCallback((reason: PaywallReason) => setPaywall(reason), []);
  const closePaywall = useCallback(() => setPaywall(null), []);

  const isPro = !!state?.active;
  const value = useMemo(
    () => ({ available, isPro, state, plans, loadPlans, buy, restore, manage, paywall, openPaywall, closePaywall }),
    [available, isPro, state, plans, loadPlans, buy, restore, manage, paywall, openPaywall, closePaywall],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePro() {
  return useContext(Ctx);
}

// The free plan's limits, for the screens that add things. itemCount is
// items added this month (useMonthlyAdds).
export function useProLimits(itemCount: number, customCount: number) {
  const { available, isPro } = usePro();
  const limited = available && !isPro;
  return {
    itemsLocked: limited && itemCount >= FREE_ITEM_LIMIT,
    categoriesLocked: limited && customCount >= FREE_CUSTOM_CATEGORIES,
  };
}

// The Pro offer at the end of setup is shown once, ever.
export async function takeWelcomeOffer(): Promise<boolean> {
  if (!purchasesAvailable()) return false;
  try {
    if (await AsyncStorage.getItem(OFFERED_KEY)) return false;
    await AsyncStorage.setItem(OFFERED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
