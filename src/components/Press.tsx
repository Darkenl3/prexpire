import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useSettings } from '../settings';

// The app's shared motion vocabulary - one place for the polished, premium-iOS
// feel requested across every screen:
//
// * PressScale - tactile feedback for every interactive surface. While pressed
//   the element gently scales down (about 0.98) with a whisper of opacity,
//   then settles back softly: press-in ~130 ms (reads instantly), release
//   ~200 ms (soft return, never a snap). A short same-element lock absorbs
//   accidental double taps, so navigation and destructive actions never fire
//   twice from one jittery tap.
// * FadeIn - content that appears or changes (checkmarks, status badges,
//   notes) fades in over ~180 ms instead of popping in.
//
// Everything is transform/opacity only, so it all runs on the native driver,
// and the Animations setting (plus the OS-level reduce-motion flag, both
// already wired through useSettings) collapses every duration to zero.

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Press-in lands inside 100-160 ms; the release settles inside 180-240 ms.
const PRESS_IN_MS = 130;
const PRESS_OUT_MS = 200;
// A second tap on the same element within this window is treated as an
// accidental double fire of the same action and is ignored.
const DOUBLE_TAP_MS = 300;

type PressScaleProps = {
  children?: ReactNode;
  // How far the element scales down while pressed (0.97-0.985 feels native).
  scaleTo?: number;
  // Static visual style (layout, background, radius...).
  style?: StyleProp<ViewStyle>;
  // Extra style applied only while pressed, e.g. the soft row highlight tint.
  pressedStyle?: StyleProp<ViewStyle>;
  onPress?: (event: GestureResponderEvent) => void;
} & Omit<PressableProps, 'style' | 'onPress' | 'children'>;

export function PressScale({ children, scaleTo = 0.98, style, pressedStyle, onPress, ...rest }: PressScaleProps) {
  const { motion } = useSettings();
  // Motion as a ref so animation timings never retrigger a running animation.
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const press = useRef(new Animated.Value(0)).current;
  const lastFire = useRef(0);
  const [pressed, setPressed] = useState(false);

  const down = useCallback(() => {
    setPressed(true);
    Animated.timing(press, { toValue: 1, duration: motionRef.current ? PRESS_IN_MS : 0, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [press]);
  const up = useCallback(() => {
    setPressed(false);
    Animated.timing(press, { toValue: 0, duration: motionRef.current ? PRESS_OUT_MS : 0, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [press]);

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] });
  const fade = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.93] });

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      const now = Date.now();
      if (now - lastFire.current < DOUBLE_TAP_MS) return;
      lastFire.current = now;
      onPress?.(event);
    },
    [onPress],
  );

  return (
    <AnimatedPressable
      {...rest}
      onPress={handlePress}
      onPressIn={down}
      onPressOut={up}
      style={[style, pressed ? pressedStyle : null, { transform: [{ scale }], opacity: fade }]}
    >
      {children}
    </AnimatedPressable>
  );
}

// Content that appears or changes fades in softly instead of popping. Remount
// it with a fresh key whenever the value it presents changes; the fade plays
// once per mount (never again on ordinary rerenders). Accepts the usual View
// props (accessibility, layout) - it IS the container.
export function FadeIn({ children, duration = 180, style, ...rest }: { children?: ReactNode; duration?: number; style?: StyleProp<ViewStyle> } & ViewProps) {
  const { motion } = useSettings();
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: motionRef.current ? duration : 0, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [v, duration]);
  return (
    <Animated.View style={[style, { opacity: v }]} {...rest}>
      {children}
    </Animated.View>
  );
}
