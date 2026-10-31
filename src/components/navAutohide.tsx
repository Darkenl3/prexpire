import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { GLASS_STRIP_FX, Header } from './HomeComponents';

// Auto-hide navigation: scrolling down collapses ONLY the top header; scrolling
// up brings it back. The bottom navigation is deliberately NOT part of this
// system - it is permanent (see BottomNav) - so nothing at the bottom edge of
// the screen ever moves, fades or reacts to scrolling, and no scroll direction
// can make the interface appear and disappear at the bottom while you scroll.
//
// The tracker deliberately reads the scroll position from SEVERAL redundant
// sources, because iOS WebViews can deliver inner-element scroll events
// sparsely or stop mid-gesture (a long-standing WebKit quirk):
//   1. a capture-phase listener on the document - scroll events do not
//      bubble, but they DO travel the capture path, so one listener sees
//      every scrollable element in the page;
//   2. a requestAnimationFrame poll that reads the scroller's scrollTop
//      directly every frame while scrolling is active - this works even if
//      no scroll event fires at all, and it keeps running through momentum;
//   3. the ScrollView's own onScroll prop as an extra "keep polling" kick.
// The direction decision itself is jitter-proof (same-sign deltas accumulate
// until decisive; a sign flip restarts the count) and always shows the chrome
// in the top zone of the page, exactly like YouTube.
//
// State updates only happen on an actual direction CHANGE (hidden is a
// boolean, not a per-frame value), and the reveal/hide animation is a single
// transform tween on an overlay - so nothing here can resize the scroller,
// clamp the scroll position mid-gesture, or retrigger itself every frame.

// Keep in sync with the header's own height in HomeComponents.tsx.
export const HEADER_HEIGHT = 64;
// How far the position must move (net) before we call it a direction.
const DECIDE_PX = 8;
// Within this distance of the bottom edge, direction changes need the bigger
// EDGE_DECIDE_PX net movement (rubber-band settle tails stay under it, real
// flicks clear it in a single frame).
const EDGE_DECIDE_PX = 24;
// The top of the page always shows the chrome (YouTube shows its bars there).
const TOP_ZONE = 48;
// A direction CHANGE is accepted only this long after the previous one:
// anything faster is flutter, not intent. Without this, any stray oscillation
// (a settle tail, a clamped position) could rattle the header in and out while
// the user simply holds the scroll - now the header changes at most ~4 times a
// second, and a real reverse flick after a real scroll is never this fast.
const MIN_DWELL_MS = 240;
// The rAF poll stops after this many frames with no movement (~0.5s).
const IDLE_FRAMES = 30;

// Applied to every main screen scroller: modern engines (iOS 16+ WebKit,
// Chromium, Android) make the list simply STOP at its end - no rubber-band,
// no out-of-range positions, no overscroll glow - exactly like YouTube's
// lists. Older engines ignore the property and fall back to the range
// clamping inside decide() above, so both generations of iOS are covered.
export const NO_RUBBER_BAND = { overscrollBehavior: 'none' } as ViewStyle;

