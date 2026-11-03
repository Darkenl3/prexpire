import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from './settings';

// Items the user tracks. Every item is real: items added in the app are saved
// on the device with AsyncStorage, and a fresh install or an emptied storage
// starts with zero items (empty states guide the first scan instead). There
// are no sample, demo or placeholder products anywhere in the app.

// Categories: the five built-ins plus any custom "category folders" the user
// adds in Settings (their ids are generated strings like "cat-k2x9a1").
export type CategoryId = 'food' | 'medicine' | 'household' | 'skincare' | 'pantry' | (string & {});

export const CATEGORY_NAMES: Record<string, string> = {
  food: 'Food',
  medicine: 'Medicine',
  household: 'Household',
  skincare: 'Skincare',
  pantry: 'Pantry',
};

// The five built-in ids (custom ones live in src/categories.tsx).
export const CATEGORY_IDS = Object.keys(CATEGORY_NAMES) as CategoryId[];

export type Item = {
  id: string;
  name: string;
  category: CategoryId;
  // YYYY-MM-DD. For month-only dates this is the last day of the month.
  expiresOn: string;
  datePrecision: 'day' | 'month';
  addedAt: string;
  source: 'scan' | 'manual';
  // The EAN/UPC code a native shell scanner decoded for this item, when one
  // was in view (optional: only the shell's save bridge sends it today).
  barcode?: string;
  // The scanned product's retrieved photo (a small data URI, or the database's
  // https URL): the item card's real product image. Absent when no reliable
  // image could be retrieved, in which case the neutral category art stands in.
  image?: string;
  // Set by "Mark as opened": the day it was opened (YYYY-MM-DD), and the date
  // printed on the pack, which expiresOn replaced with the earlier "use within"
  // date (kept so "Not opened" can put it back).
  openedOn?: string;
  printedExpiresOn?: string;
  printedPrecision?: 'day' | 'month';
};

// What happened to an item when it left the list, for the waste stats in
// Settings: used up (Mark as consumed), thrown away expired (removed after
// its date), or simply removed before expiring.
export type HistoryEntry = { at: string; kind: 'used' | 'expired' | 'removed'; category: CategoryId; name: string };
const HISTORY_LIMIT = 3000;

const STORAGE_KEY = 'prexpire.items.v1';
const LAST_CATEGORY_KEY = 'prexpire.lastCategory.v1';
export const HISTORY_KEY = 'prexpire.history.v1';

function isHistoryEntry(x: unknown): x is HistoryEntry {
  const h = x as HistoryEntry;
  return !!h && typeof h.at === 'string' && ['used', 'expired', 'removed'].includes(h.kind) && typeof h.category === 'string' && typeof h.name === 'string';
}

const todayIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function addDaysIso(days: number, d = new Date()) {
  return todayIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

function isItem(x: unknown): x is Item {
  const i = x as Item;
  // The category may be a built-in or a custom id; deleted custom ids simply
  // display as "Other" rather than rejecting the stored item. The optional
  // image is validated as a data URI or https URL (anything else is dropped
  // rather than trusted as an image source).
  const imageOk = (u: unknown) => typeof u !== 'string' || /^data:image\//.test(u) || /^https:\/\//.test(u);
  return (
    !!i &&
    typeof i.id === 'string' &&
    typeof i.name === 'string' &&
    typeof i.category === 'string' &&
    i.category.length > 0 &&
    i.category.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}$/.test(i.expiresOn) &&
    imageOk(i.image)
  );
}

export type NewItem = Omit<Item, 'id' | 'addedAt'>;

type ItemsContext = {
  items: Item[];
  saved: Item[];
  ready: boolean;
  lastCategory: CategoryId;
  // The category new items start in: the one chosen in Settings, or the last one used.
  defaultCategory: CategoryId;
  addItem: (item: NewItem) => Promise<Item>;
  // Deletes one tracked item (the item card's "Remove item" action). The
  // remembered category is untouched: removing a product never changes where
  // the NEXT one starts.
  // 'consumed' (Mark as consumed) counts it as used in the waste stats; a
  // plain removal counts as thrown away when the item had already expired.
  removeItem: (id: string, reason?: 'consumed' | 'removed') => Promise<void>;
  // Marks an item opened today: its date becomes "use within N days" from
  // today, never later than the printed date. Returns the new date.
  openItem: (id: string, days: number) => Promise<string | null>;
  // Undoes Mark as opened: the printed date comes back.
  unopenItem: (id: string) => Promise<void>;
  // Items that have left the list, newest last.
  history: HistoryEntry[];
  // Moves one tracked item to another category (the item card's "Change
  // category" action).
  setItemCategory: (id: string, category: CategoryId) => Promise<void>;
  // Renames one tracked item (the item card's "Rename" action). Names are
  // trimmed and capped like a new item's; an empty name is refused.
  renameItem: (id: string, name: string) => Promise<void>;
  // Moves every item of one category to another (removing a category).
  moveCategory: (from: CategoryId, to: CategoryId) => Promise<void>;
  // Deletes every saved item and the remembered category from storage.
  clearSaved: () => Promise<void>;
};

const Ctx = createContext<ItemsContext | null>(null);

