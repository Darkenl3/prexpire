import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Tint } from './theme';
import { CATEGORY_IDS, CATEGORY_NAMES } from './items';

// The categories the user keeps. A fresh install starts with the five
// built-ins (Food, Medicine, Household, Skincare, Pantry); they are ordinary
// members of "Your categories" now, so the user can remove any of them in
// Settings and bring it back later, next to the folders they add themselves.
// A removed built-in keeps its identity: items already filed in it keep their
// category (and their label), and restoring the built-in brings its tile,
// chip and list back with everything still in place.

export const CATEGORIES_KEY = 'prexpire.categories.v1';
export const REMOVED_KEY = 'prexpire.categoriesRemoved.v1';

export type CustomCategory = {
  // Generated: "cat-<base36 time><random>".
  id: string;
  name: string;
  // An Ionicons glyph name shown on the tile and in rows.
  icon: string;
  // One of the selectable tile gradients (see CUSTOM_TINTS).
  tint: Tint;
};

// Tint choices offered when a category is created: the five original families
// plus the extended palette (the "add" tile gradient is reserved for the
// Add-category tile itself). Previously saved categories keep their tint -
// every one of these keys renders in both themes.
export const CUSTOM_TINTS: Tint[] = [
  'food',
  'medicine',
  'household',
  'skincare',
  'pantry',
  'forest',
  'ocean',
  'teal',
  'lavender',
  'rose',
  'coral',
  'sand',
  'slate',
];

// The icon menu for new categories. Every choice stands for a WHOLE group of
// things people track (Pets, Clothes, Car…), never a single product (an egg,
// a pizza): a category is a folder, and its picture should say what kind of
// folder it is. Clean outline glyphs from Ionicons in the picker; the folder's
// tile shows the matching illustration (components/IconArt.tsx). Grouped as
// food and drink, home and care, then everything else. Every name is verified
// against the installed glyph map, so the picker never renders a blank tile.
// Folders saved with an icon that is no longer offered keep it (and its art).
export const CATEGORY_ICONS = [
  // Food and drink
  'nutrition-outline',
  'snow-outline',
  'pint-outline',
  'cafe-outline',
  'fast-food-outline',
  'basket-outline',
  // Home and care
  'home-outline',
  'restaurant-outline',
  'sparkles-outline',
  'color-fill-outline',
  'leaf-outline',
  'paw-outline',
  'shirt-outline',
  'eyedrop-outline',
  'medkit-outline',
  // Everything else
  'car-outline',
  'battery-charging-outline',
  'laptop-outline',
  'book-outline',
  'pricetag-outline',
  'gift-outline',
  'globe-outline',
  'archive-outline',
  'folder-outline',
] as const;

// What each choice means, read out by screen readers in the picker.
export const CATEGORY_ICON_LABELS: Record<(typeof CATEGORY_ICONS)[number], string> = {
  'nutrition-outline': 'Fruit and vegetables',
  'snow-outline': 'Frozen',
  'pint-outline': 'Drinks',
  'cafe-outline': 'Coffee and tea',
  'fast-food-outline': 'Ready meals',
  'basket-outline': 'Groceries',
  'home-outline': 'Home',
  'restaurant-outline': 'Kitchen',
  'sparkles-outline': 'Cleaning',
  'color-fill-outline': 'DIY and paint',
  'leaf-outline': 'Garden and plants',
  'paw-outline': 'Pets',
  'shirt-outline': 'Clothes',
  'eyedrop-outline': 'Beauty',
  'medkit-outline': 'First aid',
  'car-outline': 'Car',
  'battery-charging-outline': 'Batteries',
  'laptop-outline': 'Electronics',
  'book-outline': 'Documents',
  'pricetag-outline': 'Vouchers and coupons',
  'gift-outline': 'Gifts',
  'globe-outline': 'Travel',
  'archive-outline': 'Storage',
  'folder-outline': 'Other',
};

// The default pick for a new category: a neutral folder.
export const DEFAULT_CATEGORY_ICON = 'folder-outline';

// Old or unknown icon identifiers fall back to the default folder instead of
// rendering a blank glyph, so saved categories always show something sensible.
export function safeCategoryIcon(name: string): string {
  return Ionicons.glyphMap[name as keyof typeof Ionicons.glyphMap] !== undefined ? name : DEFAULT_CATEGORY_ICON;
}

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

