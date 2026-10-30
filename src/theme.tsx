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
  // Settings subtexts: a gray with a cyan breath instead of pure gray, so the
  // secondary lines sit in the app's teal world rather than neutral slate.
  textSub: string;
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
  // The "Add category" tile: a soft fill crossed by fine diagonal lines,
  // like the reference's empty slot.
  addTile: { bg: string; line: string };
  alertBg: string;
  alertBorder: string;
  alertIconBg: string;
  // The attention card's GREEN counterpart ("All caught up"): the same card
  // language in the mint family, for when nothing needs attention.
  okBg: string;
  okBorder: string;
  okIconBg: string;
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
  // The item cards' expiry progress track: pale gray-green on light, dark
  // translucent green on dark (the fill is always the mint accent).
  expiryTrack: string;
  // The header STRIP's liquid-glass tint (AutohideHeader): translucent so the
  // frosted backdrop-filter underneath shows page content scrolling past —
  // the same material language as the scanner's top chrome and the bottom
  // nav pill, instead of an opaque bar.
  glassHeaderBg: string;
  pills: Record<Tone, { bg: string; text: string }>;
  switchColors: { track: string; trackOn: string; thumb: string; thumbOn: string };
};

export const DARK: Palette = {
  bg: '#050D10',
  surface: '#0B161A',
  surfaceBorder: '#1A2A2E',
  text: '#F2F6F7',
  textMuted: '#9AA7AD',
  textSub: '#93B7BE',
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
  // The "items need attention" card is RED in both themes - urgency reads
  // the same in light and dark, like a warning triangle on any dashboard.
  alertBg: '#2A1216',
  alertBorder: '#5A2530',
  alertIconBg: '#461B22',
  okBg: '#0C2A21',
  okBorder: '#1E5040',
  okIconBg: '#123D2F',
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
  glassBorder: 'rgba(255,255,255,0.18)',
  // The dark page's expiry bar track: a dark translucent green, so the thin
  // mint fill reads against the glass card without a hard edge.
  expiryTrack: 'rgba(46,232,182,0.16)',
  // The dark page's glass header strip: the page bg at 60% over a blur, so
  // content flowing under the bar frosts through and the glass circles on
  // top have something real to refract (like the scanner's chrome over the
  // camera) instead of sitting on a flat opaque bar.
  glassHeaderBg: 'rgba(5,13,16,0.60)',
  tints: {
    food: { top: '#0E5734', bottom: '#081C17', border: '#1C5A3C' },
    medicine: { top: '#074164', bottom: '#051C2A', border: '#145273' },
    household: { top: '#382663', bottom: '#121729', border: '#46327A' },
    skincare: { top: '#5F2646', bottom: '#161419', border: '#6C2D51' },
    pantry: { top: '#4D3617', bottom: '#1B1A11', border: '#5E4420' },
    // The extended palette: rich gradients in the same depth language.
    forest: { top: '#0B4A28', bottom: '#07160F', border: '#15623A' },
    ocean: { top: '#0A3A5C', bottom: '#061A2C', border: '#175B85' },
    teal: { top: '#0C4A4E', bottom: '#06181C', border: '#177078' },
    lavender: { top: '#46357A', bottom: '#171425', border: '#554492' },
    rose: { top: '#6B2440', bottom: '#1B1218', border: '#7D2F4E' },
    coral: { top: '#69301D', bottom: '#1D1410', border: '#7D3B24' },
    sand: { top: '#57472B', bottom: '#191610', border: '#6B573A' },
    slate: { top: '#2E3A44', bottom: '#11181D', border: '#3D4C58' },
    add: { top: '#222E46', bottom: '#0F1A25', border: '#2C3B57' },
  },
  addTile: { bg: 'rgba(255,255,255,0.03)', line: 'rgba(255,255,255,0.09)' },
  // Pills carry no border: a soft filled capsule, lighter than the text it
  // sits next to ("1 day", "3 days"…).
  pills: {
    amber: { bg: '#3D2B0E', text: '#F5B83D' },
    green: { bg: '#0A382C', text: '#3FE0AC' },
    // Expired items: the red family of the attention card, as a day pill.
    red: { bg: '#2A1216', text: '#FF6B77' },
  },
  switchColors: { track: '#2A3A40', trackOn: '#1E8A6C', thumb: '#C9D3D6', thumbOn: '#E9FFF8' },
};