export function useNavAutohide() {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const acc = useRef(0);
  const hiddenRef = useRef(false);
  const lastFlip = useRef(0);
  // The element currently being polled, the rAF handle, and the last raw
  // position seen by the poll (for idle detection).
  const tracked = useRef<HTMLElement | null>(null);
  const raf = useRef(0);
  const lastPolled = useRef(0);
  const idle = useRef(0);

  const decide = useCallback((rawY: number) => {
    // Clamp the position into the scroller's REAL range first: while a list
    // rubber-bands past its end, iOS reports out-of-range positions (the
    // overshoot and its settle-back). Unclamped, that oscillation flips the
    // direction back and forth - the "bar jumps when you reach the bottom"
    // bug. Clamped, the overshoot and the settle-back cancel out and never
    // reach the decision threshold.
    const el = tracked.current;
    const maxY = el ? Math.max(0, el.scrollHeight - el.clientHeight) : Number.POSITIVE_INFINITY;
    const y = Math.min(Math.max(rawY, 0), maxY);
    const dy = y - lastY.current;
    lastY.current = y;
    // Jitter-proof accumulation: same-sign deltas add up until decisive,
    // a sign flip restarts the count (tiny wiggles cancel out).
    acc.current = Math.sign(dy) === Math.sign(acc.current) ? acc.current + dy : dy;
    let goingDown: boolean;
    if (y <= TOP_ZONE) {
      goingDown = false; // the top of the page always shows the chrome
      acc.current = 0;
    } else {
      // Near the bottom edge a direction change needs a bigger net movement:
      // a real flick moves dozens of pixels per frame, while the tail of a
      // rubber-band settle wiggles by a few - this keeps the very end of a
      // list from toggling the bars while staying invisible to real scrolls.
      const nearBottom = maxY !== Number.POSITIVE_INFINITY && y >= maxY - 12;
      const threshold = nearBottom ? EDGE_DECIDE_PX : DECIDE_PX;
      if (Math.abs(acc.current) >= threshold) {
        goingDown = acc.current > 0;
        acc.current = 0;
      } else {
        return; // not decisive yet
      }
    }
    const changed = goingDown !== hiddenRef.current;
    const now = typeof Date !== 'undefined' ? Date.now() : 0;
    // Flutter guard: a direction change inside MIN_DWELL_MS of the previous
    // one is noise, not intent - hold the current state and wait. Real
    // gestures (scroll a while, then genuinely reverse) always clear it.
    if (changed && now - lastFlip.current < MIN_DWELL_MS) return;
    if (changed) {
      lastFlip.current = now;
      hiddenRef.current = goingDown;
      setHidden(goingDown);
    }
  }, []);

  // The poll: read the scroller's scrollTop every frame and decide. This is
  // what makes the tracker immune to missing scroll events - the position is
  // read straight from the element, events or not.
  const poll = useCallback(() => {
    raf.current = 0;
    const el = tracked.current;
    if (el) {
      const y = el.scrollTop;
      if (y !== lastPolled.current) {
        lastPolled.current = y;
        idle.current = 0;
        decide(y);
      } else {
        idle.current += 1;
      }
    }
    if (idle.current < IDLE_FRAMES && typeof requestAnimationFrame !== 'undefined') {
      raf.current = requestAnimationFrame(poll);
    }
  }, [decide]);

  const kick = useCallback(
    (el?: HTMLElement | null) => {
      if (el && el !== tracked.current) {
        // A different scroller took over (a sheet, a freshly opened tab):
        // start fresh from its position so the switch itself is not read
        // as a jump - clamped into the scroller's range, so taking over
        // mid-bounce is not read as movement either.
        tracked.current = el;
        const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
        lastY.current = Math.min(Math.max(el.scrollTop, 0), maxY);
        lastPolled.current = el.scrollTop;
        acc.current = 0;
      }
      idle.current = 0;
      if (!raf.current && typeof requestAnimationFrame !== 'undefined') {
        raf.current = requestAnimationFrame(poll);
      }
    },
    [poll],
  );

  // Extra kick from the ScrollView's own onScroll prop (browsers deliver it
  // reliably; on iOS it may be sparse - the poll covers the gaps).
  const onScroll = useCallback(() => {
    kick();
  }, [kick]);

  useEffect(() => {
    // A freshly opened screen starts at the top: show the header again. The
    // previous tab may have left it hidden.
    hiddenRef.current = false;
    lastY.current = 0;
    acc.current = 0;
    setHidden(false);
    if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
    // A capture-phase listener: sees scroll events from EVERY scrollable
    // element (scroll does not bubble, but it does capture). Document-level
    // scrolling is deliberately ignored: when a nested list hits its end on
    // iOS the remaining gesture chains to the page, whose own position
    // (and rubber-band) has nothing to do with the list the user scrolls.
    // Scrollers OUTSIDE the app root are ignored too: react-native-web
    // renders Modal content into a portal on the body, so a picker sheet or
    // dialog scrolling is not the page scrolling - the chrome behind it
    // must not react.
    const appRoot = document.getElementById('root');
    const onAnyScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target === document.documentElement || target === document.body) return;
      if (appRoot && !appRoot.contains(target)) return;
      kick(target);
    };
    document.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onAnyScroll, true);
      if (raf.current && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [kick]);

  return { hidden, onScroll };
}

// The top header strip that slides up and collapses away when the page scrolls
// down. It is an OVERLAY, not a layout row: it floats above the scrolling
// content (which pads its top by HEADER_HEIGHT instead), so hiding it never
// resizes the scroller. That is the difference between YouTube's feel and
// the old bug where collapsing the header visibly yanked the content upward
// ("scrolling faster") and, near the bottom edge, the resized scroller's
// clamped positions oscillated the direction back and forth (the bars
// flickering in and out while the user held the scroll). Only this header
// ever hides - the bottom navigation stays on screen the whole time.
//
// On Home the strip carries the wordmark; on every other section it carries
// that section's title (the Settings structure: the title lives in the
// header). A section's strip also LEADS with the compact back circle to Home
// instead of Home's menu circle, and carries no bell - the quiet back +
// title pair Settings' own header uses. The strip rides the tab transition
// WITH the screen's body, so the title and the content always enter as one
// screen - never a header that lags behind or a title that swaps separately
// from the body.
export function AutohideHeader({
  hidden,
  badge,
  title,
  gutter = 0,
  maxWidth,
  onMenu,
  onBell,
  onBack,
}: {
  hidden: boolean;
  badge: number;
  // The section's name, shown in the strip. Omitted on Home, where the
  // wordmark is the intentional title.
  title?: string;
  // Matches the page's content column so the title lines up with it.
  gutter?: number;
  maxWidth?: number;
  onMenu?: () => void;
  onBell?: () => void;
  // The Settings-style back circle for a section strip (Items, Shopping
  // List, Reminders): replaces the menu circle and leaves the bell off.
  onBack?: () => void;
}) {
  const c = useTheme();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: hidden ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [hidden, t]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -HEADER_HEIGHT - 12] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  return (
    <Animated.View
      pointerEvents={hidden ? 'none' : 'auto'}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        elevation: 40,
        // LIQUID GLASS, like the scanner's top chrome and the bottom nav
        // pill: a translucent tint over a frosted backdrop blur, so page
        // content scrolling under the bar frosts through instead of being
        // covered by a flat opaque strip — and the glass circle buttons on
        // top finally have something behind them to refract (over an opaque
        // bar their own blur had nothing to show, which is why the glass
        // never read before). The tint stays strong enough that the bar
        // still "covers" in the YouTube sense: content under it is blurred
        // and dimmed, never legible, so the returning bar never fights the
        // wordmark. react-native-web passes backdropFilter (and the
        // -webkit- spelling older iOS needs) straight to the DOM; platforms
        // without it just see the translucent tint.
        backgroundColor: c.glassHeaderBg,
        ...(GLASS_STRIP_FX as ViewStyle),
        transform: [{ translateY }],
        opacity,
      }}
    >
      <View style={{ alignSelf: 'center', width: '100%', maxWidth, paddingHorizontal: gutter }}>
        <Header badge={badge} title={title} gutter={0} onMenu={onMenu} onBell={onBell} onBack={onBack} />
      </View>
    </Animated.View>
  );
}
