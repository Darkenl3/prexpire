import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Tint } from './theme';
import { CATEGORY_IDS, CATEGORY_NAMES } from './items';

// Custom categories ("category folders") the user adds in Settings. They live
// next to the five built-ins everywhere: Home tiles, list filters, the save
// sheet's chips and the default-category setting.

export const CATEGORIES_KEY = 'prexpire.categories.v1';

export type CustomCategory = {
  // Generated: "cat-<base36 time><random>".
  id: string;
  name: string;
  // An Ionicons glyph name shown on the tile and in rows.
  icon: string;
  // One of the five built-in tile gradients.
  tint: Tint;
};

// Tint choices offered when a category is created (the "add" tile gradient is
// reserved for the Add-category tile itself).
export const CUSTOM_TINTS: Tint[] = ['food', 'medicine', 'household', 'skincare', 'pantry'];

// A calm, general-purpose icon set for folders.
export const CATEGORY_ICONS = ['folder', 'leaf', 'paw', 'basket', 'wine', 'cafe', 'bandage', 'water', 'flower', 'shirt', 'car', 'bulb'] as const;

function isCustomCategory(x: unknown): x is CustomCategory {
  const c = x as CustomCategory;
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    c.name.length > 0 &&
    typeof c.icon === 'string' &&
    (CUSTOM_TINTS as string[]).includes(c.tint)
  );
}

// Synchronous read for the web route parser (#items/<id> must resolve after a
// reload, and the hash is read in a state initialiser where context is absent).
export function readCustomCategories(): CustomCategory[] {
  if (Platform.OS !== 'web' || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CATEGORIES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isCustomCategory) : [];
  } catch {
    return [];
  }
}

export type CategoryDef = { id: string; name: string; custom: boolean };

type CategoriesContext = {
  custom: CustomCategory[];
  ready: boolean;
  saveError: boolean;
  // Built-ins first, then the user's own - the order the UI shows them in.
  all: CategoryDef[];
  ids: string[];
  // Display name for any category id (falls back to "Other" for deleted ids).
  nameOf: (id: string) => string;
  add: (name: string, icon: string, tint: Tint) => CustomCategory | null;
  remove: (id: string) => void;
  clearAll: () => Promise<void>;
};

const Ctx = createContext<CategoriesContext | null>(null);

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [custom, setCustom] = useState<CustomCategory[]>([]);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // Writes go through this ref so two quick changes never overwrite each other.
  const current = useRef<CustomCategory[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CATEGORIES_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        const list = Array.isArray(parsed) ? parsed.filter(isCustomCategory) : [];
        if (cancelled) return;
        current.current = list;
        setCustom(list);
      } catch {
        // Unreadable storage starts with no custom categories.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: CustomCategory[]) => {
    current.current = next;
    setCustom(next);
    try {
      await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(next));
      setSaveError(false);
    } catch {
      // The change still applies until the page closes.
      setSaveError(true);
    }
  }, []);

  const add = useCallback(
    (name: string, icon: string, tint: Tint) => {
      const clean = name.trim().slice(0, 24);
      if (!clean || !(CUSTOM_TINTS as string[]).includes(tint)) return null;
      const cat: CustomCategory = {
        id: `cat-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: clean,
        icon,
        tint,
      };
      void persist([...current.current, cat]);
      return cat;
    },
    [persist],
  );

  const remove = useCallback(
    (id: string) => {
      // Items keep their category id; it just displays as "Other" afterwards.
      void persist(current.current.filter((c) => c.id !== id));
    },
    [persist],
  );

  const clearAll = useCallback(async () => {
    await AsyncStorage.removeItem(CATEGORIES_KEY);
    current.current = [];
    setCustom([]);
    setSaveError(false);
  }, []);

  const value = useMemo<CategoriesContext>(() => {
    const all: CategoryDef[] = [
      ...CATEGORY_IDS.map((id) => ({ id, name: CATEGORY_NAMES[id], custom: false })),
      ...custom.map((c) => ({ id: c.id, name: c.name, custom: true })),
    ];
    const names = new Map(all.map((c) => [c.id, c.name]));
    return {
      custom,
      ready,
      saveError,
      all,
      ids: all.map((c) => c.id),
      nameOf: (id: string) => names.get(id) ?? 'Other',
      add,
      remove,
      clearAll,
    };
  }, [custom, ready, saveError, add, remove, clearAll]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCategories() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCategories must be used inside CategoriesProvider');
  return ctx;
}
