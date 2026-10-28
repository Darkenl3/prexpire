import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { useSettings } from './settings';

// The app's design language: a near-black teal dark theme and a soft paper
// light theme with the same mint accent. Everything visual reads from the
// active palette through useTheme()/makeStyles, so the whole app (and the
// status bar) follows the Dark/Light/System setting.

export type Palette = {
  bg: string;
  surface: string;
  surfaceBorder: string;
  text: string;
  textMuted: string;
  mint: string;
  scan: string;
  scanInk: string;
  amber: string;
  amberText: string;
  green: string;
  red: string;
  navBg: string;
  navBorder: string;
  iconTile: string;
  // Secondary surfaces and tints that need their own light values.
  cardAlt: string; // chips and small buttons
  separator: string; // hairlines inside cards
  chipOnBg: string;
  chipOnBorder: string;
  btnMintBg: string;
  btnMintBorder: string;
  btnDangerBg: string;
  btnDangerBorder: string;
  // Category tile colours: rich gradients on dark, soft pastels on light.
  tints: Record<Tint, { top: string; bottom: string; border: string }>;
  // The "Add category" tile: a plain card with a dashed outline.
  addTile: { bg: string; border: string };
  alertBg: string;
  alertBorder: string;
  alertIconBg: string;
  dangerBg: string;
  dangerBorder: string;
  dialogBg: string;
  toastBg: string;
  toastBorder: string;
  statusOkBorder: string;
  statusOkBg: string;
  statusWarnBorder: string;
  statusWarnBg: string;
  glassBg: string; // the header's liquid-glass circles
  glassBorder: string;
  pills: Record<Tone, { bg: string; text: string }>;
  switchColors: { track: string; trackOn: string; thumb: string; thumbOn: string };
};

export const DARK: Palette = {
  bg: '#050D10',
  surface: '#0B161A',
  surfaceBorder: '#1A2A2E',
  text: '#F2F6F7',
  textMuted: '#9AA7AD',
  mint: '#2EE8B6',
  scan: '#41F8C5',
  scanInk: '#04241B',
  amber: '#FEC22D',
  amberText: '#F5B83D',
  green: '#2BD9A0',
  red: '#FF3B4E',
  navBg: 'rgba(12,24,27,0.72)',
  navBorder: 'rgba(255,255,255,0.10)',
  iconTile: '#1C2C35',
  cardAlt: '#0F1E22',
  separator: '#22353A',
  chipOnBg: 'rgba(46,232,182,0.10)',
  chipOnBorder: 'rgba(46,232,182,0.55)',
  btnMintBg: 'rgba(46,232,182,0.08)',
  btnMintBorder: 'rgba(46,232,182,0.45)',
  btnDangerBg: 'rgba(248,113,113,0.08)',
  btnDangerBorder: 'rgba(248,113,113,0.45)',
  // The "items need attention" card is RED in both themes — urgency reads
  // the same in light and dark, like a warning triangle on any dashboard.
  alertBg: '#2A1216',
  alertBorder: '#5A2530',
  alertIconBg: '#461B22',
  dangerBg: '#140F12',
  dangerBorder: '#4A2328',
  dialogBg: '#0E1A1E',
  toastBg: '#0D2E28',
  toastBorder: 'rgba(46,232,182,0.45)',
  statusOkBorder: 'rgba(46,232,182,0.45)',
  statusOkBg: 'rgba(46,232,182,0.08)',
  statusWarnBorder: '#7A5A12',
  statusWarnBg: '#3D2B0E',
  glassBg: 'rgba(255,255,255,0.10)',
  glassBorder: 'rgba(255,255,255,0.14)',
  tints: {
    food: { top: '#0E5734', bottom: '#081C17', border: '#1C5A3C' },
    medicine: { top: '#074164', bottom: '#051C2A', border: '#145273' },
    household: { top: '#382663', bottom: '#121729', border: '#46327A' },
    skincare: { top: '#5F2646', bottom: '#161419', border: '#6C2D51' },
    pantry: { top: '#4D3617', bottom: '#1B1A11', border: '#5E4420' },
    add: { top: '#222E46', bottom: '#0F1A25', border: '#2C3B57' },
  },
  addTile: { bg: 'rgba(255,255,255,0.03)', border: '#3A4A50' },
  // Pills carry no border: a soft filled capsule, lighter than the text it
  // sits next to ("1 day", "3 days"…).
  pills: {
    amber: { bg: '#3D2B0E', text: '#F5B83D' },
    green: { bg: '#0A382C', text: '#3FE0AC' },
  },
  switchColors: { track: '#2A3A40', trackOn: '#1E8A6C', thumb: '#C9D3D6', thumbOn: '#E9FFF8' },
};

