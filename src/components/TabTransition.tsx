import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';
import { useSettings } from '../settings';
import type { TabId } from './HomeComponents';

// The tab-switch transition, shared by every main screen: a gentle fade
// combined with a very small horizontal slide (180-220 ms, ease-out,
// transform/opacity only, so nothing re-lays out and the scroller never
// resizes). The persistent brand header stays OUTSIDE it - the chrome never
// flickers - and the camera screens never pass through it at all (the scanner
// mounts through its own early-return branch, so nothing animates around the
// camera: no delayed mount, no black frames, no extra permission asks).
//
// Like every animation in the app (Press.tsx, the Toast, Settings' own pages)
// it collapses to nothing when motion is off: the app's Animations setting
// AND the OS-level Reduce Motion flag are already wired through
// useSettings().motion.

// The tab bar's reading order (the centre scan button aside): moving right
// through the bar slides the screen in from the right; moving left slides it
// back in from the left.
const ORDER: TabId[] = ['home', 'items', 'reminders', 'settings'];

// The last tab whose screen mounted. Module-level on purpose: the screens
// remount on every tab switch, so the INCOMING screen reads (and updates)
// this to learn which way it slid in. Only mounts touch it - unmounts never
// do - so exactly one call decides each transition. The scanner never mounts
// a screen through this path, which is why coming back from the camera lands
// with no slide at all: the tab you left is still the last one noted.
let lastMountedTab: TabId | null = null;

export function tabEnterDirection(tab: TabId): number {
  const dir =
    lastMountedTab && lastMountedTab !== tab ? Math.sign(ORDER.indexOf(tab) - ORDER.indexOf(lastMountedTab)) : 0;
  lastMountedTab = tab;
  return dir;
}

// The brief's 180-220 ms window, one very small slide.
export const TAB_MS = 200;
export const TAB_SLIDE = 14;

export function TabTransition({ tab, children }: { tab: TabId; children: ReactNode }) {
  const { motion } = useSettings();
  // Motion as a ref so flipping the setting never retriggers a running animation.
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const opacity = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  // The direction is resolved exactly once, during the first render (a plain
  // useRef initialiser would re-evaluate its argument on every render and
  // corrupt the module-level history - so it is a lazy null check instead).
  const dirRef = useRef<number | null>(null);
  if (dirRef.current === null) dirRef.current = tabEnterDirection(tab);

  useEffect(() => {
    // dir 0 = first load, a within-tab remount (category switch, the Items /
    // ShoppingList segmented control) or a return from the scanner: appear in
    // place, instantly, exactly as before.
    const dir = dirRef.current ?? 0;
    if (dir === 0 || !motionRef.current) return;
    opacity.setValue(0);
    translateX.setValue(dir * TAB_SLIDE);
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: TAB_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translateX, { toValue: 0, duration: TAB_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    anim.start();
    // Rapid tab switching unmounts this screen mid-animation: the cleanup
    // stops the pair cleanly, so no animation ever overlaps its successor.
    return () => anim.stop();
    // The enter transition runs once per mount, with the values it captured
    // at first render - never on later re-renders of the same screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={{ flex: 1, opacity, transform: [{ translateX }] }} collapsable={false}>
      {children}
    </Animated.View>
  );
}
