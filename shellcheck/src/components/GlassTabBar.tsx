import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ShellTab = 'home' | 'items' | 'shop' | 'reminders' | 'settings';

// Same tabs (and icons) as the website's own bottom nav, so the two feel identical.
const TABS: { id: ShellTab; label: string; icon: keyof typeof Ionicons.glyphMap; iconOn: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'home', label: 'Home', icon: 'home-outline', iconOn: 'home' },
  { id: 'items', label: 'Lists', icon: 'list', iconOn: 'list' },
  { id: 'shop', label: 'Shopping', icon: 'cart-outline', iconOn: 'cart' },
  { id: 'reminders', label: 'Reminders', icon: 'notifications-outline', iconOn: 'notifications' },
  { id: 'settings', label: 'Settings', icon: 'settings-sharp', iconOn: 'settings-sharp' },
];

// Slot layout inside the pill: [home, items, shop, SCAN, reminders, settings].
const SLOT: Record<ShellTab, number> = { home: 0, items: 1, shop: 2, reminders: 4, settings: 5 };
const SLOT_COUNT = 6;

// Liquid glass, per the latest reference: a barely-tinted frosted blur, a
// near-invisible hairline on the pill itself, and a soft white low-opacity
// highlight with NO ring — the active marker and the scan button speak the
// same borderless language.
const GLASS_TINT = 'rgba(11,22,26,0.22)';
const PILL_BORDER = 'rgba(255,255,255,0.12)';
const HIGHLIGHT_BG = 'rgba(255,255,255,0.12)';
const HIGHLIGHT_ICON = '#F1F5F4';
const INACTIVE_ICON = '#9AA7AD';

// The sliding active marker: YouTube's round spotlight that glides between
// tabs when the selection changes.
const DOT = 38;
const BAR_H = 60;

// Real liquid glass (iOS 26+)? On every other platform GlassView is just a
// plain View, so the pill gets a translucent smoked fill there instead —
// on real glass we leave it pure, so the content scrolling underneath the
// bar shows through the frosted blur.
const HAS_GLASS = isLiquidGlassAvailable();

/**
 * YouTube-style floating liquid-glass tab bar (their latest iOS 26 refresh):
 * a barely-tinted frosted pill floating near the bottom edge of the screen
 * (the Expo Go bar zone), fully rounded ends, icon-only tabs, a round white
 * low-opacity marker (no ring) that GLIDES between tabs (YouTube's
 * transition), and a matching scan circle in the center — with a Shopping
 * tab so the shell's bar matches the website's five-tab nav one for one.
 *
 * The bar is PERMANENT while the user browses: it never hides, slides, fades
 * or reacts to scrolling in any way (the website hides only its TOP header on
 * scroll-down, and it handles that entirely on its side). The one thing that
 * moves the bar is the camera: while a scanner screen is open (the shell's
 * own or the website's), it slides the FULL pill height plus its offsets off
 * the screen and fades out at the same time, so nothing of it remains
 * visible — and it slides back in the moment the scanner closes.
 */