export const LIGHT: Palette = {
  bg: '#F6F9F7',
  surface: '#FFFFFF',
  surfaceBorder: '#E8F0EC',
  text: '#101D1B',
  textMuted: '#5C6E6A',
  mint: '#0FA67C',
  scan: '#12C894',
  scanInk: '#04241B',
  amber: '#B98613',
  amberText: '#8F5E10',
  green: '#0E8F6B',
  red: '#D92B3E',
  navBg: 'rgba(250,253,252,0.82)',
  navBorder: 'rgba(16,29,27,0.10)',
  iconTile: '#E6EFEA',
  cardAlt: '#F0F5F3',
  separator: '#EDF3F1',
  chipOnBg: 'rgba(15,166,124,0.10)',
  chipOnBorder: 'rgba(15,166,124,0.55)',
  btnMintBg: 'rgba(15,166,124,0.10)',
  btnMintBorder: 'rgba(15,166,124,0.45)',
  btnDangerBg: 'rgba(217,43,62,0.08)',
  btnDangerBorder: 'rgba(217,43,62,0.45)',
  alertBg: '#FDEFEF',
  alertBorder: '#F1CBCF',
  alertIconBg: '#F8DBDF',
  dangerBg: '#FDECEC',
  dangerBorder: '#F0B9BD',
  dialogBg: '#FFFFFF',
  toastBg: '#0D3B31',
  toastBorder: 'rgba(15,166,124,0.5)',
  statusOkBorder: 'rgba(15,166,124,0.45)',
  statusOkBg: 'rgba(15,166,124,0.08)',
  statusWarnBorder: '#D9B871',
  statusWarnBg: '#F8EFD8',
  glassBg: 'rgba(255,255,255,0.62)',
  glassBorder: 'rgba(16,29,27,0.08)',
  // Soft pastel tiles: mint, sky, lilac, blush and cream — the category
  // cards read as gentle colour cards, not saturated blocks (the reference
  // keeps its pastels gently tinted, never washed out).
  tints: {
    food: { top: '#E7F8EF', bottom: '#D3F0E0', border: '#BCE7CD' },
    medicine: { top: '#E9F2FC', bottom: '#D6E8FA', border: '#BBD9F3' },
    household: { top: '#F0EDFB', bottom: '#E3DDF6', border: '#D2C8EE' },
    skincare: { top: '#FCEAF2', bottom: '#F8DBE9', border: '#F1C6D9' },
    pantry: { top: '#FCF2DC', bottom: '#F9E8C3', border: '#EFD9A2' },
    add: { top: '#F7FAF8', bottom: '#F3F7F4', border: '#D7E2DC' },
  },
  addTile: { bg: '#FFFFFF', border: '#BFCFC9' },
  pills: {
    amber: { bg: '#FCF0C8', text: '#B26E06' },
    green: { bg: '#D7F3E5', text: '#0D7F5B' },
  },
  switchColors: { track: '#CBD5D3', trackOn: '#17B586', thumb: '#FFFFFF', thumbOn: '#FFFFFF' },
};

export type Tint = 'food' | 'medicine' | 'household' | 'skincare' | 'pantry' | 'add';

export type Tone = 'amber' | 'green';

export const radius = { card: 13, row: 13, alert: 14, tile: 16, pill: 999 };

export const space = { gutter: 14, gridGap: 9 };

export const type = {
  title: { fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  link: { fontSize: 14.5, fontWeight: '600' },
  alertTitle: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 13.5, fontWeight: '400' },
  tileName: { fontSize: 15, fontWeight: '600' },
  rowTitle: { fontSize: 15.5, fontWeight: '600' },
  rowSub: { fontSize: 13, fontWeight: '400' },
  pill: { fontSize: 14, fontWeight: '600' },
  tab: { fontSize: 11.5, fontWeight: '500' },
} as const;

// Icon accents used by Settings rows; mid-tone so they read on both themes.
export const accents = {
  amber: '#D99B2B',
  purple: '#8B5CF6',
  mint: '#12B984',
  blue: '#3B82F6',
  teal: '#3FA8AE',
  pink: '#E255A0',
  red: '#E5484D',
} as const;

export type Accent = keyof typeof accents;

const ThemeCtx = createContext<Palette>(DARK);

export function useTheme(): Palette {
  return useContext(ThemeCtx);
}

// Builds a styles object per palette (cached: one build per active theme). The
// constraint mirrors StyleSheet.create's NamedStyles, so every property of the
// literal gets contextual typing — RN's literal types (flex alignment, font
// weights, …) survive without casts.
// Usage: const useStyles = makeStyles((c) => ({ root: { backgroundColor: c.bg } }));
export function makeStyles<S extends { [P in string]: ViewStyle | TextStyle | ImageStyle }>(build: (c: Palette) => S): () => S {
  const cache = new WeakMap<Palette, S>();
  return function useStyles(): S {
    const c = useContext(ThemeCtx);
    let s = cache.get(c);
    if (!s) {
      s = build(c);
      cache.set(c, s);
    }
    return s;
  };
}

// Follows the Theme setting (Dark/Light/System, from Settings) and drives the
// whole palette. Sits inside SettingsProvider.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const scheme = useColorScheme();
  const palette = useMemo(() => {
    const mode = settings.theme === 'system' ? scheme ?? 'dark' : settings.theme;
    return mode === 'light' ? LIGHT : DARK;
  }, [settings.theme, scheme]);
  return <ThemeCtx.Provider value={palette}>{children}</ThemeCtx.Provider>;
}

// The camera screens keep the dark look in both themes (like every camera UI),
// so they read the dark palette directly.
export const SCANNER_COLORS = DARK;
