import type { ReactNode } from 'react';
import { Image, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, useTheme, LIGHT, CARD_SHADOW, type Tint, type Tone } from '../theme';
import { PressScale } from './Press';

// The brand wordmark: dark ink on light backgrounds, light ink on dark ones.
// Both were cut from the same artwork (white background un-blended into
// alpha), so they share geometry and the green X stays green in both.
const wordmarkDarkInk = require('../../assets/wordmark-light.png');
const wordmarkLightInk = require('../../assets/wordmark.png');
// Cropped artwork size: 1228 x 294.
const WORDMARK_ASPECT = 1228 / 294;

// Liquid-glass treatment for the round chrome buttons: the same visual
// language as the shell's glass tab bar AND its scanner-screen glass circles
// (46pt, hairline, frosted blur). React Native's style types don't know these
// two CSS properties, but react-native-web passes them straight through to
// the DOM - including the -webkit- spelling older iOS Safari needs.
export const GLASS_FX = {
  backdropFilter: 'blur(18px) saturate(160%)',
  WebkitBackdropFilter: 'blur(18px) saturate(160%)',
};

// The shared liquid-glass circle: 46pt with a hairline rim, matching the
// scanner screen's native GlassCircle controls one for one, behind the
// header's menu and bell buttons, Settings' back buttons and the
// New-category page's back button, so every round control in the app shares
// the exact same glass, dimensions, shadow and press feedback. The border
// colour is theme-set at render time (see GlassIconButton) because the
// hairline reads differently on light and dark pages.
export const GLASS_BUTTON: ViewStyle = {
  width: 46,
  height: 46,
  borderRadius: 23,
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: StyleSheet.hairlineWidth,
  // A faint cool shadow keeps the glass readable on the light page.
  shadowColor: '#64748B',
  shadowOpacity: 0.08,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
};

// The hairline rim for the glass circles: bright-on-dark like the scanner's
// native glass circles, a soft ink line on the light page.
export const glassRim = (light: boolean) => (light ? 'rgba(16,29,27,0.14)' : 'rgba(255,255,255,0.14)');

export function GlassIconButton({
  icon,
  iconSize = 24,
  label,
  onPress,
  children,
  style,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconSize?: number;
  label: string;
  onPress: () => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme();
  return (
    <PressScale
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      // 0.94 mirrors the native glass circles' press feedback exactly.
      scaleTo={0.94}
      style={[GLASS_BUTTON, { backgroundColor: c.glassBg, borderColor: glassRim(c === LIGHT) }, GLASS_FX as ViewStyle, style]}
    >
      {children ?? <Ionicons name={icon ?? 'chevron-back'} size={iconSize} color={c.text} />}
    </PressScale>
  );
}

// The Add-category tile's lined background, like the reference's empty slot:
// fine diagonal hairlines over a soft fill. React Native's style types don't
// know backgroundImage, but react-native-web passes it through to the DOM.
const hatchFx = (line: string): ViewStyle =>
  ({ backgroundImage: `repeating-linear-gradient(45deg, ${line} 0px, ${line} 2px, transparent 2px, transparent 9px)` } as ViewStyle);

// The brand wordmark: the real logo in every theme - dark forest-green
// letters with the green X on light, near-white letters on dark.
export function Brandmark({ height }: { height: number }) {
  const c = useTheme();
  const source = c === LIGHT ? wordmarkDarkInk : wordmarkLightInk;
  const width = Math.round(height * WORDMARK_ASPECT);
  return <Image source={source} style={{ width, height }} resizeMode="contain" accessibilityLabel="Prexpire" />;
}

export function Header({ badge, gutter = 14, onMenu, onBell }: { badge: number; gutter?: number; onMenu: () => void; onBell: () => void }) {
  const c = useTheme();
  const s = useStyles();
  return (
    <View style={[s.header, { paddingHorizontal: gutter }]}>
      <GlassIconButton icon="menu" iconSize={24} label="Menu" onPress={onMenu} />
      <Brandmark height={33} />
      <GlassIconButton icon="notifications-outline" iconSize={22} label={`${badge} notifications`} onPress={onBell}>
        <Ionicons name="notifications-outline" size={22} color={c.text} />
        {badge > 0 && (
          <View style={[s.badge, { backgroundColor: c.red, borderColor: c.bg }]}>
            <Text style={s.badgeText}>{badge}</Text>
          </View>
        )}
      </GlassIconButton>
    </View>
  );
}

export function AttentionCard({ title, subtitle, onPress }: { title: string; subtitle: string[]; onPress: () => void }) {
  const c = useTheme();
  const s = useStyles();
  return (
    <PressScale onPress={onPress} accessibilityRole="button" style={s.alert} scaleTo={0.985}>
      <View style={[s.alertIcon, { backgroundColor: c.alertIconBg }]}>
        {/* Red in both themes: urgency reads the same whatever the theme. */}
        <Ionicons name="warning" size={24} color={c.red} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.alertTitle, { color: c.text }]}>{title}</Text>
        <Text style={[s.alertSub, { color: c.textMuted }]}>{subtitle.join('  •  ')}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
    </PressScale>
  );
}

