import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { useSettings } from './settings';

// The app's design language: a near-black teal dark theme and an airy
// mint-white light theme, both anchored on the brand's bright lime green
// (the wordmark's solid leaf green). Everything visual reads from the active
// palette through useTheme()/makeStyles, so the whole app (and the status
// bar) follows the Dark/Light/System setting.
//
// The two themes are versions of the same app: dark keeps the page and its
// cards very dark (#030709 / #091314) with the bright lime reserved for
// primary actions, selected controls and important highlights; light is
// bright, clean and airy (white cards on #F8FCFB) with dark teal text,
// pale mint details and the same lime accents. Status colours (expired red,
// expiring-soon amber, valid green) stay clearly distinguishable from the
// lime accent in both themes.

export type Palette = {
  bg: string;
  surface: string;
  surfaceBorder: string;
  text: string;
  textMuted: string;
  // Settings subtexts and item-card meta rows: a teal-gray that sits in the
  // app's world rather than neutral slate — slightly lighter than the
  // muted secondary on dark, slightly deeper on light (contrast where the
  // finest type needs it).
  textSub: string;
  // The bright lime FILL (the Add button, the scan button, dots, checkbox
  // fills) — the primary-action green, identical in hue in both themes.
  mint: string;
  // Text- and icon-grade green for anything that must READ on a light or
  // white surface (links, checkmarks, "All good" status): the subtle accent,
  // deepened on the light page so it never washes out.
  green: string;
  // The solid selected/active fill of the segmented control / tabs — the
  // bright lime on dark, the softer selected-lime on light — with the deep
  // selected ink (scanInk) on top in both themes.
  selBg: string;
  // The pressed register of the solid lime buttons (a hair deeper).
  mintPressed: string;
  scan: string;
  scanInk: string;
  amber: string;
  amberText: string;
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
  // language in the green family, for when nothing needs attention.
  okBg: string;
  okBorder: string;
  okIconBg: string;
  dangerBg: string;
  dangerBorder: string;
  dialogBg: string;
  toastBg: string;
  toastBorder: string;
  // Text on the toast capsule: the toast is a deep green pill in BOTH
  // themes, so its ink is always the light mint-white (never the page ink,
  // which would vanish on the dark capsule in light mode).
  toastInk: string;
  statusOkBorder: string;
  statusOkBg: string;
  statusWarnBorder: string;
  statusWarnBg: string;
  // The header's round chrome buttons: a quiet circular surface — the dark
  // page's raised surface, the light page's pale mint — with a hairline rim.
  glassBg: string;
  glassBorder: string;
  // The header STRIP's liquid-glass tint (AutohideHeader): translucent so the
  // frosted backdrop-filter underneath shows page content scrolling past —
  // the same material language as the scanner's top chrome and the bottom
  // nav pill, instead of an opaque bar. The dark strip rides the secondary
  // background (#050C0E), the light strip the airy page itself.
  glassHeaderBg: string;
  pills: Record<Tone, { bg: string; text: string }>;
  switchColors: { track: string; trackOn: string; thumb: string; thumbOn: string };
};

