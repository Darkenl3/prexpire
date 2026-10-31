import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, useTheme, LIGHT, CARD_SHADOW, type Tint, type Tone } from '../theme';
import { useSettings } from '../settings';
import { PressScale } from './Press';

// The brand wordmark: the user's own logo artwork, cut pixel-exact from
// their file (transparent PNGs): the solid filled four-leaf lime icon stays
// lime in both themes, with near-white ink for the dark page and deep
// forest-green ink for the light page.
const brandWhiteInk = require('../../assets/brand-white.png');
const brandDarkInk = require('../../assets/brand-ink.png');
// Artwork size: 1619 x 399.
const BRAND_ASPECT = 1619 / 399;

// Liquid-glass treatment for the round chrome buttons: the same visual
// language as the shell's glass tab bar AND its scanner-screen glass circles
// (46pt, hairline, frosted blur). React Native's style types don't know these
// two CSS properties, but react-native-web passes them straight through to
// the DOM - including the -webkit- spelling older iOS Safari needs.
export const GLASS_FX = {
  backdropFilter: 'blur(18px) saturate(160%)',
  WebkitBackdropFilter: 'blur(18px) saturate(160%)',
};

// The liquid-glass material for the header STRIP itself (AutohideHeader): a
// slightly deeper frosted blur than the circles, so the bar reads as one
// continuous piece of glass with the round buttons floating on it — the same
// layered-material look as the scanner's top chrome over the camera, and the
// bottom nav pill's blur. Without this the circles blur a flat opaque bar and
// the "liquid" never shows: there is nothing behind them to refract.
export const GLASS_STRIP_FX = {
  backdropFilter: 'blur(20px) saturate(160%)',
  WebkitBackdropFilter: 'blur(20px) saturate(160%)',
};

// The shared round chrome button: 46pt, matching the scanner screen's native
// GlassCircle controls one for one, behind the header's menu and bell buttons,
// Settings' back buttons and the New-category page's back button, so every
// round control in the app shares the exact same dimensions and press
// feedback. Its surface is the theme's quiet circular plateau - the dark
// page's raised surface, the light page's pale mint - with nothing but a
// hairline rim: flat and calm like the reference's ghost circles, never a
// lifted solid button.
export const GLASS_BUTTON: ViewStyle = {
  width: 46,
  height: 46,
  borderRadius: 23,
  alignItems: 'center',
  justifyContent: 'center',
};