type SectionHeaderProps = {
  title: string;
  // Optional action link beside the title (e.g. Home's category "View all").
  // Omitted when there is nothing useful to show, so no dead controls appear.
  action?: string;
  first?: boolean;
  // An explicit accessibility label for the action (defaults to its text).
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionHeader({ title, action, first = false, actionLabel, onAction }: SectionHeaderProps) {
  const c = useTheme();
  const s = useStyles();
  return (
    <View style={[s.section, first && s.sectionFirst]}>
      <Text style={[s.sectionTitle, { color: c.text }]}>{title}</Text>
      {!!action && !!onAction && (
        <PressScale
          onPress={onAction}
          hitSlop={8}
          scaleTo={0.97}
          style={s.sectionAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel ?? action}
        >
          <Text style={[s.sectionLink, { color: c.mint }]}>{action}</Text>
          <Ionicons name="chevron-forward" size={17} color={c.mint} />
        </PressScale>
      )}
    </View>
  );
}

type CategoryTileProps = {
  tint: Tint;
  art: ReactNode;
  name: string;
  sub?: string;
  status?: { label: string; tone: Tone };
  width: number;
  compact?: boolean;
  onPress: () => void;
};

export function CategoryTile({ tint, art, name, sub, status, width, compact = false, onPress }: CategoryTileProps) {
  const c = useTheme();
  const s = useStyles();
  const t = c.tints[tint];
  // The Add-category tile is a ghost card: a borderless soft fill crossed by
  // fine diagonal lines, so it reads as an empty slot waiting for a new folder.
  const ghost = tint === 'add';
  const body = (
    <>
      <View style={[s.tileArt, compact && s.tileArtCompact, !status && s.tileArtTight]}>{art}</View>
      {/* Tiles without a status line (Add category) have room for a two-line name on narrow tiles. */}
      <Text
        style={[s.tileName, { color: ghost ? c.textMuted : c.text }, compact && s.tileNameCompact]}
        numberOfLines={status ? 1 : 2}
        adjustsFontSizeToFit={!!status}
        minimumFontScale={0.85}
      >
        {name}
      </Text>
      {!!sub && (
        <Text style={[s.tileSub, { color: c.textMuted }, compact && s.textCompact]} numberOfLines={1}>
          {sub}
        </Text>
      )}
      {status ? (
        <View style={s.status}>
          <View style={[s.dot, { backgroundColor: status.tone === 'amber' ? c.amber : c.green }]} />
          <Text
            style={[s.statusText, compact && s.textCompact, { color: status.tone === 'amber' ? c.amberText : c.green }]}
            numberOfLines={1}
          >
            {status.label}
          </Text>
        </View>
      ) : sub ? (
        <View style={s.statusSpacer} />
      ) : null}
    </>
  );
  const tileStyle = [s.tile, compact && s.tileCompact, !sub && !status && s.tileCentered];
  // The tile's floating shadow sits on the OUTER pressable wrapper, which
  // never clips (iOS drops a view's own shadow when it masks its bounds);
  // the gradient/ghost fill and its rounded clipping stay on the inner view.
  // The opaque outer fill gives iOS and Android the shape to lift.
  const outerBg = ghost ? c.addTile.bg : t.top;
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      scaleTo={0.98}
      style={[{ width, borderRadius: 16 }, ...(c === LIGHT ? [CARD_SHADOW, { backgroundColor: outerBg }] : [])]}
    >
      {ghost ? (
        <View style={[...tileStyle, s.tileAdd, { backgroundColor: c.addTile.bg }, hatchFx(c.addTile.line)]}>{body}</View>
      ) : (
        <LinearGradient
          colors={[t.top, t.bottom]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={tileStyle}
        >
          {body}
        </LinearGradient>
      )}
    </PressScale>
  );
}

type ExpiryRowProps = {
  art: ReactNode;
  title: string;
  sub: string[];
  pill: string;
  tone: Tone;
  // Compact layout (Settings): shorter rows with a one-line subtitle.
  compact?: boolean;
  onPress?: () => void;
};

export function ExpiryRow({ art, title, sub, pill, tone, compact = false, onPress }: ExpiryRowProps) {
  const c = useTheme();
  const s = useStyles();
  const p = c.pills[tone];
  // Every row's icon sits in the SAME light square (the theme's neutral
  // tile), like the reference's Coming up next list - no per-category tints.
  const content = (
    <>
      <View style={[s.rowIcon, compact && s.rowIconCompact, { backgroundColor: c.iconTile }]}>{art}</View>
      <View style={{ flex: 1 }}>
        <Text style={[s.rowTitle, { color: c.text }, compact && s.rowTitleCompact]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[s.rowSub, { color: c.textMuted }]} numberOfLines={compact ? 1 : 2}>
          {sub.join('  •  ')}
        </Text>
      </View>
      <View style={[s.pill, compact && s.pillCompact, { backgroundColor: p.bg }]}>
        <Text style={[s.pillText, compact && s.pillTextCompact, { color: p.text }]}>{pill}</Text>
      </View>
      {onPress && <Ionicons name="chevron-forward" size={20} color={c.textMuted} style={{ marginLeft: 2 }} />}
    </>
  );
  // Rows without a destination are plain text, not buttons.
  if (!onPress) return <View style={[s.row, compact && s.rowCompact]}>{content}</View>;
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      style={[s.row, compact && s.rowCompact]}
      scaleTo={0.985}
    >
      {content}
    </PressScale>
  );
}