export const DARK: Palette = {
  // The dark page: near-black teal base, very dark cards a hair above it,
  // and the bright lime kept for actions and selected controls only.
  bg: '#030709',
  surface: '#091314',
  surfaceBorder: '#1B3032',
  text: '#F3F6F5',
  textMuted: '#91A6A8',
  textSub: '#9FB3B5',
  mint: '#A6DF6B',
  green: '#70B85B',
  selBg: '#A6DF6B',
  mintPressed: '#91CC59',
  scan: '#A6DF6B',
  scanInk: '#07110B',
  amber: '#FFB454',
  amberText: '#FFB454',
  red: '#FF6B6B',
  navBg: 'rgba(9,19,20,0.78)',
  navBorder: 'rgba(255,255,255,0.09)',
  iconTile: '#0D1B1D',
  cardAlt: '#0D1B1D',
  separator: '#1B3032',
  chipOnBg: '#96EB74',
  chipOnBorder: '#96EB74',
  btnMintBg: 'rgba(166,223,107,0.14)',
  btnMintBorder: 'rgba(166,223,107,0.45)',
  btnDangerBg: 'rgba(255,107,107,0.10)',
  btnDangerBorder: 'rgba(255,107,107,0.45)',
  // The "items need attention" card is RED in both themes - urgency reads
  // the same in light and dark, like a warning triangle on any dashboard.
  alertBg: '#251211',
  alertBorder: '#5A2A2C',
  alertIconBg: '#3E1D1B',
  okBg: '#0B2318',
  okBorder: '#204A30',
  okIconBg: '#123624',
  dangerBg: '#1C1110',
  dangerBorder: '#48251F',
  dialogBg: '#15282A',
  toastBg: '#0B2C1E',
  toastBorder: 'rgba(166,223,107,0.45)',
  toastInk: '#EAF6E3',
  statusOkBorder: 'rgba(112,184,117,0.45)',
  statusOkBg: 'rgba(112,184,117,0.12)',
  statusWarnBorder: '#7A5A26',
  statusWarnBg: '#3A2C14',
  // The round chrome buttons on the dark page: the raised surface as a
  // quiet circular plateau with its hairline edge — a subtle disc that
  // never competes with the wordmark between the two.
  glassBg: '#15282A',
  glassBorder: '#1B3032',
  // The dark page's glass header strip: the secondary background (#050C0E)
  // at 60% over a blur, so content flowing under the bar frosts through and
  // the round buttons on top have something real behind them instead of a
  // flat opaque bar.
  glassHeaderBg: 'rgba(5,12,14,0.60)',
  tints: {
    food: { top: '#1B5E34', bottom: '#0A1F15', border: '#2A6E42' },
    medicine: { top: '#0E4A5C', bottom: '#06181E', border: '#1B5F73' },
    household: { top: '#3E2E63', bottom: '#151A2A', border: '#4E3B78' },
    skincare: { top: '#5C2A4A', bottom: '#1A141B', border: '#6E3558' },
    pantry: { top: '#5A4322', bottom: '#1D1A10', border: '#6C532C' },
    // The extended palette: rich gradients in the same depth language.
    forest: { top: '#155C33', bottom: '#08190F', border: '#227040' },
    ocean: { top: '#0F4460', bottom: '#07202E', border: '#1D5A7A' },
    teal: { top: '#115257', bottom: '#07191D', border: '#1E6A70' },
    lavender: { top: '#453574', bottom: '#171526', border: '#554492' },
    rose: { top: '#62263F', bottom: '#1D1318', border: '#743250' },
    coral: { top: '#643323', bottom: '#1E1511', border: '#78402C' },
    sand: { top: '#52412A', bottom: '#191610', border: '#665238' },
    slate: { top: '#2C3830', bottom: '#121814', border: '#3B4A40' },
    add: { top: '#223028', bottom: '#101813', border: '#2E4034' },
  },
  addTile: { bg: 'rgba(255,255,255,0.03)', line: 'rgba(255,255,255,0.09)' },
  // Pills carry no border: a soft filled capsule, lighter than the text it
  // sits next to ("1 day", "3 days"…). The green pill is the days-left
  // badge: a deep green capsule with bright lime-green text.
  pills: {
    amber: { bg: '#3A2C14', text: '#FFB454' },
    green: { bg: '#093426', text: '#A6E878' },
    // Expired items: the red family of the attention card, as a day pill.
    red: { bg: '#331613', text: '#FF8A8A' },
  },
  switchColors: { track: '#1B3032', trackOn: '#91CC59', thumb: '#9FB3B5', thumbOn: '#FFFFFF' },
};

