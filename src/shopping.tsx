import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useItems, type Item } from './items';
import { useSettings } from './settings';
import {
  autoAdditions,
  eventKeyFor,
  eventsToPrune,
  isDuplicateManualAdd,
  isExpiringSoon,
  notificationsToShow,
  sanitizeEventStore,
  sanitizeShopping,
  type AlertInfo,
  type EventStore,
  type ShoppingItem,
} from './shoppingLogic';

// Re-exported for the screens (they should not reach into the logic module).
export type { ShoppingItem, ShoppingReason } from './shoppingLogic';

// The Shopping List: what the provider owns, how it persists, and the little
// engine that watches tracked products for expiries.
//
// Storage (AsyncStorage, i.e. localStorage in the browser; the app's only
// source of truth, per device or browser):
//   prexpire.shopping.v1  the list entries
//   prexpire.expevents.v1 everything remembered per expiration event, so
//                         repeated checks, refreshes and restarts never
//                         duplicate an entry or re-show an alert
//
// The engine runs whenever tracked products or settings change, when the app
// comes back to the foreground, and once a minute while it is open (so a date
// rolling over is noticed). It cannot run while the app is fully closed: the
// check simply happens on the next launch, using the stored event state.
//
// "Expiring soon" is the app's existing rule: expired, or within the warning
// period chosen in Settings (the same window behind amber pills, the attention
// card and reminders).

const SHOPPING_KEY = 'prexpire.shopping.v1';
const EVENTS_KEY = 'prexpire.expevents.v1';

type ManualInput = { name: string; category: string; quantity: number };
type ManualResult = { ok: true; item: ShoppingItem } | { ok: false; reason: 'empty' | 'duplicate' };

type ShoppingContext = {
  items: ShoppingItem[];
  ready: boolean;
  // Set when the last save failed; the change still applies until the page is closed.
  saveError: boolean;
  toBuyCount: number;
  addManual: (input: ManualInput) => Promise<ManualResult>;
  setQuantity: (id: string, quantity: number) => void;
  setPurchased: (id: string, purchased: boolean) => void;
  remove: (id: string) => void;
  clearPurchased: () => void;
  // Clears the list and every remembered expiration event (Clear all data).
  clearAll: () => Promise<void>;
  // The expiry alert currently on screen (one at a time; the rest are queued).
  alert: AlertInfo | null;
  // Performs the alert's action without dismissing it, so the card can show
  // the result before it leaves. Returns whether an "add" actually added.
  resolveAlert: (action: 'add' | 'later') => boolean;
  // Takes the current alert off the screen and offers the next one.
  dismissAlert: () => void;
};

const Ctx = createContext<ShoppingContext | null>(null);