export function GlassTabBar({ active, badge, shopBadge = 0, visible, onTab, onScan }: {
  active: ShellTab;
  badge: number;
  // Open Shopping List entries, shown on the Shopping tab (information, not urgency).
  shopBadge?: number;
  visible: boolean;
  onTab: (tab: ShellTab) => void;
  onScan: () => void;
}) {
  const insets = useSafeAreaInsets();
  // Narrow phones pull the pill closer to the edges so six slots still fit.
  const narrow = useWindowDimensions().width < 360;
  const side = narrow ? 16 : 28;
  // How high the pill rides above the very bottom edge of the screen. 8
  // overlaps the home-indicator zone exactly like Expo Go's and YouTube's
  // bars do; 22 (kept at your tuned value) clears it a little. Pure taste —
  // change this one number freely (see the README's 8–22 note).
  const float = 22;

  // Auto-hide: one progress value drives both the slide and the fade. The
  // slide distance is the full pill height plus its bottom offset (plus a
  // little margin), so the bar leaves the screen completely.
  const hideT = useRef(new Animated.Value(0)).current;
  const hideY = BAR_H + float + 12;
  useEffect(() => {
    Animated.timing(hideT, {
      toValue: visible ? 0 : 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, hideT]);
  const translateY = hideT.interpolate({ inputRange: [0, 1], outputRange: [0, hideY] });
  const opacity = hideT.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  // The active marker glides between slots (YouTube's tab transition).
  const [width, setWidth] = useState(0);
  const dotX = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  const dotFor = useCallback(
    (w: number, tab: ShellTab) => {
      const slot = (w - 16) / SLOT_COUNT; // pill content width, minus its side padding
      const cx = 8 + SLOT[tab] * slot + slot / 2; // center of that slot
      return cx - DOT / 2;
    },
    [],
  );
  useEffect(() => {
    if (!width) return;
    const x = dotFor(width, active);
    if (!placed.current) {
      dotX.setValue(x); // first placement: appear in place, no glide
      placed.current = true;
      return;
    }
    Animated.timing(dotX, { toValue: x, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [active, width, dotFor, dotX]);

  const renderTab = (tab: (typeof TABS)[number]) => {
    const selected = tab.id === active;
    return (
      <Pressable
        key={tab.id}
        onPress={() => onTab(tab.id)}
        style={({ pressed }) => [s.tab, pressed && s.pressed]}
        accessibilityRole="tab"
        aria-selected={selected}
        accessibilityLabel={tab.label}
        accessibilityState={{ selected }}
      >
        <View style={s.iconBox}>
          <Ionicons name={selected ? tab.iconOn : tab.icon} size={23} color={selected ? HIGHLIGHT_ICON : INACTIVE_ICON} />
          {tab.id === 'reminders' && badge > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeText}>{badge > 9 ? '9+' : badge}</Text>
            </View>
          )}
          {tab.id === 'shop' && shopBadge > 0 && (
            <View style={[s.badge, s.shopBadge]}>
              <Text style={s.shopBadgeText}>{shopBadge > 9 ? '9+' : shopBadge}</Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        s.wrap,
        {
          bottom: float,
          left: side + insets.left,
          right: side + insets.right,
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <GlassView
        glassEffectStyle="regular"
        tintColor={GLASS_TINT}
        style={[s.pill, !HAS_GLASS && s.pillFallback]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {/* The gliding active marker — under the icons, above the glass. */}
        <Animated.View pointerEvents="none" style={[s.dot, { transform: [{ translateX: dotX }] }]} />
        {renderTab(TABS[0])}
        {renderTab(TABS[1])}
        {renderTab(TABS[2])}
        <View style={s.tab}>
          <Pressable
            onPress={onScan}
            style={({ pressed }) => [s.scan, pressed && s.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Scan a label"
          >
            <Ionicons name="scan-outline" size={24} color={HIGHLIGHT_ICON} />
          </Pressable>
        </View>
        {renderTab(TABS[3])}
        {renderTab(TABS[4])}
      </GlassView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // Floating pill: fully rounded ends, sitting flush near the bottom edge of
  // the screen (YouTube/Expo Go style), inset from the sides so it sits a bit
  // shorter than the full screen width.
  wrap: { position: 'absolute', alignItems: 'center' },
  pill: {
    width: '100%',
    height: BAR_H,
    borderRadius: BAR_H / 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: PILL_BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  // Only where real liquid glass is unavailable (Android / iOS < 26):
  // a lighter smoked fill so the bar stays readable without blur behind it.
  pillFallback: { backgroundColor: 'rgba(12,24,27,0.5)' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', height: BAR_H },
  pressed: { opacity: 0.75, transform: [{ scale: 0.96 }] },
  // The gliding round marker: YouTube's active spotlight — soft white, no ring.
  dot: {
    position: 'absolute',
    top: 11,
    left: 0,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: HIGHLIGHT_BG,
  },
  iconBox: { height: 34, alignItems: 'center', justifyContent: 'center' },
  // Center accent: the same soft white treatment, in circle form — no ring.
  scan: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HIGHLIGHT_BG,
  },
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5484D',
  },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  // The Shopping tab's count uses the app's mint accent rather than red: it is
  // information, not urgency (the same rule the website's own nav follows).
  shopBadge: { backgroundColor: '#2EE8B6' },
  shopBadgeText: { color: '#04241B', fontSize: 11, fontWeight: '700' },
});
