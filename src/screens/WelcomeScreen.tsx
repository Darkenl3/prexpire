import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressScale } from '../components/Press';
import { useSettings } from '../settings';

// The get-started screen: shown once, on the very first launch of a fresh
// install, and never again. One screen, not a tour — the app works without an
// account, so it leads straight to the first scan.
//
// It wears the brand's forest green in both themes (the same look as the
// prexpire.com hero): a first impression, not a settings-page surface. The
// three cards show what the app does in its own words — the countdown that
// turns amber, then red — instead of a paragraph explaining it.
//
// `onSignIn` is optional: until accounts exist the sign-in link isn't shown,
// so the screen never offers something that doesn't work yet.

const brandWhiteInk = require('../../assets/brand-white.png');
const BRAND_ASPECT = 1619 / 399;

const INK = '#EDF3EE';
const INK_MUTED = 'rgba(237,243,238,0.68)';
const LIME = '#A6DF6B';

// The memorable moment: the cards COUNT DOWN once, the way the app does over
// days — milk goes 4 → 3 → 2 days and turns amber, the yogurt runs out and
// flips to Expired. Each card lists its states; the screen steps through
// them once after the entrance, then holds the last one.
type Tone = 'ok' | 'soon' | 'gone';
type Frame = { label: string; value: string; tone: Tone };
type Card = { icon: keyof typeof Ionicons.glyphMap; name: string; frames: Frame[] };
const CARDS: Card[] = [
  {
    icon: 'cafe-outline',
    name: 'Organic milk',
    frames: [
      { label: 'Expires in', value: '4 days', tone: 'ok' },
      { label: 'Expires in', value: '3 days', tone: 'ok' },
      { label: 'Use it soon', value: '2 days', tone: 'soon' },
    ],
  },
  { icon: 'medkit-outline', name: 'Ibuprofen', frames: [{ label: 'Expires in', value: '7 months', tone: 'ok' }] },
  {
    icon: 'nutrition-outline',
    name: 'Greek yogurt',
    frames: [
      { label: 'Use it today', value: '1 day', tone: 'soon' },
      { label: 'Use it today', value: '1 day', tone: 'soon' },
      { label: 'Past its date', value: 'Expired', tone: 'gone' },
    ],
  },
];
const STEPS = 3;
const TICK_MS = 1500;
const TONE = {
  ok: { fg: '#8FDB9C', tile: 'rgba(108,194,126,0.16)' },
  soon: { fg: '#F4C06A', tile: 'rgba(240,176,74,0.16)' },
  gone: { fg: '#F58A80', tile: 'rgba(240,106,96,0.18)' },
};

type Props = {
  onStart: () => void;
  onSignIn?: () => void;
};