export type TabId = 'home' | 'items' | 'reminders' | 'settings';

const tabs: { id: TabId; label: string; icon: keyof typeof Ionicons.glyphMap; iconOn: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'home', label: 'Home', icon: 'home-outline', iconOn: 'home' },
  { id: 'items', label: 'Lists', icon: 'list', iconOn: 'list' },
  { id: 'reminders', label: 'Reminders', icon: 'notifications-outline', iconOn: 'notifications' },
  { id: 'settings', label: 'Settings', icon: 'settings-sharp', iconOn: 'settings-sharp' },
];

type BottomNavProps = {
  active: TabId;
  badge: number;
  // Open Shopping List entries, shown on the Lists tab (the Shopping List is
  // a view of it, reached through the segmented control on that page).
  shopBadge?: number;
  insets: { bottom: number; left: number; right: number };
  maxWidth?: number;
  onTab: (id: TabId) => void;
  onScan: () => void;
};

// Distance from the bottom edge to the nav pill, and the space content must leave for it.
export const navOffset = (bottomInset: number) => Math.max(bottomInset - 6, 12);
export const NAV_HEIGHT = 68;

// The bottom navigation is PERMANENT: it never hides, fades, moves or changes
// with scrolling in any way (only the top header auto-hides - see
// navAutohide.tsx). Because it is an absolute overlay that never participates
// in layout, showing or hiding the header cannot move it or resize the
// scroller, and every screen pads its content bottom so the last item stays
// reachable above the bar.
export function BottomNav({ active, badge, shopBadge = 0, insets, maxWidth = 560, onTab, onScan }: BottomNavProps) {
  const c = useTheme();
  const s = useStyles();
  // Narrow phones give the four tabs a little more room so labels are not clipped.
  const narrow = useWindowDimensions().width < 360;
  const sideMargin = narrow ? 8 : 16;
  const renderTab = (tab: (typeof tabs)[number]) => {
    const selected = tab.id === active;
    return (
      <PressScale
        key={tab.id}
        onPress={() => onTab(tab.id)}
        style={s.tab}
        scaleTo={0.97}
        accessibilityRole="tab"
        aria-selected={selected}
        accessibilityLabel={tab.label}
      >
        <View>
          <Ionicons name={selected ? tab.iconOn : tab.icon} size={24} color={selected ? c.mint : c.textMuted} />
          {tab.id === 'reminders' && badge > 0 && (
            <View style={[s.badge, { top: -5, right: -9, backgroundColor: c.red, borderColor: c.navBg }]}>
              <Text style={s.badgeText}>{badge}</Text>
            </View>
          )}
          {tab.id === 'items' && shopBadge > 0 && (
            <View style={[s.badge, { top: -5, right: -9, backgroundColor: c.mint, borderColor: c.navBg }]}>
              <Text style={s.shopBadgeText}>{shopBadge}</Text>
            </View>
          )}
        </View>
        <Text
          style={[s.tabLabel, narrow && s.tabLabelNarrow, { color: selected ? c.mint : c.textMuted }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {tab.label}
        </Text>
      </PressScale>
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={[s.navWrap, { bottom: navOffset(insets.bottom), left: sideMargin + insets.left, right: sideMargin + insets.right }]}
    >
      <View style={[s.navShadow, { maxWidth }]}>
        <View style={[s.nav, s.navFallback]}>
          {/* Four tabs with the scan button dead-centre: the Shopping List
              lives inside the Lists tab (its segmented control), so the bar
              stays symmetric — home · lists · SCAN · reminders · settings. */}
          {renderTab(tabs[0])}
          {renderTab(tabs[1])}
          <View style={s.tab}>
            <PressScale onPress={onScan} accessibilityRole="button" accessibilityLabel="Scan a label" scaleTo={0.97} style={s.scan}>
              <Ionicons name="scan-outline" size={26} color={c.scanInk} />
              <View style={s.scanLine} />
            </PressScale>
          </View>
          {renderTab(tabs[2])}
          {renderTab(tabs[3])}
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  // A taller top bar gives the wordmark room to breathe (brand-forward,
  // like the reference) - keep HEADER_HEIGHT in navAutohide.tsx in sync.
  header: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  // The Lists tab's shopping count uses the accent colour rather than red: it
  // is information, not urgency (the Shopping List is a view of that tab).
  shopBadgeText: { color: '#04241B', fontSize: 11, fontWeight: '700' },
  alert: {
    marginTop: 4,
    minHeight: 58,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.alertBorder,
    backgroundColor: c.alertBg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 9,
    paddingRight: 14,
    gap: 12,
    // The red card floats gently on the light page (hairline still on dark).
    ...(c === LIGHT ? CARD_SHADOW : null),
  },
  alertIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  alertTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  alertSub: { color: c.textMuted, fontSize: 13.5, fontWeight: '400', marginTop: 2 },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 9,
  },
  sectionFirst: { marginTop: 4 },
  sectionTitle: { color: c.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.3, flexShrink: 1 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sectionLink: { color: c.mint, fontSize: 14.5, fontWeight: '600' },
  tile: {
    height: 156,
    borderRadius: 16,
    borderWidth: 0,
    overflow: 'hidden',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingTop: 12,
    // Borderless pastel cards that float on the light page: the shadow sits
    // on the outer PressScale wrapper (see CategoryTile), never here, because
    // this view clips its corners - and a view that clips cannot cast iOS's
    // soft shadow.
  },
  // The Add-category tile: a borderless soft card with diagonal lines.
  tileAdd: {},
  tileArt: { height: 68, width: '100%', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tileCompact: { height: 146, paddingHorizontal: 6, paddingTop: 10 },
  tileArtCompact: { height: 58, marginBottom: 6 },
  tileArtTight: { marginBottom: 2 },
  // Tiles with only an icon and a name (Add category) centre them in the tile.
  tileCentered: { justifyContent: 'center', paddingTop: 0, paddingBottom: 4 },
  tileNameCompact: { fontSize: 14 },
  textCompact: { fontSize: 12.5 },
  tileName: { color: c.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  tileSub: { color: c.textMuted, fontSize: 13.5, fontWeight: '400', textAlign: 'center', marginTop: 2 },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 4, height: 18 },
  statusSpacer: { height: 18, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13.5, fontWeight: '600' },
  row: {
    minHeight: 58,
    paddingVertical: 8,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 9,
    paddingRight: 8,
    gap: 11,
    backgroundColor: c.surface,
    // Light: borderless white cards floating on soft shadows; dark keeps
    // its hairline, which is what separates surfaces there.
    borderWidth: c === LIGHT ? 0 : 1,
    borderColor: c.surfaceBorder,
    ...(c === LIGHT ? CARD_SHADOW : null),
  },
  rowIcon: { width: 44, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowCompact: { minHeight: 48, paddingVertical: 5, gap: 9 },
  rowIconCompact: { width: 36, height: 32, borderRadius: 10 },
  rowTitle: { color: c.text, fontSize: 15.5, fontWeight: '600' },
  rowTitleCompact: { fontSize: 14.5 },
  rowSub: { color: c.textMuted, fontSize: 12.5, fontWeight: '400', marginTop: 1 },
  pill: { height: 30, paddingHorizontal: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 14, fontWeight: '600' },
  pillCompact: { height: 26, paddingHorizontal: 9 },
  pillTextCompact: { fontSize: 13 },
  navWrap: { position: 'absolute', alignItems: 'center' },
  navShadow: { width: '100%', borderRadius: 34, shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  nav: {
    height: 68,
    borderRadius: 34,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  // backdropFilter only applies on web; native gets the translucent fill.
  navFallback: { backgroundColor: c.navBg, borderColor: c.navBorder, backdropFilter: 'blur(22px) saturate(1.4)' } as ViewStyle,
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, height: 68 },
  tabLabel: { fontSize: 11.5, fontWeight: '500' },
  tabLabelNarrow: { fontSize: 10.5 },
  scan: { width: 50, height: 50, borderRadius: 25, backgroundColor: c.scan, alignItems: 'center', justifyContent: 'center' },
  scanLine: { position: 'absolute', width: 16, height: 2.5, borderRadius: 2, backgroundColor: c.scanInk },
}));
