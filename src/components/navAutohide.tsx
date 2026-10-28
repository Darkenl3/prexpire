import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import { Header } from './HomeComponents';

// YouTube-style auto-hide navigation: scrolling down collapses the header (and,
// inside the native Expo shell, the liquid-glass tab bar slides away too);
// scrolling up brings them back. Each screen owns its own tracker so the
// header always starts visible when a tab opens.

type ScrollLike = { nativeEvent: { contentOffset: { y: number } } };

const HEADER_HEIGHT = 56;

export function useNavAutohide() {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const hiddenRef = useRef(false);

  const onScroll = useCallback((e: ScrollLike) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    if (Math.abs(dy) < 8) return; // Ignore jitter — sub-threshold deltas accumulate until decisive.
    lastY.current = y;
    const goingDown = dy > 0 && y > 48; // Only hide once the page has scrolled in a bit.
    if (goingDown === hiddenRef.current) return;
    hiddenRef.current = goingDown;
    setHidden(goingDown);
    if (typeof window !== 'undefined') {
      // Tell this page's own bottom nav (App listens for this in the browser).
      window.dispatchEvent(new CustomEvent('prexpire:nav', { detail: { hidden: goingDown } }));
      // Tell the native shell, so its glass tab bar can follow the same motion.
      const shell =
        Platform.OS === 'web'
          ? (window as { ReactNativeWebView?: { postMessage?: (data: string) => void } }).ReactNativeWebView
          : undefined;
      if (shell?.postMessage) {
        try {
          shell.postMessage(JSON.stringify({ type: 'scroll', dir: goingDown ? 'down' : 'up' }));
        } catch {
          // The shell went away; the header still hides locally.
        }
      }
    }
  }, []);

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