function isRemovedList(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((id) => typeof id === 'string' && CATEGORY_IDS.includes(id));
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
  // Built-in ids the user removed (they can be restored at any time).
  removed: string[];
  ready: boolean;
  saveError: boolean;
  // The categories the user keeps: the built-ins they did not remove, then
  // their own folders in the order they were added. The Home grid, list
  // filters and the scanner's chips show exactly these.
  all: CategoryDef[];
  ids: string[];
  // Display name for any category id. Built-in names are known even while
  // removed (their items keep their label); unknown ids fall back to "Other".
  nameOf: (id: string) => string;
  add: (name: string, icon: string, tint: Tint) => CustomCategory | null;
  // Removes a category the user no longer wants: a built-in is remembered in
  // the removed list (restorable), a custom folder is deleted outright.
  remove: (id: string) => void;
  // Brings a removed built-in back where it was.
  restore: (id: string) => void;
  clearAll: () => Promise<void>;
};

const Ctx = createContext<CategoriesContext | null>(null);

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [custom, setCustom] = useState<CustomCategory[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(false);
  // Writes go through these refs so two quick changes never overwrite each other.
  const customRef = useRef<CustomCategory[]>([]);
  const removedRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rawCustom, rawRemoved] = await AsyncStorage.multiGet([CATEGORIES_KEY, REMOVED_KEY]);
        const parsedCustom: unknown = rawCustom[1] ? JSON.parse(rawCustom[1]) : [];
        const parsedRemoved: unknown = rawRemoved[1] ? JSON.parse(rawRemoved[1]) : [];
        const list = Array.isArray(parsedCustom) ? parsedCustom.filter(isCustomCategory) : [];
        const gone = isRemovedList(parsedRemoved) ? parsedRemoved : [];
        if (cancelled) return;
        customRef.current = list;
        removedRef.current = gone;
        setCustom(list);
        setRemoved(gone);
      } catch {
        // Unreadable storage starts with the default set of categories.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (nextCustom: CustomCategory[], nextRemoved: string[]) => {
    customRef.current = nextCustom;
    removedRef.current = nextRemoved;
    setCustom(nextCustom);
    setRemoved(nextRemoved);
    try {
      await AsyncStorage.multiSet([
        [CATEGORIES_KEY, JSON.stringify(nextCustom)],
        [REMOVED_KEY, JSON.stringify(nextRemoved)],
      ]);
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
      void persist([...customRef.current, cat], removedRef.current);
      return cat;
    },
    [persist],
  );

  const remove = useCallback(
    (id: string) => {
      // Items keep their category id: a removed built-in keeps its name for
      // labels and can be restored; a deleted folder's items display as "Other".
      if (CATEGORY_IDS.includes(id)) {
        if (!removedRef.current.includes(id)) void persist(customRef.current, [...removedRef.current, id]);
      } else {
        void persist(
          customRef.current.filter((c) => c.id !== id),
          removedRef.current,
        );
      }
    },
    [persist],
  );

  const restore = useCallback(
    (id: string) => {
      if (!CATEGORY_IDS.includes(id)) return;
      if (removedRef.current.includes(id)) void persist(customRef.current, removedRef.current.filter((x) => x !== id));
    },
    [persist],
  );

  const clearAll = useCallback(async () => {
    await AsyncStorage.multiRemove([CATEGORIES_KEY, REMOVED_KEY]);
    customRef.current = [];
    removedRef.current = [];
    setCustom([]);
    setRemoved([]);
    setSaveError(false);
  }, []);

  const value = useMemo<CategoriesContext>(() => {
    const gone = new Set(removed);
    const all: CategoryDef[] = [
      ...CATEGORY_IDS.filter((id) => !gone.has(id)).map((id) => ({ id, name: CATEGORY_NAMES[id], custom: false })),
      ...custom.map((c) => ({ id: c.id, name: c.name, custom: true })),
    ];
    // Built-in names stay known even while removed, so items filed in a
    // removed built-in keep showing their real category label.
    const names = new Map<string, string>([...Object.entries(CATEGORY_NAMES), ...custom.map((c) => [c.id, c.name] as [string, string])]);
    return {
      custom,
      removed,
      ready,
      saveError,
      all,
      ids: all.map((c) => c.id),
      nameOf: (id: string) => names.get(id) ?? 'Other',
      add,
      remove,
      restore,
      clearAll,
    };
  }, [custom, removed, ready, saveError, add, remove, restore, clearAll]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCategories() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCategories must be used inside CategoriesProvider');
  return ctx;
}
