import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useTheme, withAlpha } from '../theme';
import { useSettings } from '../settings';

const CORNER = 30;
const STROKE = 4;
const CORNER_RADIUS = 14;

type Props = { width: number; height: number; scanning: boolean; success: boolean };

// The scanning frame: four green corner brackets (the active theme's green —
// the same green as the app's buttons), a soft sweep line while frames are
// being analysed, and a solid outline once a date has been confirmed. The
// camera chrome stays dark in both themes, but the green always follows the
// app's theme so the scanner never disagrees with the rest of Prexpire.
// The sweep line is purely cosmetic: turning it off (the Scanning Line
// Animation setting, or animations/reduced motion) leaves a clean static
// frame — the camera, barcode reading and date OCR are never affected.
export const ScanFrame = memo(function ScanFrame({ width, height, scanning, success }: Props) {
  const sweep = useRef(new Animated.Value(0)).current;
  // With the scanning line off, or animations off (Settings or the system's
  // reduced motion), the line is hidden and the frame stays cleanly static.
  const { motion, settings } = useSettings();
  const lineOn = settings.scanLineAnimation && motion;
  const t = useTheme();
  const lime = t.mint;

  useEffect(() => {
    if (!lineOn) {
      sweep.stopAnimation();
      sweep.setValue(0);
      return;
    }
    if (!scanning) {
      sweep.stopAnimation();
      sweep.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scanning, sweep, lineOn]);

  const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: [10, Math.max(10, height - 12)] });

  return (
    <View
      style={[{ width, height }, success && { backgroundColor: withAlpha(lime, 0.08), borderRadius: CORNER_RADIUS }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={success ? 'Date detected' : scanning ? 'Scanning for an expiry date' : 'Scanning frame'}
    >
      {success && <View style={[StyleSheet.absoluteFill, { borderRadius: CORNER_RADIUS, borderWidth: 1.5, borderColor: withAlpha(lime, 0.55) }]} />}
      {scanning && lineOn && (
        <Animated.View
          style={[
            s.sweep,
            { transform: [{ translateY }], backgroundColor: lime, shadowColor: lime },
          ]}
        />
      )}
      <View style={[s.corner, { top: 0, left: 0, borderTopWidth: STROKE, borderLeftWidth: STROKE, borderTopLeftRadius: CORNER_RADIUS, borderColor: lime }]} />
      <View style={[s.corner, { top: 0, right: 0, borderTopWidth: STROKE, borderRightWidth: STROKE, borderTopRightRadius: CORNER_RADIUS, borderColor: lime }]} />
      <View style={[s.corner, { bottom: 0, left: 0, borderBottomWidth: STROKE, borderLeftWidth: STROKE, borderBottomLeftRadius: CORNER_RADIUS, borderColor: lime }]} />
      <View style={[s.corner, { bottom: 0, right: 0, borderBottomWidth: STROKE, borderRightWidth: STROKE, borderBottomRightRadius: CORNER_RADIUS, borderColor: lime }]} />
    </View>
  );
});

const s = StyleSheet.create({
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  sweep: {
    position: 'absolute',
    top: 0,
    left: 14,
    right: 14,
    height: 2,
    borderRadius: 1,
    opacity: 0.55,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
});
