import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useTheme } from '../theme';
import { useSettings } from '../settings';
import { NAV_HEIGHT, navOffset } from './HomeComponents';
import { useWebKeyboardInset } from './WebKeyboardInset';

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
//   • OPEN/CLOSE ANIMATION — the iOS sheet language: the sheet rises from
//     below the screen edge on a soft spring (a touch of settle, no bounce)
//     and slides fully back down on close, and the scrim's dimming is tied to
//     the sheet's position, so it lightens as the sheet goes. Motion settings
//     and the OS reduce-motion flag make both instant. Rapid open/close never
//     glitches: every open restarts from the entry pose.
//   • DISMISSAL — swipe down on the grabber/title row: the sheet follows the
//     finger (pulling UP meets a rubber-band resistance), the scrim lightens
//     with it, and on release it closes past 90 px or with downward speed,
//     otherwise it springs back carrying the finger's velocity. Tap the
//     scrim, the footer's Cancel, or the back/Escape key also close it. The swipe responder lives ONLY on the header row, so scrolling
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

  // The rise animation (0 = below the screen edge, 1 = in place) plus the
  // live drag offset from the swipe gesture; the sheet rides on their sum.
  // The travel is the sheet's own measured height, so it starts fully hidden.
  const rise = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const [height, setHeight] = useState(0);
  const travel = Math.max(height, 320) + 24;
  const sheetY = Animated.add(rise.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }), drag);
  // The scrim dims with the rise and lightens as the sheet is dragged down.
  const scrim = Animated.multiply(rise, drag.interpolate({ inputRange: [0, travel], outputRange: [1, 0.15], extrapolate: 'clamp' }));

  useEffect(() => {
    if (visible) {
      drag.setValue(0);
      rise.setValue(0);
      if (motionRef.current) Animated.spring(rise, { toValue: 1, damping: 26, stiffness: 240, mass: 0.9, useNativeDriver: true }).start();
      else rise.setValue(1);
    }
  }, [visible, rise, drag]);

  const requestClose = useCallback(() => {
    // From wherever the sheet is (dragged or not), all the way down.
    Animated.timing(rise, { toValue: 0, duration: motionRef.current ? 240 : 0, easing: Easing.bezier(0.32, 0, 0.67, 0), useNativeDriver: true }).start(() => {
      drag.setValue(0);
      onClose();
    });
  }, [rise, drag, onClose]);

  // Swipe-to-dismiss, captured ONLY on the header row (grabber + title) so
  // the content's own scrolling is never stolen. A clear downward drag
  // follows the finger; releasing past the distance/velocity thresholds
  // closes, anything else springs back.
  // The latest close, for the responder created once below.
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > DRAG_CAPTURE && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      // Pulling the sheet down while typing: the keyboard goes away at once,
      // so the sheet follows the finger instead of fighting the keyboard.
      onPanResponderGrant: () => {
        if (typeof document !== 'undefined') {
          const el = document.activeElement as HTMLElement | null;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) el.blur();
        }
      },
      onPanResponderMove: (_e, g) => {
        // Down follows the finger; up meets a rubber band (a few px at most).
        drag.setValue(g.dy > 0 ? g.dy : -18 * (1 - Math.exp(g.dy / 60)));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY) requestCloseRef.current();
        else Animated.spring(drag, { toValue: 0, velocity: g.vy, damping: 22, stiffness: 320, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(drag, { toValue: 0, damping: 22, stiffness: 320, useNativeDriver: true }).start();
      },
    }),
  ).current;

  // The phone keyboard (web / the iPhone app's WebView): the sheet sits right
  // on top of it and shrinks to the space that's left, so the field being
  // typed in stays in view. iOS also shoves the whole page up to reveal a
  // focused field; with the sheet already above the keys that shove is only
  // a jump, so it's undone.
  const keyboard = useWebKeyboardInset();
  useEffect(() => {
    if (!visible || typeof window === 'undefined') return;
    const vv = (window as unknown as { visualViewport?: { offsetTop: number; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } }).visualViewport;
    if (!vv) return;
    const settle = () => {
      if (vv.offsetTop > 0) window.scrollTo(0, 0);
    };
    vv.addEventListener('scroll', settle);
    vv.addEventListener('resize', settle);
    return () => {
      vv.removeEventListener('scroll', settle);
      vv.removeEventListener('resize', settle);
    };
  }, [visible]);
  // The full page height minus the keyboard. (On the web the window size React
  // Native reports already shrinks with the keyboard, so measure the page.)
  const pageHeight = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : win.height;
  const visibleHeight = pageHeight - keyboard;
  // The sheet's height budget: never above this ratio of the window, and
  // never reaching into the status-bar/header zone.
  const maxHeight = Math.max(keyboard ? 200 : 240, Math.min(visibleHeight * (keyboard ? 1 : maxHeightRatio), visibleHeight - insets.top - 24));
  // Bottom clearance: the home-indicator inset, plus the bottom navigation's
  // zone (the app's pill on the web, the native glass bar inside the shell)
  // so the last row and every action button sit fully clear of it. With the
  // keyboard up, both are behind the keys: a small margin is enough.
  const navZone = shellEmbedded() ? SHELL_NAV_ZONE : NAV_HEIGHT + navOffset(insets.bottom) + 12;
  const bottomPad = keyboard ? 12 : Math.max(insets.bottom, 12) + 8 + navZone;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={requestClose} {...({ 'aria-modal': true } as object)}>
      <View style={[s.wrap, keyboard ? { paddingBottom: keyboard } : null]}>
        <Animated.View style={[StyleSheet.absoluteFill, s.scrim, { opacity: scrim }]} pointerEvents="none" />
        <Pressable style={[StyleSheet.absoluteFill, { touchAction: 'none' } as object]} onPress={requestClose} accessibilityLabel={`Close ${title}`} importantForAccessibility="no" />
        <Animated.View
          onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}
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
            showsVerticalScrollIndicator={false}
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
  wrap: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(3,7,9,0.5)' },
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
  // A taller header gives the swipe a generous grip.
  // touchAction none: the browser hands this area's swipes to the sheet
  // instead of scrolling the page (iOS scrolls the page when the keyboard is up).
  header: { alignItems: 'center', paddingTop: 2, ...({ touchAction: 'none' } as object) },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.separator, alignSelf: 'center', marginTop: 6 },
  title: { color: c.textMuted, fontSize: 15, fontWeight: '600', textAlign: 'center', paddingVertical: 12, alignSelf: 'stretch' },
  scroll: { flexShrink: 1 },
  scrollContent: { paddingBottom: 4 },
  footer: { paddingTop: 10 },
}));