export const LIGHT: Palette = {
  // The light reference's airy palette: a very light cool-gray page where
  // white cards float on soft shadows and fine #E4ECEF hairlines, deep
  // green ink, a mint/emerald accent, pale-green image tiles and muted
  // blue-gray secondary text.
  bg: '#F5F8FA',
  surface: '#FFFFFF',
  surfaceBorder: '#E4ECEF',
  text: '#17352F',
  textMuted: '#82929F',
  textSub: '#5E7E8E',
  // The accent takes its hue from the wordmark's green X: a light, fresh
  // green (links, active tab, selected states).
  mint: '#16C58B',
  scan: '#16C58B',
  scanInk: '#FFFFFF',
  // Expiring-soon accents: strong enough to read clearly on pastel fills
  // (never washed-out).
  amber: '#DFA42E',
  amberText: '#966E12',
  green: '#10A374',
  red: '#D92B3E',
  navBg: 'rgba(255,255,255,0.94)',
  navBorder: '#E4ECEF',
  // Every product row's icon square: the reference's pale green image tile —
  // the same #E1F7EC the product cards' art squares use.
  iconTile: '#E1F7EC',
  cardAlt: '#F0F4F7',
  separator: '#E4ECEF',
  chipOnBg: 'rgba(22,197,139,0.15)',
  chipOnBorder: 'rgba(22,197,139,0.5)',
  btnMintBg: 'rgba(0,168,107,0.10)',
  btnMintBorder: 'rgba(0,168,107,0.4)',
  btnDangerBg: 'rgba(217,43,62,0.08)',
  btnDangerBorder: 'rgba(217,43,62,0.45)',
  alertBg: '#FDEFEF',
  alertBorder: '#F1CBCF',
  alertIconBg: '#F8DBDF',
  okBg: '#E8F7EF',
  okBorder: '#C6EBD9',
  okIconBg: '#D5F1E2',
  dangerBg: '#FDF1F2',
  dangerBorder: '#F5C9CD',
  dialogBg: '#FFFFFF',
  toastBg: '#0D3B31',
  toastBorder: 'rgba(15,166,124,0.5)',
  statusOkBorder: 'rgba(0,168,107,0.45)',
  statusOkBg: 'rgba(0,168,107,0.08)',
  statusWarnBorder: '#E3C77E',
  statusWarnBg: '#F8EFD8',
  // The header's liquid-glass circles on the light page: a translucent
  // cool-gray glass (never solid white on the near-white page) with a thin
  // delicate hairline rim and the specular inner highlight (see glassRim in
  // HomeComponents) — dark enough to read clearly against the airy frosted
  // strip while the blur keeps it reading as glass, never a flat gray disc.
  glassBg: 'rgba(148,163,184,0.35)',
  glassBorder: 'rgba(15,23,42,0.28)',
  // The light page's expiry bar track: a subtle pale gray-green, like the
  // reference's muted track under the mint fill.
  expiryTrack: '#D9E9E1',
  // The light page's glass header strip: the airy blue-white bg at 72% over
  // a blur — light glass stays brighter and more opaque than dark glass (the
  // 0.72 keeps dark text readable while content still frosts through).
  glassHeaderBg: 'rgba(245,248,250,0.78)',
  // Soft pastel tiles: mint, sky, lilac, blush and cream plus the extended
  // palette - the category cards read as gentle colour cards with no borders,
  // like the reference.
  tints: {
    food: { top: '#E7F8EF', bottom: '#D3F0E0', border: '#BCE7CD' },
    medicine: { top: '#E9F2FC', bottom: '#D6E8FA', border: '#BBD9F3' },
    household: { top: '#F0EDFB', bottom: '#E3DDF6', border: '#D2C8EE' },
    skincare: { top: '#FCEAF2', bottom: '#F8DBE9', border: '#F1C6D9' },
    pantry: { top: '#FCF2DC', bottom: '#F9E8C3', border: '#EFD9A2' },
    // The extended palette: the same soft-pastel treatment, one family each.
    forest: { top: '#E3F4E8', bottom: '#CFE9D8', border: '#B7DEC4' },
    ocean: { top: '#DCEBFA', bottom: '#C4DCF4', border: '#AACFEC' },
    teal: { top: '#E2F4F4', bottom: '#CCEAEA', border: '#B3DEDE' },
    lavender: { top: '#EAEAFB', bottom: '#D8D8F4', border: '#C2C3EA' },
    rose: { top: '#F9E4EC', bottom: '#F2CFDD', border: '#E8B8CC' },
    coral: { top: '#FDEDE4', bottom: '#FADDCB', border: '#F3CBB0' },
    sand: { top: '#F8F1E3', bottom: '#F1E7CF', border: '#E5D6B4' },
    slate: { top: '#ECF1F5', bottom: '#DFE7ED', border: '#CBD8E2' },
    add: { top: '#F7FAF8', bottom: '#F3F7F4', border: '#D7E2DC' },
  },
  // The Add-category tile: a borderless soft card with fine diagonal lines.
  addTile: { bg: '#F4F8FB', line: 'rgba(100,116,139,0.16)' },
  pills: {
    // Day pills with real presence: a clearly-tinted fill and a deep-toned
    // ink, so "1 day" / "3 days" read at a glance.
    amber: { bg: '#FCF1D8', text: '#8A600C' },
    green: { bg: '#DFF6EA', text: '#0E8A5F' },
    red: { bg: '#FDE9EC', text: '#C62839' },
  },
  switchColors: { track: '#D8E1E8', trackOn: '#16C58B', thumb: '#FFFFFF', thumbOn: '#FFFFFF' },
};