export function ItemsProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Item[]>([]);
  const [ready, setReady] = useState(false);
  const [lastCategory, setLastCategory] = useState<CategoryId>('food');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyRef = useRef<HistoryEntry[]>([]);
  const { settings } = useSettings();
  // Writes go through this ref so two quick saves never overwrite each other.
  const savedRef = useRef<Item[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [raw, cat, hist] = await AsyncStorage.multiGet([STORAGE_KEY, LAST_CATEGORY_KEY, HISTORY_KEY]);
        const parsed: unknown = raw[1] ? JSON.parse(raw[1]) : [];
        const list = Array.isArray(parsed) ? parsed.filter(isItem) : [];
        let past: HistoryEntry[] = [];
        try {
          const h: unknown = hist[1] ? JSON.parse(hist[1]) : [];
          past = Array.isArray(h) ? h.filter(isHistoryEntry) : [];
        } catch {
          // A damaged history only empties the stats.
        }
        if (cancelled) return;
        savedRef.current = list;
        setSaved(list);
        historyRef.current = past;
        setHistory(past);
        if (cat[1] && typeof cat[1] === 'string') setLastCategory(cat[1]);
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

  const addItem = useCallback(async (input: NewItem) => {
    const item: Item = { ...input, id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, addedAt: new Date().toISOString() };
    const next = [...savedRef.current, item];
    // Persist first: if the write fails the caller shows an error and nothing changes on screen.
    await AsyncStorage.multiSet([
      [STORAGE_KEY, JSON.stringify(next)],
      [LAST_CATEGORY_KEY, item.category],
    ]);
    savedRef.current = next;
    setSaved(next);
    setLastCategory(item.category);
    return item;
  }, []);

  const removeItem = useCallback(async (id: string, reason: 'consumed' | 'removed' = 'removed') => {
    const gone = savedRef.current.find((i) => i.id === id);
    if (!gone) return; // unknown id: nothing to do
    const next = savedRef.current.filter((i) => i.id !== id);
    const kind: HistoryEntry['kind'] = reason === 'consumed' ? 'used' : gone.expiresOn < todayIso() ? 'expired' : 'removed';
    const past = [...historyRef.current, { at: new Date().toISOString(), kind, category: gone.category, name: gone.name }].slice(-HISTORY_LIMIT);
    // Persist first, exactly like addItem: if the write fails the list on
    // screen keeps the item rather than silently losing it.
    await AsyncStorage.multiSet([
      [STORAGE_KEY, JSON.stringify(next)],
      [HISTORY_KEY, JSON.stringify(past)],
    ]);
    savedRef.current = next;
    setSaved(next);
    historyRef.current = past;
    setHistory(past);
  }, []);

  const openItem = useCallback(async (id: string, days: number) => {
    const item = savedRef.current.find((i) => i.id === id);
    if (!item) return null;
    const printed = item.printedExpiresOn ?? item.expiresOn;
    const useBy = addDaysIso(Math.max(0, days));
    const earlier = useBy < printed;
    const next = savedRef.current.map((i) =>
      i.id === id
        ? {
            ...i,
            openedOn: todayIso(),
            printedExpiresOn: printed,
            printedPrecision: i.printedPrecision ?? i.datePrecision,
            expiresOn: earlier ? useBy : printed,
            datePrecision: earlier ? ('day' as const) : (i.printedPrecision ?? i.datePrecision),
          }
        : i,
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    savedRef.current = next;
    setSaved(next);
    return earlier ? useBy : printed;
  }, []);

  const unopenItem = useCallback(async (id: string) => {
    const item = savedRef.current.find((i) => i.id === id);
    if (!item?.openedOn) return;
    const next = savedRef.current.map((i) => {
      if (i.id !== id) return i;
      const { openedOn: _o, printedExpiresOn, printedPrecision, ...rest } = i;
      return { ...rest, expiresOn: printedExpiresOn ?? i.expiresOn, datePrecision: printedPrecision ?? i.datePrecision };
    });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    savedRef.current = next;
    setSaved(next);
  }, []);

  const setItemCategory = useCallback(async (id: string, category: CategoryId) => {
    if (!savedRef.current.some((i) => i.id === id && i.category !== category)) return; // unknown id or no change
    const next = savedRef.current.map((i) => (i.id === id ? { ...i, category } : i));
    // Persist first, like the other writes: a failed write leaves the item where it was.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    savedRef.current = next;
    setSaved(next);
  }, []);

  const renameItem = useCallback(async (id: string, name: string) => {
    const clean = name.trim().slice(0, 80);
    if (!clean) throw new Error('empty name');
    if (!savedRef.current.some((i) => i.id === id && i.name !== clean)) return; // unknown id or no change
    const next = savedRef.current.map((i) => (i.id === id ? { ...i, name: clean } : i));
    // Persist first, like the other writes: a failed write keeps the old name.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    savedRef.current = next;
    setSaved(next);
  }, []);

  const moveCategory = useCallback(async (from: CategoryId, to: CategoryId) => {
    if (from === to || !savedRef.current.some((i) => i.category === from)) return;
    const next = savedRef.current.map((i) => (i.category === from ? { ...i, category: to } : i));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    savedRef.current = next;
    setSaved(next);
  }, []);

  const clearSaved = useCallback(async () => {
    await AsyncStorage.multiRemove([STORAGE_KEY, LAST_CATEGORY_KEY, HISTORY_KEY]);
    savedRef.current = [];
    setSaved([]);
    historyRef.current = [];
    setHistory([]);
    setLastCategory('food');
  }, []);

  const defaultCategory = settings.defaultCategory === 'last' ? lastCategory : settings.defaultCategory;
  const value = useMemo(
    () => ({ items: saved, saved, ready, lastCategory, defaultCategory, addItem, removeItem, openItem, unopenItem, history, setItemCategory, renameItem, moveCategory, clearSaved }),
    [saved, ready, lastCategory, defaultCategory, addItem, removeItem, openItem, unopenItem, history, setItemCategory, renameItem, moveCategory, clearSaved],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useItems() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useItems must be used inside ItemsProvider');
  return ctx;
}
