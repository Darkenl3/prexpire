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
// The user's own names for built-ins ({ food: "Fridge" }) and the order of
// every category they keep (ids; unlisted ones follow in the default order).
export const NAMES_KEY = 'prexpire.categoryNames.v1';
export const ORDER_KEY = 'prexpire.categoryOrder.v1';
// A preset's own look ({ food: { icon: 'paw-outline', tint: 'ocean' } }): the
// icon and colour can change, the name can't. No entry = the original art
// and colour.
export const LOOKS_KEY = 'prexpire.categoryLooks.v1';
export type PresetLook = { icon?: string; tint?: Tint };

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
  'sky',
  'mint',
  'lime',
  'sunflower',
  'cherry',
  'plum',
  'indigo',
  'graphite',
];

// The icon menu for new categories. Every choice stands for a WHOLE group of
// things people track (Pets, Clothes, Car…): an egg stands for dairy and eggs,
// a pizza for snacks. A category is a folder, and its picture should say what kind of
// folder it is. Clean outline glyphs from Ionicons in the picker; the folder's
// tile shows the matching illustration (components/IconArt.tsx). Grouped as
// food and drink, home and care, then everything else. Every name is verified
// against the installed glyph map, so the picker never renders a blank tile.
// Folders saved with an icon that is no longer offered keep it (and its art).
export const CATEGORY_ICONS = [
  // Food and drink
  'restaurant-outline',
  'nutrition-outline',
  'apple',
  'dairy',
  'snow-outline',
  'pint-outline',
  'cafe-outline',
  'fast-food-outline',
  'basket-outline',
  'jar',
  'egg-outline',
  'fish-outline',
  'pizza-outline',
  'ice-cream-outline',
  'wine-outline',
  'water-outline',
  // Home and care
  'home-outline',
  'sparkles-outline',
  'color-fill-outline',
  'leaf-outline',
  'paw-outline',
  'shirt-outline',
  'pump',
  'eyedrop-outline',
  'capsule',
  'medkit-outline',
  'flower-outline',
  'brush-outline',
  'bandage-outline',
  'thermometer-outline',
  'bulb-outline',
  // Everything else
  'car-outline',
  'battery-charging-outline',
  'laptop-outline',
  'book-outline',
  'pricetag-outline',
  'gift-outline',
  'globe-outline',
  'tv-outline',
  'headset-outline',
  'hardware-chip-outline',
  'watch-outline',
  'key-outline',
  'balloon-outline',
  'cube-outline',
  'archive-outline',
  'folder-outline',
] as const;