export type Tint =
  | 'food'
  | 'medicine'
  | 'household'
  | 'skincare'
  | 'pantry'
  | 'forest'
  | 'ocean'
  | 'teal'
  | 'lavender'
  | 'rose'
  | 'coral'
  | 'sand'
  | 'slate'
  | 'add';

export type Tone = 'amber' | 'green' | 'red';

export const radius = { card: 13, row: 13, alert: 14, tile: 16, pill: 999 };

// The reference's airy depth: soft, diffuse blue-gray shadows that let white
// cards float gently above the cool-white page. Applied on the LIGHT theme
// only - the dark theme separates surfaces with hairlines instead.
// The shadow lives on an OUTER wrapper that never sets overflow: 'hidden'
// (iOS clips a view's own shadow as soon as it masks its bounds), with the
// white background and rounded clipping on an inner container.
export const CARD_SHADOW: ViewStyle = {
  shadowColor: '#64748B',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 3,
};

// Slightly more presence for the profile card and dialogs.
export const CARD_SHADOW_LIFTED: ViewStyle = {
  shadowColor: '#64748B',
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.09,
  shadowRadius: 16,
  elevation: 4,
};

// The dark theme's depth cue: on the near-black page a hairline alone leaves
// the glass cards reading flat, so they float on a soft black shadow instead -
// the dark register of the light theme's airy blue-gray shadows.
export const CARD_SHADOW_DARK: ViewStyle = {
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.45,
  shadowRadius: 12,
  elevation: 8,
};

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
// The green follows the reference's primary green.
export const accents = {
  amber: '#D99B2B',
  purple: '#8B5CF6',
  mint: '#00A86B',
  blue: '#3B82F6',
  teal: '#3FA8AE',
  pink: '#E255A0',
  red: '#FF334F',
} as const;

export type Accent = keyof typeof accents;

const ThemeCtx = createContext<Palette>(DARK);

export function useTheme(): Palette {
  return useContext(ThemeCtx);
}

// Builds a styles object per palette (cached: one build per active theme). The
// constraint mirrors StyleSheet.create's NamedStyles, so every property of the
// literal gets contextual typing - RN's literal types (flex alignment, font
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