export function GlassIconButton({
  icon,
  iconSize = 24,
  label,
  onPress,
  children,
  style,
  size = 46,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  iconSize?: number;
  label: string;
  onPress: () => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  // The glass circle's diameter: 46 (the chrome standard) by default, smaller
  // for compact placements like Settings' back button (38). Everything else —
  // the glass fill, hairline rim, blur, shadow and press feedback — is shared.
  size?: number;
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
      style={[
        GLASS_BUTTON,
        size !== 46 && { width: size, height: size, borderRadius: size / 2 },
        { backgroundColor: c.glassBg, borderWidth: 1, borderColor: c.glassBorder },
        GLASS_FX as ViewStyle,
        style,
      ]}
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

// The brand wordmark: the user's own exact logo in every theme - deep green
// ink on the light page, near-white ink on the dark one, lime leaves in both.
export function Brandmark({ height }: { height: number }) {
  const c = useTheme();
  const source = c === LIGHT ? brandDarkInk : brandWhiteInk;
  const width = Math.round(height * BRAND_ASPECT);
  return <Image source={source} style={{ width, height }} resizeMode="contain" accessibilityLabel="Prexpire" />;
}

export function Header({ badge, gutter = 14, title, onMenu, onBell }: { badge: number; gutter?: number; title?: string; onMenu: () => void; onBell: () => void }) {
  const c = useTheme();
  const s = useStyles();
  return (
    <View style={[s.header, { paddingHorizontal: gutter }]}>
      <GlassIconButton icon="menu" iconSize={24} label="Menu" onPress={onMenu} />
      {/* The section's title lives in the header strip - the Settings
          structure: Home keeps the wordmark (its intentional title), every
          other section shows its name here in the exact typography Settings'
          own header title uses. The strip's height, glass, buttons and badge
          are untouched - only the centre swaps - and because the strip rides
          the tab transition WITH the content, the title and the body enter as
          one screen. */}
      {title ? (
        <Text style={s.headerTitle} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {title}
        </Text>
      ) : (
        <Brandmark height={33} />
      )}
      <GlassIconButton icon="notifications-outline" iconSize={22} label={`${badge} notifications`} onPress={onBell}>
        <Ionicons name="notifications-outline" size={22} color={c.text} />
        {/* The reminder counter lives HERE and only here: a small red numbered
            badge on the header bell. The bottom navigation carries no counts of
            any kind — neither the reminder count nor the shopping count. */}
        {badge > 0 && (
          <View style={[s.bellBadge, { borderColor: c.bg }]}>
            <Text style={s.bellBadgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        )}
      </GlassIconButton>
    </View>
  );
}

export function AttentionCard({
  title,
  subtitle,
  onPress,
  tone = 'red',
}: {
  title: string;
  subtitle: string[];
  onPress: () => void;
  // 'red' is the urgency card; 'green' is its calm counterpart for when
  // nothing needs attention ("All caught up").
  tone?: 'red' | 'green';
}) {
  const c = useTheme();
  const s = useStyles();
  const ok = tone === 'green';
  return (
    <PressScale onPress={onPress} accessibilityRole="button" style={[s.alert, ok && s.alertOk]} scaleTo={0.985}>
      <View style={[s.alertIcon, { backgroundColor: ok ? c.okIconBg : c.alertIconBg }]}>
        {/* Red in both themes: urgency reads the same whatever the theme.
            The green twin speaks in the leaf-green family instead. */}
        <Ionicons name={ok ? 'checkmark-circle' : 'warning'} size={24} color={ok ? c.green : c.red} />
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
          <Text style={[s.sectionLink, { color: c.green }]}>{action}</Text>
          <Ionicons name="chevron-forward" size={17} color={c.green} />
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
        {/* One-line titles: the text ellipsizes with "…" when it cannot fit,
            so a long product never grows its row or squeezes the pill. */}
        <Text style={[s.rowTitle, { color: c.text }, compact && s.rowTitleCompact]} numberOfLines={1} ellipsizeMode="tail">
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
  insets: { bottom: number; left: number; right: number };
  maxWidth?: number;
  onTab: (id: TabId) => void;
  onScan: () => void;
};

// Distance from the bottom edge to the nav pill, and the space content must leave for it.
export const navOffset = (bottomInset: number) => Math.max(bottomInset - 6, 12);
export const NAV_HEIGHT = 68;

// Slot layout inside the nav pill: [home, lists, SCAN, reminders, settings] —
// the scan button owns slot 2, so the four tabs live at 0, 1, 3 and 4. The
// tab-to-tab TRAVEL of the selected chip is measured in these slots.
const SLOT: Record<TabId, number> = { home: 0, items: 1, reminders: 3, settings: 4 };
const SLOT_COUNT = 5;
// The nav pill's horizontal padding (s.nav) — the slot width is derived from
// the measured nav width minus this.
const NAV_PAD = 6;

// One bottom-nav tab. The reference's active treatment — the icon + label
// on a solid lime chip with the deep selected ink — TRAVELS now instead of a
// hard swap: on a switch the newly selected tab's chip slides in from where
// the old one sat while the old chip slides out toward the new tab and
// dissolves, so the highlight reads as one continuous movement across the
// bar. The icon also pops up to ~1.08 and settles back. Inactive tabs stay
// exactly as they were: plain, stable, muted. Everything collapses to an
// instant swap when motion is off (the Animations setting or the OS Reduce
// Motion flag), and the press feedback, dimensions, icons, labels and order
// are untouched.
function NavTab({ tab, selected, narrow, travel, onTab }: { tab: (typeof tabs)[number]; selected: boolean; narrow: boolean; travel: number; onTab: (id: TabId) => void }) {
  const c = useTheme();
  const s = useStyles();
  const { motion } = useSettings();
  // Motion/travel as refs so animation timings never retrigger a running animation.
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const travelRef = useRef(travel);
  travelRef.current = travel;
  // 0 = the chip is fully gone, 1 = fully there. Drives its opacity, its scale
  // (a touch smaller while dissolving, so it never reads as a jump) and, with
  // pillX below, the glide between tab positions.
  const chip = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const pillX = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(1)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const first = useRef(true);

  useEffect(() => {
    // The tab bar's initial state is already correct: nothing animates on load.
    if (first.current) {
      first.current = false;
      return;
    }
    // Rapid switching: stop whatever was running so animations never overlap.
    anim.current?.stop();
    const t = travelRef.current;
    if (!selected) {
      if (motionRef.current && t !== 0) {
        // The chip leaves: it slides toward the newly selected tab and
        // dissolves as the new one arrives from the opposite side.
        chip.setValue(1);
        pillX.setValue(0);
        anim.current = Animated.parallel([
          Animated.timing(chip, { toValue: 0, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(pillX, { toValue: -t, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]);
        anim.current.start();
      } else {
        chip.setValue(0);
        pillX.setValue(0);
      }
      iconScale.setValue(1);
      return;
    }
    if (!motionRef.current) {
      chip.setValue(1);
      pillX.setValue(0);
      iconScale.setValue(1);
      return;
    }
    // The chip arrives: it starts where the old tab's chip sat (offset by the
    // travel distance) and glides into place while the icon pops.
    chip.setValue(0);
    pillX.setValue(t);
    iconScale.setValue(1);
    anim.current = Animated.parallel([
      Animated.timing(chip, { toValue: 1, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(pillX, { toValue: 0, duration: 190, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      // The icon pops up to ~1.08 and settles back to 1 — one short breath,
      // never a bounce.
      Animated.sequence([
        Animated.timing(iconScale, { toValue: 1.08, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(iconScale, { toValue: 1, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    ]);
    anim.current.start();
    return () => {
      anim.current?.stop();
    };
  }, [selected, chip, pillX, iconScale]);

  const chipScale = chip.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
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
      <View style={s.tabChip}>
        {/* The selected chip's lime pill, drawn as an absolute layer BEHIND the
            icon and label so it can glide in and out on its own without ever
            touching the tab's layout. pointerEvents none because it is purely
            decorative: after a switch the departed chip rests INVISIBLE
            (opacity 0) over a neighbouring tab's button, and browsers still
            hit-test opacity-0 elements - without this the ghost pill would
            swallow that tab's clicks (and bubble them to the WRONG tab). */}
        <Animated.View
          pointerEvents="none"
          style={[s.tabChipPill, { opacity: chip, transform: [{ translateX: pillX }, { scale: chipScale }] }]}
        />
        <Animated.View style={{ transform: [{ scale: iconScale }] }}>
          <Ionicons name={selected ? tab.iconOn : tab.icon} size={24} color={selected ? c.scanInk : c.textMuted} />
        </Animated.View>
        <Text
          style={[s.tabLabel, narrow && s.tabLabelNarrow, { color: selected ? c.scanInk : c.textMuted }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {tab.label}
        </Text>
      </View>
    </PressScale>
  );
}

// The bottom navigation is PERMANENT: it never hides, fades, moves or changes
// with scrolling in any way (only the top header auto-hides - see
// navAutohide.tsx). Because it is an absolute overlay that never participates
// in layout, showing or hiding the header cannot move it or resize the
// scroller, and every screen pads its content bottom so the last item stays
// reachable above the bar.
export function BottomNav({ active, insets, maxWidth = 560, onTab, onScan }: BottomNavProps) {
  const c = useTheme();
  const s = useStyles();
  // Narrow phones give the four tabs a little more room so labels are not clipped.
  const narrow = useWindowDimensions().width < 360;
  const sideMargin = narrow ? 8 : 16;
  const { motion } = useSettings();
  const motionRef = useRef(motion);
  motionRef.current = motion;
  // The nav pill's measured width: the slot width (and so the chip's travel
  // distance between tabs) is derived from it.
  const [navW, setNavW] = useState(0);
  // The tab that was active on the previous render: a switch computes the
  // signed slot distance the chip travels (0 = first render or same tab).
  const prevTab = useRef<TabId | null>(null);
  const travel =
    prevTab.current && prevTab.current !== active && navW > 0 && motionRef.current
      ? (SLOT[prevTab.current] - SLOT[active]) * ((navW - NAV_PAD * 2) / SLOT_COUNT)
      : 0;
  prevTab.current = active;
  const renderTab = (tab: (typeof tabs)[number]) => (
    <NavTab key={tab.id} tab={tab} selected={tab.id === active} narrow={narrow} travel={travel} onTab={onTab} />
  );

  return (
    <View
      pointerEvents="box-none"
      style={[s.navWrap, { bottom: navOffset(insets.bottom), left: sideMargin + insets.left, right: sideMargin + insets.right }]}
    >
      <View style={[s.navShadow, { maxWidth }]}>
        <View style={[s.nav, s.navFallback]} onLayout={(e) => setNavW(e.nativeEvent.layout.width)}>
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
  // A section title in the strip, in the exact typography Settings' own
  // header title uses (30 / 800 / -0.6): flex 1 seats it right after the
  // menu button the way Settings' title sits after its back button, and the
  // horizontal margins keep it clear of both glass circles without touching
  // the wordmark's centred layout on Home (the margins only exist when a
  // title is shown). Shrinks gracefully on the narrowest phones.
  headerTitle: { flex: 1, marginHorizontal: 12, color: c.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.6 },
  // The header bell's reminder counter — the one numbered badge in the app.
  // Red for urgency (the same red the expiry cards speak), edged with a
  // hairline of the page background so it reads as cut out of the glass
  // circle. Capped at 99+ so three digits can never burst the little pill.
  bellBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    minWidth: 17,
    height: 17,
    borderRadius: 8.5,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: c.red,
  },
  bellBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
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
  // The calm green twin of the attention card.
  alertOk: { borderColor: c.okBorder, backgroundColor: c.okBg },
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
    // A fine hairline on BOTH themes now: the light page's white cards need
    // the #DFECE5 edge to stay visible on the near-white page.
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    ...(c === LIGHT ? CARD_SHADOW : null),
  },
  rowIcon: { width: 44, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowCompact: { minHeight: 48, paddingVertical: 5, gap: 9 },
  rowIconCompact: { width: 36, height: 32, borderRadius: 10 },
  rowTitle: { color: c.text, fontSize: 15.5, fontWeight: '600', lineHeight: 20 },
  rowTitleCompact: { fontSize: 14.5, lineHeight: 18 },
  rowSub: { color: c.textMuted, fontSize: 12.5, fontWeight: '400', marginTop: 1 },
  pill: { height: 30, paddingHorizontal: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 14, fontWeight: '600' },
  pillCompact: { height: 26, paddingHorizontal: 9 },
  pillTextCompact: { fontSize: 13 },
  navWrap: { position: 'absolute', alignItems: 'center' },
  navShadow: {
    width: '100%',
    borderRadius: 34,
    shadowColor: '#000',
    // The white nav pill floats on a soft airy shadow on the light page;
    // the dark glass pill keeps its deeper anchor.
    shadowOpacity: c === LIGHT ? 0.13 : 0.45,
    shadowRadius: c === LIGHT ? 14 : 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
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
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 68 },
  // The tab's chip: the layout container for the icon + label (the lime pill
  // below fills it). Always transparent itself - selection is the pill's job.
  tabChip: { alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 6, paddingHorizontal: 11 },
  // The selected chip's lime pill (the reference's active-tab green, the
  // theme's own selected surface): an absolute layer behind the icon + label,
  // so it can glide between tab positions without ever touching the layout.
  tabChipPill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, backgroundColor: c.selBg },
  tabLabel: { fontSize: 11.5, fontWeight: '500' },
  tabLabelNarrow: { fontSize: 10.5 },
  scan: { width: 50, height: 50, borderRadius: 25, backgroundColor: c.scan, alignItems: 'center', justifyContent: 'center' },
  scanLine: { position: 'absolute', width: 16, height: 2.5, borderRadius: 2, backgroundColor: c.scanInk },
}));
