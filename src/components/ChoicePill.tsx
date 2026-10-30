import { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressScale } from './Press';
import { useSettings } from '../settings';

// The app's one "choice pill", modelled on the reference's filter bar: a fully
// rounded capsule where the selected option is a SOLID green fill with no
// checkmark - the colour alone says which one is active, and it is exactly the
// same control in the Items filters, the sort row and the save sheet's category
// chips, so "selected" always looks like one thing.
//
// Motion: picking a pill crossfades its fill, border and text (~200 ms, ease-out)
// while PressScale squishes the whole capsule softly under the finger - a gentle
// settle, never a snap. The Animations setting (and the OS reduce-motion flag)
// collapse the crossfade to zero, exactly like every other motion in the app.

export type PillColors = {
  offBg: string;
  offBorder: string;
  offText: string;
  onBg: string;
  onBorder: string;
  onText: string;
};

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: PillColors;
  // "small" is the compact variant used for the sort row.
  size?: 'regular' | 'small';
  accessibilityLabel?: string;
  // A small glyph carried INSIDE the capsule (the category chips' icons, the
  // sort dropdown's chevron). It follows the pill's selected text colour.
  icon?: keyof typeof Ionicons.glyphMap;
  // Draws the icon AFTER the label instead of before it (dropdown chevrons).
  iconAfter?: boolean;
};

export function ChoicePill({ label, selected, onPress, colors, size = 'regular', accessibilityLabel, icon, iconAfter }: Props) {
  const { motion } = useSettings();
  // Motion as a ref so animation timings never retrigger a running animation.
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const mix = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(mix, { toValue: selected ? 1 : 0, duration: motionRef.current ? 200 : 0, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [selected, mix]);
  const bg = mix.interpolate({ inputRange: [0, 1], outputRange: [colors.offBg, colors.onBg] });
  const border = mix.interpolate({ inputRange: [0, 1], outputRange: [colors.offBorder, colors.onBorder] });
  const text = mix.interpolate({ inputRange: [0, 1], outputRange: [colors.offText, colors.onText] });
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={accessibilityLabel ?? label}
      style={size === 'small' ? small : regular}
    >
      {/* The painted layer carries the animated fill and border; PressScale's
          transform sits above it, so the whole capsule squishes together. */}
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 999, borderWidth: 1, backgroundColor: bg, borderColor: border }]} />
      <View style={content} pointerEvents="none">
        {!!icon && !iconAfter && <Ionicons name={icon} size={size === 'small' ? 12 : 13} color={selected ? colors.onText : colors.offText} />}
        <Animated.Text style={{ color: text, fontSize: size === 'small' ? 12.5 : 13.5, fontWeight: '600' }}>{label}</Animated.Text>
        {!!icon && iconAfter && <Ionicons name={icon} size={size === 'small' ? 12 : 13} color={selected ? colors.onText : colors.offText} />}
      </View>
    </PressScale>
  );
}

const content = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 };
const regular = { justifyContent: 'center' as const, alignItems: 'center' as const, height: 34, paddingHorizontal: 15, borderRadius: 999 };
const small = { justifyContent: 'center' as const, alignItems: 'center' as const, height: 30, paddingHorizontal: 12, borderRadius: 999 };

// A horizontal pill row can be longer than the screen, and the pill that starts
// out SELECTED may sit far to the right (a category picked as the fallback, or
// one deep in the user's list). This scrolls the row once, as soon as the
// selected pill has a position, so the green fill is always on screen when the
// row first appears - never a selected state the user cannot see.
export function useScrollSelectedIntoView(selected: string) {
  const scrollRef = useRef<ScrollView>(null);
  const positions = useRef(new Map<string, number>());
  const done = useRef(false);
  // The selected id as a ref: onLayout of the pills fires during commit, and
  // only the SELECTED pill's layout completes the picture - any other pill
  // noting its position must not spend the one-shot scroll on itself.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const tryScroll = () => {
    if (done.current) return;
    const x = positions.current.get(selectedRef.current);
    if (x === undefined) return;
    done.current = true;
    scrollRef.current?.scrollTo({ x: Math.max(0, x - 10), animated: false });
  };
  // Call from each pill wrapper's onLayout: records where that pill sits.
  const note = useCallback((id: string, e: LayoutChangeEvent) => {
    positions.current.set(id, e.nativeEvent.layout.x);
    tryScroll();
  }, []);
  // And once more after mount, in case layout completed before any note fired.
  useEffect(() => {
    tryScroll();
  }, [selected]);
  return { scrollRef, note };
}
