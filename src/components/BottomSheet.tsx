import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useTheme } from '../theme';
import { useSettings } from '../settings';
import { NAV_HEIGHT, navOffset } from './HomeComponents';

// The shared bottom sheet every expandable panel in the app sits on (Filter &
// Sort, the settings value pickers, and any future panel). It owns the whole
// chrome contract in one place:
//
//   • SAFE AREAS + NAVIGATION CLEARANCE — the sheet's bottom padding always
//     clears the device's home-indicator inset AND the zone the bottom
//     navigation occupies (the website's own pill on the web; the native
//     glass bar when running inside the Expo shell, where that bar floats
//     above the WebView). Content and action buttons can never touch or hide
//     behind the navigation.
//   • MAX HEIGHT + SCROLLING — the sheet never grows past the available
//     screen space; longer content scrolls inside it.
//   • OPEN/CLOSE ANIMATION — one consistent language: the sheet rises 220 ms
//     (out-cubic) on open and settles 190 ms (in-cubic) on close, with the
//     scrim fading alongside (the Modal's fade). Motion settings and the OS
//     reduce-motion flag collapse both to zero. Rapid open/close never
//     glitches: every open restarts from the entry pose.
//   • DISMISSAL — swipe down on the grabber/title row (the drag follows the
//     finger; past 90 px or with downward velocity it closes, otherwise it
//     springs back), tap the scrim, the footer's Cancel, or the back/Escape
//     key. The swipe responder lives ONLY on the header row, so scrolling
//     inside the content can never be stolen or accidentally dismiss.
//
// The sheet does not change its callers' content: rows, sections, checkmarks
// and buttons keep their own styles; only the frame is shared.

type Props = {
  visible: boolean;
  // Runs the close animation first, then unmounts (the parent flips its
  // open flag here).
  onClose: () => void;
  // The sheet's heading; the whole header row doubles as the drag handle.
  title: string;
  // Extra context for screen readers.
  accessibilityLabel?: string;
  // The sheet's body. Scroll it like any list; the sheet caps its height.
  children: ReactNode;
  // Pinned under the scrolling body (the Cancel row and any actions).
  footer?: ReactNode;
  // False only for sheets whose content must never scroll (tiny sheets).
  scrollable?: boolean;
  // Fraction of the window height the sheet may occupy at most.
  maxHeightRatio?: number;
  maxWidth?: number;
};

// Drag-to-dismiss tuning: how far down (px) or how fast (px/ms) a release
// must go before the swipe counts as "close", and how the sheet behaves
// before that point.
const DISMISS_DISTANCE = 90;
const DISMISS_VELOCITY = 0.8;
const DRAG_CAPTURE = 6;

// Inside the Expo shell the native glass tab bar (float 22 + height 60)
// rides above the WebView; on the open web the app's own pill (68 + its
// float) sits in the same zone. Both leave roughly this much clear space.
const SHELL_NAV_ZONE = 72;

function shellEmbedded(): boolean {
  return typeof window !== 'undefined' && !!(window as { ReactNativeWebView?: unknown }).ReactNativeWebView;
}

export function BottomSheet({ visible, onClose, title, accessibilityLabel, children, footer, scrollable = true, maxHeightRatio = 0.8, maxWidth = 480 }: Props) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const s = useStyles();
  const { motion } = useSettings();
  // Motion as a ref so animation timings never retrigger a running animation.
  const motionRef = useRef(motion);
  motionRef.current = motion;

  // The rise animation (0 = fully down, 1 = in place) plus the live drag
  // offset from the swipe gesture; the sheet rides on their sum.
  const rise = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const sheetY = Animated.add(
    rise.interpolate({ inputRange: [0, 1], outputRange: [64, 0] }),
    drag,
  );

  useEffect(() => {
    if (visible) {
      drag.setValue(0);
      rise.setValue(0);
      Animated.timing(rise, { toValue: 1, duration: motionRef.current ? 220 : 0, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [visible, rise, drag]);

  const requestClose = useCallback(() => {
    drag.setValue(0);
    Animated.timing(rise, { toValue: 0, duration: motionRef.current ? 190 : 0, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => onClose());
  }, [rise, drag, onClose]);

  // Swipe-to-dismiss, captured ONLY on the header row (grabber + title) so
  // the content's own scrolling is never stolen. A clear downward drag
  // follows the finger; releasing past the distance/velocity thresholds
  // closes, anything else springs back.
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => g.dy > DRAG_CAPTURE && g.dy > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) drag.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) requestClose();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  // The sheet's height budget: never above this ratio of the window, and
  // never reaching into the status-bar/header zone.
  const maxHeight = Math.max(240, Math.min(win.height * maxHeightRatio, win.height - insets.top - 24));
  // Bottom clearance: the home-indicator inset, plus the bottom navigation's
  // zone (the app's pill on the web, the native glass bar inside the shell)
  // so the last row and every action button sit fully clear of it.
  const navZone = shellEmbedded() ? SHELL_NAV_ZONE : NAV_HEIGHT + navOffset(insets.bottom) + 12;
  const bottomPad = Math.max(insets.bottom, 12) + 8 + navZone;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={requestClose} {...({ 'aria-modal': true } as object)}>
      <View style={s.wrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} accessibilityLabel={`Close ${title}`} importantForAccessibility="no" />
        <Animated.View
          style={[s.sheet, { backgroundColor: c.dialogBg, maxWidth, maxHeight, paddingBottom: bottomPad, transform: [{ translateY: sheetY }] }]}
          accessibilityRole={'dialog' as never}
          accessibilityLabel={accessibilityLabel ?? title}
        >
          {/* The drag handle: the whole header row accepts the swipe-down. */}
          <View {...pan.panHandlers} style={s.header} accessible accessibilityLabel={`${title}. Swipe down to close.`}>
            <View style={s.grabber} />
            <Text style={s.title} accessibilityRole="header">
              {title}
            </Text>
          </View>
          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            scrollEnabled={scrollable}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {children}
          </ScrollView>
          {footer ? <View style={s.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(3,7,9,0.5)' },
  sheet: {
    width: '100%',
    alignSelf: 'center',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    paddingTop: 6,
    paddingHorizontal: 14,
  },
  header: { alignItems: 'center' },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.separator, alignSelf: 'center', marginTop: 6 },
  title: { color: c.textMuted, fontSize: 15, fontWeight: '600', textAlign: 'center', paddingVertical: 12, alignSelf: 'stretch' },
  scroll: { flexShrink: 1 },
  scrollContent: { paddingBottom: 4 },
  footer: { paddingTop: 10 },
}));