// What each choice means, read out by screen readers in the picker.
export const CATEGORY_ICON_LABELS: Record<(typeof CATEGORY_ICONS)[number], string> = {
  'nutrition-outline': 'Vegetables',
  apple: 'Fruit',
  dairy: 'Dairy',
  jar: 'Pantry',
  pump: 'Skincare',
  capsule: 'Medicine',
  'snow-outline': 'Frozen',
  'pint-outline': 'Drinks',
  'cafe-outline': 'Coffee and tea',
  'fast-food-outline': 'Ready meals',
  'basket-outline': 'Groceries',
  'home-outline': 'Home',
  'restaurant-outline': 'Food',
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
  'egg-outline': 'Dairy and eggs',
  'fish-outline': 'Meat and fish',
  'pizza-outline': 'Snacks',
  'ice-cream-outline': 'Desserts',
  'wine-outline': 'Wine and spirits',
  'water-outline': 'Water',
  'flower-outline': 'Flowers',
  'brush-outline': 'Art supplies',
  'bandage-outline': 'Plasters',
  'thermometer-outline': 'Health',
  'bulb-outline': 'Light bulbs',
  'tv-outline': 'Appliances',
  'headset-outline': 'Audio',
  'hardware-chip-outline': 'Tech parts',
  'watch-outline': 'Accessories',
  'key-outline': 'Keys and passes',
  'balloon-outline': 'Party',
  'cube-outline': 'Packages',
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

function isNameMap(x: unknown): x is Record<string, string> {
  return !!x && typeof x === 'object' && !Array.isArray(x) && Object.entries(x).every(([k, v]) => CATEGORY_IDS.includes(k) && typeof v === 'string' && v.length > 0);
}

function isLookMap(x: unknown): x is Record<string, PresetLook> {
  return (
    !!x &&
    typeof x === 'object' &&
    !Array.isArray(x) &&
    Object.entries(x).every(
      ([k, v]) =>
        CATEGORY_IDS.includes(k) &&
        !!v &&
        typeof v === 'object' &&
        (v.icon === undefined || typeof v.icon === 'string') &&
        (v.tint === undefined || (CUSTOM_TINTS as string[]).includes(v.tint)),
    )
  );
}

function isIdList(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((id) => typeof id === 'string');
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

// Each preset's original tile colour (data.ts), for "back to the original".
const PRESET_TINT: Record<string, Tint> = { food: 'food', medicine: 'medicine', household: 'household', skincare: 'skincare', pantry: 'pantry' };
export function presetTint(id: string): Tint | undefined {
  return PRESET_TINT[id];
}

// Each preset's own picture: an ordinary icon from CATEGORY_ICONS, so the
// picker shows it chosen like any other (Food is a plate with cutlery, food
// of any kind; the carrot and apple are free for Vegetables and Fruit).
const PRESET_ICON: Record<string, string> = { food: 'restaurant-outline', medicine: 'capsule', household: 'home-outline', skincare: 'pump', pantry: 'jar' };
export function presetIcon(id: string): string | undefined {
  return PRESET_ICON[id];
}

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
  // A preset's chosen icon and colour (undefined = its original look).
  lookOf: (id: string) => PresetLook;
  add: (name: string, icon: string, tint: Tint) => CustomCategory | null;
  // Changes a category the user keeps: a folder's name, icon and colour, or
  // a built-in's name (its artwork and colour stay). False for an empty name.
  edit: (id: string, change: { name: string; icon?: string; tint?: Tint }) => boolean;
  // Moves a category one place earlier (-1) or later (+1) in every list.
  move: (id: string, by: -1 | 1) => void;
  // Moves a category to a position in the order (drag to reorder).
  moveTo: (id: string, index: number) => void;
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
  const [names, setNames] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [looks, setLooks] = useState<Record<string, PresetLook>>({});
  const looksRef = useRef<Record<string, PresetLook>>({});
  // Writes go through these refs so two quick changes never overwrite each other.
  const customRef = useRef<CustomCategory[]>([]);
  const removedRef = useRef<string[]>([]);
  const namesRef = useRef<Record<string, string>>({});
  const orderRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rawCustom, rawRemoved, rawNames, rawOrder, rawLooks] = await AsyncStorage.multiGet([CATEGORIES_KEY, REMOVED_KEY, NAMES_KEY, ORDER_KEY, LOOKS_KEY]);
        const parse = (raw: string | null, fallback: unknown): unknown => {
          try {
            return raw ? JSON.parse(raw) : fallback;
          } catch {
            return fallback;
          }
        };
        const parsedCustom = parse(rawCustom[1], []);
        const parsedRemoved = parse(rawRemoved[1], []);
        const parsedNames = parse(rawNames[1], {});
        const parsedOrder = parse(rawOrder[1], []);
        const parsedLooks = parse(rawLooks[1], {});
        const list = Array.isArray(parsedCustom) ? parsedCustom.filter(isCustomCategory) : [];
        const gone = isRemovedList(parsedRemoved) ? parsedRemoved : [];
        const renamed = isNameMap(parsedNames) ? parsedNames : {};
        const ordered = isIdList(parsedOrder) ? parsedOrder : [];
        const styled = isLookMap(parsedLooks) ? parsedLooks : {};
        if (cancelled) return;
        looksRef.current = styled;
        setLooks(styled);
        customRef.current = list;
        removedRef.current = gone;
        namesRef.current = renamed;
        orderRef.current = ordered;
        setCustom(list);
        setRemoved(gone);
        setNames(renamed);
        setOrder(ordered);
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

  const persist = useCallback(
    async (nextCustom: CustomCategory[], nextRemoved: string[], nextNames = namesRef.current, nextOrder = orderRef.current) => {
      customRef.current = nextCustom;
      removedRef.current = nextRemoved;
      namesRef.current = nextNames;
      orderRef.current = nextOrder;
      setCustom(nextCustom);
      setRemoved(nextRemoved);
      setNames(nextNames);
      setOrder(nextOrder);
      try {
        await AsyncStorage.multiSet([
          [CATEGORIES_KEY, JSON.stringify(nextCustom)],
          [REMOVED_KEY, JSON.stringify(nextRemoved)],
          [NAMES_KEY, JSON.stringify(nextNames)],
          [ORDER_KEY, JSON.stringify(nextOrder)],
        ]);
      setSaveError(false);
    } catch {
      // The change still applies until the page closes.
        setSaveError(true);
      }
    },
    [],
  );

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

  const edit = useCallback(
    (id: string, change: { name: string; icon?: string; tint?: Tint }) => {
      if (CATEGORY_IDS.includes(id)) {
        // A preset: only its look changes (its name is fixed, so a preset
        // can never stand in for a category of your own). An empty icon or
        // the preset's own colour means "original", and drops the entry.
        const look: PresetLook = {};
        if (change.icon && change.icon !== PRESET_ICON[id]) look.icon = change.icon;
        if (change.tint && (CUSTOM_TINTS as string[]).includes(change.tint) && change.tint !== PRESET_TINT[id]) look.tint = change.tint;
        const next = { ...looksRef.current };
        if (look.icon || look.tint) next[id] = look;
        else delete next[id];
        looksRef.current = next;
        setLooks(next);
        AsyncStorage.setItem(LOOKS_KEY, JSON.stringify(next))
          .then(() => setSaveError(false))
          .catch(() => setSaveError(true));
        return true;
      }
      const clean = change.name.trim().slice(0, 24);
      if (!clean) return false;
      if (!customRef.current.some((c) => c.id === id)) return false;
      const tint = change.tint && (CUSTOM_TINTS as string[]).includes(change.tint) ? change.tint : undefined;
      void persist(
        customRef.current.map((c) => (c.id === id ? { ...c, name: clean, icon: change.icon ?? c.icon, tint: tint ?? c.tint } : c)),
        removedRef.current,
      );
      return true;
    },
    [persist],
  );

  const move = useCallback(
    (id: string, by: -1 | 1) => {
      // The order is written out in full for what is shown right now, so a
      // move always lands exactly one place over.
      const ids = orderedIds(customRef.current, removedRef.current, orderRef.current);
      const at = ids.indexOf(id);
      const to = at + by;
      if (at < 0 || to < 0 || to >= ids.length) return;
      [ids[at], ids[to]] = [ids[to], ids[at]];
      void persist(customRef.current, removedRef.current, namesRef.current, ids);
    },
    [persist],
  );

  const moveTo = useCallback(
    (id: string, index: number) => {
      const ids = orderedIds(customRef.current, removedRef.current, orderRef.current);
      const at = ids.indexOf(id);
      const to = Math.max(0, Math.min(ids.length - 1, index));
      if (at < 0 || at === to) return;
      ids.splice(at, 1);
      ids.splice(to, 0, id);
      void persist(customRef.current, removedRef.current, namesRef.current, ids);
    },
    [persist],
  );

  const clearAll = useCallback(async () => {
    await AsyncStorage.multiRemove([CATEGORIES_KEY, REMOVED_KEY, NAMES_KEY, ORDER_KEY, LOOKS_KEY]);
    looksRef.current = {};
    setLooks({});
    customRef.current = [];
    removedRef.current = [];
    namesRef.current = {};
    orderRef.current = [];
    setCustom([]);
    setRemoved([]);
    setNames({});
    setOrder([]);
    setSaveError(false);
  }, []);

  const value = useMemo<CategoriesContext>(() => {
    // Built-in names stay known even while removed, so items filed in a
    // removed built-in keep showing their real category label (the user's
    // own name for it when they gave one).
    // Preset names are fixed (only their icon and colour can change).
    const nameMap = new Map<string, string>([
      ...Object.entries(CATEGORY_NAMES),
      ...custom.map((c) => [c.id, c.name] as [string, string]),
    ]);
    const all: CategoryDef[] = orderedIds(custom, removed, order).map((id) => ({
      id,
      name: nameMap.get(id) ?? 'Other',
      custom: !CATEGORY_IDS.includes(id),
    }));
    return {
      custom,
      removed,
      ready,
      saveError,
      all,
      ids: all.map((c) => c.id),
      nameOf: (id: string) => nameMap.get(id) ?? 'Other',
      lookOf: (id: string) => looks[id] ?? {},
      add,
      edit,
      move,
      moveTo,
      remove,
      restore,
      clearAll,
    };
  }, [custom, removed, order, looks, ready, saveError, add, edit, move, moveTo, remove, restore, clearAll]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Every category the user keeps, in their order: ids they placed come first
// as placed, the rest (new folders, restored built-ins) follow in the default
// order, built-ins then folders by creation.
function orderedIds(custom: CustomCategory[], removed: string[], order: string[]): string[] {
  const gone = new Set(removed);
  const kept = [...CATEGORY_IDS.filter((id) => !gone.has(id)), ...custom.map((c) => c.id)];
  const keptSet = new Set(kept);
  const placed = order.filter((id, i) => keptSet.has(id) && order.indexOf(id) === i);
  const placedSet = new Set(placed);
  return [...placed, ...kept.filter((id) => !placedSet.has(id))];
}

export function useCategories() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCategories must be used inside CategoriesProvider');
  return ctx;
}
