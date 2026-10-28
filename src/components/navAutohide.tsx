import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { Header } from './HomeComponents';

// YouTube-style auto-hide navigation: scrolling down collapses the header (and,
// inside the native Expo shell, the liquid-glass tab bar slides away too);
// scrolling up brings them back. Each screen owns its own tracker so the
// header always starts visible when a tab opens.
//
// The tracker deliberately reads the scroll position from SEVERAL redundant
// sources, because iOS WebViews can deliver inner-element scroll events
// sparsely or stop mid-gesture (a long-standing WebKit quirk):
//   1. a capture-phase listener on the document — scroll events do not
//      bubble, but they DO travel the capture path, so one listener sees
//      every scrollable element in the page;
//   2. a requestAnimationFrame poll that reads the scroller's scrollTop
//      directly every frame while scrolling is active — this works even if
//      no scroll event fires at all, and it keeps running through momentum;
//   3. the ScrollView's own onScroll prop as an extra "keep polling" kick.
// The direction decision itself is jitter-proof (same-sign deltas accumulate
// until decisive; a sign flip restarts the count) and always shows the chrome
// in the top zone of the page, exactly like YouTube.

type ScrollLike = { nativeEvent: { contentOffset: { y: number } } };

const HEADER_HEIGHT = 56;
// How far the position must move (net) before we call it a direction.
const DECIDE_PX = 8;
// The top of the page always shows the chrome (YouTube shows its bars there).
const TOP_ZONE = 48;
// While scrolling, re-report to the shell at most this often (ms) — in
// addition to every direction change, so a single lost message can never
// leave the glass bar stuck: the next report self-heals it.
const REPORT_MS = 200;
// The rAF poll stops after this many frames with no movement (~0.5s).
const IDLE_FRAMES = 30;

function postToShell(payload: Record<string, unknown>) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const shell = (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView;
  if (!shell?.postMessage) return;
  try {
    shell.postMessage(JSON.stringify(payload));
  } catch {
    // The shell went away; the header still hides locally.
  }
}

export function useNavAutohide() {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const acc = useRef(0);
  const hiddenRef = useRef(false);
  const lastReport = useRef(0);
  // The element currently being polled, the rAF handle, and the last raw
  // position seen by the poll (for idle detection).
  const tracked = useRef<HTMLElement | null>(null);
  const raf = useRef(0);
  const lastPolled = useRef(0);
  const idle = useRef(0);

  const decide = useCallback((y: number) => {
    const dy = y - lastY.current;
    lastY.current = y;
    // Jitter-proof accumulation: same-sign deltas add up until decisive,
    // a sign flip restarts the count (tiny wiggles cancel out).
    acc.current = Math.sign(dy) === Math.sign(acc.current) ? acc.current + dy : dy;
    let goingDown: boolean;
    if (y <= TOP_ZONE) {
      goingDown = false; // the top of the page always shows the chrome
      acc.current = 0;
    } else if (Math.abs(acc.current) >= DECIDE_PX) {
      goingDown = acc.current > 0;
      acc.current = 0;
    } else {
      return; // not decisive yet
    }
    const changed = goingDown !== hiddenRef.current;
    if (changed) {
      hiddenRef.current = goingDown;
      setHidden(goingDown);
      if (typeof window !== 'undefined') {
        // Tell this page's own bottom nav (App listens for this in the browser).
        window.dispatchEvent(new CustomEvent('prexpire:nav', { detail: { hidden: goingDown } }));
      }
    }
    // Tell the native shell on every change and as a light heartbeat while
    // scrolling — the glass bar recomputes its visibility from every message.
    const now = typeof Date !== 'undefined' ? Date.now() : 0;
    if (changed || now - lastReport.current >= REPORT_MS) {
      lastReport.current = now;
      postToShell({ type: 'scroll', dir: goingDown ? 'down' : 'up', y: Math.round(y) });
    }
  }, []);

  // The poll: read the scroller's scrollTop every frame and decide. This is
  // what makes the tracker immune to missing scroll events — the position is
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
        // as a jump.
        tracked.current = el;
        lastY.current = el.scrollTop;
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
  // reliably; on iOS it may be sparse — the poll covers the gaps).
  const onScroll = useCallback(() => {
    kick();
  }, [kick]);

  useEffect(() => {
    // A freshly opened screen starts at the top: show the chrome again. The
    // previous tab may have left it hidden — in the browser that strands the
    // web nav, and inside the native shell it strands the glass tab bar.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('prexpire:nav', { detail: { hidden: false } }));
      postToShell({ type: 'scroll', dir: 'up' });
    }
    if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
    // Capture-phase listener: sees scroll events from EVERY scrollable
    // element (scroll does not bubble, but it does capture).
    const onAnyScroll = (event: Event) => {
      let el: HTMLElement | null = null;
      if (event.target instanceof HTMLElement) el = event.target;
      else el = document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
      kick(el);
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

// The brand header that slides up and collapses away when the page scrolls down.
export function AutohideHeader({
  hidden,
  badge,
  gutter = 0,
  onMenu,
  onBell,
}: {
  hidden: boolean;
  badge: number;
  gutter?: number;
  onMenu: () => void;
  onBell: () => void;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: hidden ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [hidden, t]);
  const height = t.interpolate({ inputRange: [0, 1], outputRange: [HEADER_HEIGHT, 0] });
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [0, -HEADER_HEIGHT] });
  return (
    <Animated.View style={{ height, overflow: 'hidden' }}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        <Header badge={badge} gutter={gutter} onMenu={onMenu} onBell={onBell} />
      </Animated.View>
    </Animated.View>
  );
}