export default function WelcomeScreen({ onStart, onSignIn }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { motion } = useSettings();
  const compact = height < 700;

  // One sequence: the cards settle in, the copy follows, then the countdown
  // runs its few steps. With reduced motion, everything starts in its last state.
  const native = Platform.OS !== 'web';
  const enter = useRef(CARDS.map(() => new Animated.Value(motion ? 0 : 1))).current;
  const copy = useRef(new Animated.Value(motion ? 0 : 1)).current;
  const [step, setStep] = useState(motion ? 0 : STEPS - 1);
  const flip = useRef(CARDS.map(() => new Animated.Value(1))).current;
  useEffect(() => {
    if (!motion) return;
    Animated.stagger(200, [
      ...enter.map((v) => Animated.timing(v, { toValue: 1, duration: 800, easing: Easing.out(Easing.back(1.2)), useNativeDriver: native })),
      Animated.timing(copy, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
    ]).start();
    const timers = Array.from({ length: STEPS - 1 }, (_, i) => setTimeout(() => setStep(i + 1), 2600 + i * TICK_MS));
    return () => timers.forEach(clearTimeout);
  }, [motion, enter, copy, native]);
  // A value that changes drops in from above, like a counter turning.
  const shown = useRef(CARDS.map((card) => card.frames[0].value));
  useEffect(() => {
    CARDS.forEach((card, i) => {
      const value = card.frames[Math.min(step, card.frames.length - 1)].value;
      if (value === shown.current[i]) return;
      shown.current[i] = value;
      flip[i].setValue(0);
      Animated.timing(flip[i], { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
    });
  }, [step, flip, native]);

  const column = Math.min(width - 48, 420);

  return (
    <View style={s.root}>
      <LinearGradient colors={['#0D271C', '#081A13']} style={StyleSheet.absoluteFill} />
      {/* The soft green light behind the cards. */}
      <View pointerEvents="none" style={[s.glow, { width: column * 1.3, height: column * 1.3, borderRadius: column, left: width / 2 - column * 0.65, top: insets.top + (compact ? 20 : 60) }]} />

      <View style={[s.inner, { paddingTop: insets.top + 18, paddingBottom: Math.max(insets.bottom, 16) + 12, width: column }]}>
        <Image source={brandWhiteInk} style={{ width: Math.round(28 * BRAND_ASPECT), height: 28, alignSelf: 'center' }} resizeMode="contain" accessibilityLabel="Prexpire" />

        <View style={[s.cards, { marginTop: compact ? 22 : 44 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {CARDS.map((card, i) => {
            const v = enter[i];
            const shift = i === 1 ? 26 : i === 2 ? -10 : 0; // a loose stack, not a grid
            const f = card.frames[Math.min(step, card.frames.length - 1)];
            return (
              <Animated.View
                key={card.name}
                style={[
                  s.card,
                  { marginLeft: shift, opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }, { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] },
                ]}
              >
                <View style={[s.tile, { backgroundColor: TONE[f.tone].tile }]}>
                  <Ionicons name={card.icon} size={21} color={TONE[f.tone].fg} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardName}>{card.name}</Text>
                  <Text style={s.cardLabel}>{f.label}</Text>
                </View>
                <Animated.Text
                  style={[
                    s.cardValue,
                    { color: TONE[f.tone].fg, opacity: flip[i], transform: [{ translateY: flip[i].interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] },
                  ]}
                >
                  {f.value}
                </Animated.Text>
              </Animated.View>
            );
          })}
        </View>

        <Animated.View style={[s.copy, { opacity: copy, transform: [{ translateY: copy.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
          <Text style={[s.title, compact && { fontSize: 32, lineHeight: 35 }]} accessibilityRole="header">
            Never forget an expiry date again.
          </Text>
          <Text style={s.lede}>Scan the date once. Prexpire shows you what to use first.</Text>
        </Animated.View>

        <Animated.View style={{ opacity: copy, gap: 10 }}>
          {/* One way in. Home's big scan button is right there; a second
              "explore" option was the same thing in other words. */}
          <PressScale onPress={onStart} scaleTo={0.97} accessibilityRole="button" accessibilityLabel="Get started" style={s.primary}>
            <Text style={s.primaryText}>Get started</Text>
          </PressScale>
          {onSignIn ? (
            <PressScale onPress={onSignIn} scaleTo={0.97} accessibilityRole="button" accessibilityLabel="Sign in to back up and sync" style={s.link}>
              <Text style={s.linkText}>
                Have an account? <Text style={{ color: LIME, fontWeight: '700' }}>Sign in</Text>
              </Text>
            </PressScale>
          ) : null}
          <Text style={s.note}>No account needed. Works offline.</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#081A13', alignItems: 'center', overflow: 'hidden' },
  glow: {
    position: 'absolute',
    backgroundColor: 'rgba(84,182,108,0.20)',
    ...(Platform.OS === 'web' ? ({ filter: 'blur(60px)' } as object) : { opacity: 0.6 }),
  },
  inner: { flex: 1, justifyContent: 'space-between' },
  cards: { gap: 12, alignItems: 'stretch' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    maxWidth: 330,
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' } as object) : {}),
  },
  tile: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardName: { color: INK, fontSize: 15, fontWeight: '700' },
  cardLabel: { color: INK_MUTED, fontSize: 12.5, marginTop: 1 },
  // Tabular digits: the countdown changes value without the row jittering.
  cardValue: { fontSize: 21, fontWeight: '800', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  copy: { gap: 12 },
  title: { color: INK, fontSize: 40, lineHeight: 42, fontWeight: '800', letterSpacing: -1.3 },
  lede: { color: INK_MUTED, fontSize: 17, lineHeight: 24 },
  primary: { height: 56, borderRadius: 16, backgroundColor: LIME, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryText: { color: '#08130F', fontSize: 17, fontWeight: '800' },
  secondary: { height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(237,243,238,0.22)' },
  secondaryText: { color: INK, fontSize: 16, fontWeight: '700' },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: INK_MUTED, fontSize: 14.5 },
  note: { color: 'rgba(237,243,238,0.5)', fontSize: 13, textAlign: 'center', marginTop: 4 },
});