export const LIGHT: Palette = {
  // The light reference's airy palette: a mint-white page where white cards
  // float on soft shadows and fine hairlines, dark teal ink, the bright lime
  // accent for fills, pale-mint image tiles and muted teal-gray secondary
  // text — bright, clean and fresh.
  bg: '#F8FCFB',
  surface: '#FFFFFF',
  surfaceBorder: '#E1EFEC',
  text: '#123B36',
  textMuted: '#6C8989',
  textSub: '#547373',
  // The accent: the primary-action lime for FILLS (the Add button, the scan
  // button, dots)…
  mint: '#A5E86B',
  // …and the subtle accent deepened for green TEXT and ICONS on the white
  // page, so links and checkmarks always read clearly (never a washed-out
  // lime on white).
  green: '#4E8F2B',
  // The selected side of the segmented control / tabs: the soft selected
  // lime with the deep selected ink.
  selBg: '#B5EF8A',
  mintPressed: '#91D65C',
  scan: '#A5E86B',
  scanInk: '#103A20',
  // Expiring-soon accents: strong enough to read clearly on pastel fills
  // (never washed-out).
  amber: '#FFB454',
  amberText: '#8F6217',
  red: '#FF6B6B',
  navBg: 'rgba(255,255,255,0.94)',
  navBorder: '#E0EEEA',
  // Every product row's icon square: the reference's pale mint image tile.
  iconTile: '#E5F5EE',
  cardAlt: '#EAF6F2',
  separator: '#E1EFEC',
  chipOnBg: '#A5E86B',
  chipOnBorder: '#A5E86B',
  btnMintBg: 'rgba(165,232,107,0.18)',
  btnMintBorder: 'rgba(121,185,106,0.5)',
  btnDangerBg: 'rgba(255,107,107,0.08)',
  btnDangerBorder: 'rgba(214,69,69,0.45)',
  alertBg: '#FDECEC',
  alertBorder: '#F2CDCB',
  alertIconBg: '#F8DAD6',
  okBg: '#EAF6E2',
  okBorder: '#CBEAB4',
  okIconBg: '#D8F2C4',
  dangerBg: '#FDF0EF',
  dangerBorder: '#F5CBCA',
  dialogBg: '#FFFFFF',
  // The toast is the deep green capsule in both themes — light mint ink.
  toastBg: '#0F3A28',
  toastBorder: 'rgba(121,185,106,0.5)',
  toastInk: '#EAF6E3',
  statusOkBorder: 'rgba(121,185,106,0.5)',
  statusOkBg: 'rgba(121,185,106,0.15)',
  statusWarnBorder: '#E8CD8E',
  statusWarnBg: '#FBF2DC',
  // The round chrome buttons on the light page: the pale mint surface as a
  // quiet ghost circle with its delicate hairline — dark enough to read
  // clearly against the airy page while staying soft, never a flat gray disc.
  glassBg: '#EAF6F2',
  glassBorder: '#E1EFEC',
  // The light page's glass header strip: the airy mint-white bg at 78% over
  // a blur — light glass stays brighter and more opaque than dark glass (the
  // 0.78 keeps dark text readable while content still frosts through).
  glassHeaderBg: 'rgba(248,252,251,0.78)',
  // Soft pastel tiles: mint, sky, lilac, blush and cream plus the extended
  // palette - the category cards read as gentle colour cards with no borders,
  // like the reference.
  tints: {
    food: { top: '#E4F6E7', bottom: '#CDEFD3', border: '#B5E3BC' },
    medicine: { top: '#E6F1F8', bottom: '#CCE3F0', border: '#B0D2E4' },
    household: { top: '#EFEAF9', bottom: '#DED6F1', border: '#CFC4E9' },
    skincare: { top: '#FAE9F0', bottom: '#F3D3E0', border: '#EBBED1' },
    pantry: { top: '#FBF1DC', bottom: '#F5E5C2', border: '#EAD69F' },
    // The extended palette: the same soft-pastel treatment, one family each.
    forest: { top: '#E1F3E6', bottom: '#C8E7D1', border: '#AFDABC' },
    ocean: { top: '#DFEBF8', bottom: '#C3D9EE', border: '#A9C9E2' },
    teal: { top: '#E0F2F2', bottom: '#C6E7E7', border: '#AADDDD' },
    lavender: { top: '#EAE8FA', bottom: '#D5D3F2', border: '#C0BEE8' },
    rose: { top: '#F8E2EB', bottom: '#EFCCDC', border: '#E4B4CA' },
    coral: { top: '#FCEBE2', bottom: '#F7D9C8', border: '#EFC7AD' },
    sand: { top: '#F7F0E2', bottom: '#EFE4CB', border: '#E1D2B0' },
    slate: { top: '#EAF0EA', bottom: '#D9E4DA', border: '#C4D4C6' },
    add: { top: '#F4F9F4', bottom: '#EDF4ED', border: '#D5E4D6' },
  },
  // The Add-category tile: a borderless soft card with fine diagonal lines.
  addTile: { bg: '#F2F7F2', line: 'rgba(108,137,137,0.16)' },
  pills: {
    // Day pills with real presence: a clearly-tinted fill and a deep-toned
    // ink, so "1 day" / "3 days" read at a glance. The green pill is the
    // days-left badge: pale lime with deep green text.
    amber: { bg: '#FCF0D6', text: '#8F6217' },
    green: { bg: '#C9F3A7', text: '#174B28' },
    red: { bg: '#FBE5E3', text: '#C03A34' },
  },
  switchColors: { track: '#DFEAE6', trackOn: '#A5E86B', thumb: '#FFFFFF', thumbOn: '#FFFFFF' },
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

// The reference's airy depth: soft, diffuse teal-gray shadows that let white
// cards float gently above the mint-white page. Applied on the LIGHT theme
// only - the dark theme separates surfaces with hairlines instead.
// The shadow lives on an OUTER wrapper that never sets overflow: 'hidden'
// (iOS clips a view's own shadow as soon as it masks its bounds), with the
// white background and rounded clipping on an inner container.
export const CARD_SHADOW: ViewStyle = {
  shadowColor: '#708985',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 3,
};

// Slightly more presence for the profile card and dialogs.
export const CARD_SHADOW_LIFTED: ViewStyle = {
  shadowColor: '#708985',
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.09,
  shadowRadius: 16,
  elevation: 4,
};

// The dark theme's depth cue: on the near-black page a hairline alone leaves
// the cards reading flat, so they float on a soft black shadow instead -
// the dark register of the light theme's airy shadows.
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
// The green follows the brand's leaf green, deepened to sit on pastel tiles.
export const accents = {
  amber: '#DE9A2B',
  purple: '#8B5CF6',
  mint: '#4E9B2E',
  blue: '#3B82F6',
  teal: '#3FA89E',
  pink: '#E255A0',
  red: '#F0524A',
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
