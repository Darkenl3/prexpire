import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { daysUntil } from './scanner/dateParser';
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
};

const STORAGE_KEY = 'prexpire.items.v1';
const LAST_CATEGORY_KEY = 'prexpire.lastCategory.v1';

function isItem(x: unknown): x is Item {
  const i = x as Item;
  // The category may be a built-in or a custom id; deleted custom ids simply
  // display as "Other" rather than rejecting the stored item.
  return !!i && typeof i.id === 'string' && typeof i.name === 'string' && typeof i.category === 'string' && i.category.length > 0 && i.category.length <= 40 && /^\d{4}-\d{2}-\d{2}$/.test(i.expiresOn);
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
  removeItem: (id: string) => Promise<void>;
  // Deletes every saved item and the remembered category from storage.
  clearSaved: () => Promise<void>;
};

const Ctx = createContext<ItemsContext | null>(null);

export function ItemsProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Item[]>([]);
  const [ready, setReady] = useState(false);
  const [lastCategory, setLastCategory] = useState<CategoryId>('food');
  const { settings } = useSettings();
  // Writes go through this ref so two quick saves never overwrite each other.
  const savedRef = useRef<Item[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [raw, cat] = await AsyncStorage.multiGet([STORAGE_KEY, LAST_CATEGORY_KEY]);
        const parsed: unknown = raw[1] ? JSON.parse(raw[1]) : [];
        const list = Array.isArray(parsed) ? parsed.filter(isItem) : [];
        if (cancelled) return;
        savedRef.current = list;
        setSaved(list);
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

  const removeItem = useCallback(async (id: string) => {
    const next = savedRef.current.filter((i) => i.id !== id);
    if (next.length === savedRef.current.length) return; // unknown id: nothing to do
    // Persist first, exactly like addItem: if the write fails the list on
    // screen keeps the item rather than silently losing it.
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    savedRef.current = next;
    setSaved(next);
  }, []);

  const clearSaved = useCallback(async () => {
    await AsyncStorage.multiRemove([STORAGE_KEY, LAST_CATEGORY_KEY]);
    savedRef.current = [];
    setSaved([]);
    setLastCategory('food');
  }, []);

  const defaultCategory = settings.defaultCategory === 'last' ? lastCategory : settings.defaultCategory;
  const value = useMemo(
    () => ({ items: saved, saved, ready, lastCategory, defaultCategory, addItem, removeItem, clearSaved }),
    [saved, ready, lastCategory, defaultCategory, addItem, removeItem, clearSaved],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useItems() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useItems must be used inside ItemsProvider');
  return ctx;
}

// "Expires in 5 days", "Expires tomorrow", "Expired 2 days ago".
export function expiryPhrase(iso: string, today = new Date()) {
  const days = daysUntil(iso, today);
  if (days < -1) return `Expired ${-days} days ago`;
  if (days === -1) return 'Expired yesterday';
  if (days === 0) return 'Expires today';
  if (days === 1) return 'Expires tomorrow';
  return `Expires in ${days} days`;
}

export function expiryPill(iso: string, today = new Date()) {
  const days = daysUntil(iso, today);
  if (days < 0) return { pill: 'Expired', tone: 'amber' as const };
  if (days === 0) return { pill: 'Today', tone: 'amber' as const };
  return { pill: days === 1 ? '1 day' : `${days} days`, tone: days <= 1 ? ('amber' as const) : ('green' as const) };
}