export function ShoppingProvider({ children }: { children: ReactNode }) {
  const { items: tracked, ready: itemsReady } = useItems();
  const { settings, ready: settingsReady } = useSettings();
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [events, setEvents] = useState<EventStore>({});
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [alerts, setAlerts] = useState<AlertInfo[]>([]);
  // A nudge for the engine: day rollover while the app is open, or the app
  // returning to the foreground.
  const [tick, setTick] = useState(0);

  // Refs mirror the state so writes never overwrite each other and the engine
  // always reads the latest values without re-running on every change.
  const itemsRef = useRef(items);
  const eventsRef = useRef(events);
  const alertsRef = useRef(alerts);
  itemsRef.current = items;
  eventsRef.current = events;
  alertsRef.current = alerts;
  const trackedRef = useRef(tracked);
  trackedRef.current = tracked;
  const warningDaysRef = useRef(settings.warningDays);
  warningDaysRef.current = settings.warningDays;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rawList, rawEvents] = await AsyncStorage.multiGet([SHOPPING_KEY, EVENTS_KEY]);
        const list = sanitizeShopping(rawList[1] ? JSON.parse(rawList[1]) : []);
        const store = sanitizeEventStore(rawEvents[1] ? JSON.parse(rawEvents[1]) : {});
        if (cancelled) return;
        itemsRef.current = list;
        eventsRef.current = store;
        setItems(list);
        setEvents(store);
      } catch {
        // Unreadable storage starts empty rather than blocking the app.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Writes update the refs synchronously first (so two quick actions, or two
  // additions from one engine run, always build on each other), then persist;
  // a failed save surfaces as saveError while the change still applies.
  const persistItems = useCallback((next: ShoppingItem[]) => {
    itemsRef.current = next;
    setItems(next);
    AsyncStorage.setItem(SHOPPING_KEY, JSON.stringify(next)).then(
      () => setSaveError(false),
      () => setSaveError(true),
    );
  }, []);

  const persistEvents = useCallback((next: EventStore) => {
    eventsRef.current = next;
    setEvents(next);
    AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(next)).then(
      () => setSaveError(false),
      () => setSaveError(true),
    );
  }, []);

  const markEvent = useCallback(
    (key: string, patch: Record<string, unknown>) => {
      persistEvents({ ...eventsRef.current, [key]: { ...eventsRef.current[key], ...patch } });
    },
    [persistEvents],
  );

  // Adds (or finds) the Shopping List entry for a tracked product's current
  // expiration event. Duplicate-safe: if an open entry for the same event
  // already exists it is returned untouched.
  const addForProduct = useCallback(
    (item: Item, via: 'auto' | 'notification'): ShoppingItem => {
      const key = eventKeyFor(item);
      const existing = itemsRef.current.find((s) => s.eventKey === key && !s.purchasedAt);
      if (existing) {
        markEvent(key, { listed: true });
        return existing;
      }
      const entry: ShoppingItem = {
        id: `shop-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: item.name,
        category: item.category,
        quantity: 1,
        reason: 'expiring',
        productId: item.id,
        eventKey: key,
        expiresOn: item.expiresOn,
        addedAt: new Date().toISOString(),
        addedAuto: via === 'auto',
        purchasedAt: null,
      };
      persistItems([...itemsRef.current, entry]);
      markEvent(key, { listed: true });
      return entry;
    },
    [markEvent, persistItems],
  );

  const addManual = useCallback(async (input: ManualInput): Promise<ManualResult> => {
    const name = input.name.trim().slice(0, 80);
    if (!name) return { ok: false, reason: 'empty' };
    if (isDuplicateManualAdd(itemsRef.current, name)) return { ok: false, reason: 'duplicate' };
    const quantity = Math.min(99, Math.max(1, Math.round(input.quantity) || 1));
    const entry: ShoppingItem = {
      id: `shop-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      category: input.category,
      quantity,
      reason: 'manual',
      addedAt: new Date().toISOString(),
      addedAuto: false,
      purchasedAt: null,
    };
    const next = [...itemsRef.current, entry];
    try {
      await AsyncStorage.setItem(SHOPPING_KEY, JSON.stringify(next));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
    itemsRef.current = next;
    setItems(next);
    return { ok: true, item: entry };
  }, []);

  const setQuantity = useCallback(
    (id: string, quantity: number) => {
      const q = Math.min(99, Math.max(1, Math.round(quantity) || 1));
      persistItems(itemsRef.current.map((s) => (s.id === id ? { ...s, quantity: q } : s)));
    },
    [persistItems],
  );

  const setPurchased = useCallback(
    (id: string, purchased: boolean) => {
      persistItems(
        itemsRef.current.map((s) => (s.id === id ? { ...s, purchasedAt: purchased ? new Date().toISOString() : null } : s)),
      );
    },
    [persistItems],
  );

  const remove = useCallback(
    (id: string) => {
      const entry = itemsRef.current.find((s) => s.id === id);
      persistItems(itemsRef.current.filter((s) => s.id !== id));
      // Removing an entry that came from an expiration event dismisses that
      // whole event: it is never re-added automatically and never re-alerted.
      // A genuinely new expiration (a changed date) is a new event and is
      // evaluated on its own.
      if (entry?.eventKey) {
        markEvent(entry.eventKey, { listed: false, autoDismissed: true, notifShown: true, notifAction: 'later' });
      }
    },
    [markEvent, persistItems],
  );

  const clearPurchased = useCallback(() => {
    persistItems(itemsRef.current.filter((s) => !s.purchasedAt));
  }, [persistItems]);

  const clearAll = useCallback(async () => {
    await AsyncStorage.multiRemove([SHOPPING_KEY, EVENTS_KEY]);
    itemsRef.current = [];
    eventsRef.current = {};
    setItems([]);
    setEvents({});
    setAlerts([]);
    setSaveError(false);
  }, []);

  // The engine. Runs once after storage is ready, then whenever tracked
  // products, the relevant settings or the tick change. Its own writes go
  // through refs, so it never re-triggers itself.
  useEffect(() => {
    if (!ready || !itemsReady || !settingsReady) return;
    const today = new Date();

    // Drop event state for products that no longer exist.
    const stale = eventsToPrune(eventsRef.current, tracked);
    if (stale.length) {
      const next = { ...eventsRef.current };
      for (const key of stale) delete next[key];
      persistEvents(next);
    }

    // Automatically add expiring products (the setting defaults to on, and an
    // unsaved preference counts as enabled). Disabling only stops future
    // additions: existing entries stay. Re-enabling picks up anything not yet
    // handled, while events already listed or dismissed stay as they are.
    if (settings.autoShoppingList) {
      for (const item of autoAdditions(tracked, eventsRef.current, itemsRef.current, settings.warningDays, today)) {
        addForProduct(item, 'auto');
      }
    }

    // Queue the one-time expiry alerts (shown only while the app is open).
    if (settings.reminders) {
      const pending = alertsRef.current.map((a) => a.key);
      const notes = notificationsToShow(tracked, eventsRef.current, settings.warningDays, today, pending);
      if (notes.length) {
        const queued: AlertInfo[] = notes.map((i) => ({ key: eventKeyFor(i), itemId: i.id, name: i.name, expiresOn: i.expiresOn }));
        setAlerts((q) => [...q, ...queued]);
      }
    }
  }, [ready, itemsReady, settingsReady, tracked, settings.autoShoppingList, settings.warningDays, settings.reminders, tick, addForProduct, persistEvents]);

  // An alert is marked shown the moment it becomes the one on screen, so a
  // restart never re-offers an alert the user has already seen, while an alert
  // that was still queued is offered again.
  useEffect(() => {
    const head = alerts[0];
    if (!head) return;
    if (!eventsRef.current[head.key]?.notifShown) {
      markEvent(head.key, { notifShown: true });
    }
  }, [alerts, markEvent]);

  // Turning reminders off also drops whatever was queued.
  useEffect(() => {
    if (ready && !settings.reminders) setAlerts([]);
  }, [ready, settings.reminders]);

  // Re-check on foreground returns and once a minute while the app is open,
  // so a date rolling over is noticed without a reload.
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') bump();
    });
    const id = setInterval(bump, 60_000);
    return () => {
      sub.remove();
      clearInterval(id);
    };
  }, []);

  const resolveAlert = useCallback(
    (action: 'add' | 'later'): boolean => {
      const head = alertsRef.current[0];
      if (!head) return false;
      if (action === 'add') {
        // Validate against the live product before adding: it must still
        // exist, its expiry date must be unchanged, it must still be expiring
        // soon, and the event must not already have an open entry.
        const live = trackedRef.current.find((i) => i.id === head.itemId && i.expiresOn === head.expiresOn);
        if (live && isExpiringSoon(live, warningDaysRef.current) && !itemsRef.current.some((s) => s.eventKey === head.key && !s.purchasedAt)) {
          addForProduct(live, 'notification');
          markEvent(head.key, { notifAction: 'added' });
          return true;
        }
        markEvent(head.key, { notifAction: 'later' });
        return false;
      }
      markEvent(head.key, { notifAction: 'later' });
      return true;
    },
    [addForProduct, markEvent],
  );

  const dismissAlert = useCallback(() => {
    setAlerts((q) => q.slice(1));
  }, []);

  const value = useMemo<ShoppingContext>(
    () => ({
      items,
      ready,
      saveError,
      toBuyCount: items.reduce((n, s) => (s.purchasedAt ? n : n + 1), 0),
      addManual,
      setQuantity,
      setPurchased,
      remove,
      clearPurchased,
      clearAll,
      alert: alerts[0] ?? null,
      resolveAlert,
      dismissAlert,
    }),
    [items, ready, saveError, addManual, setQuantity, setPurchased, remove, clearPurchased, clearAll, alerts, resolveAlert, dismissAlert],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShopping() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useShopping must be used inside ShoppingProvider');
  return ctx;
}
