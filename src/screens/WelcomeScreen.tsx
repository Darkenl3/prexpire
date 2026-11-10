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
// days — milk goes 4 → 3 → 2 days and turns amber, and only then, on a beat
// of its own, the yogurt runs out and flips to Expired (never two cards
// changing at once). Each card lists its state per step; the screen steps
// through them once after the entrance, then holds the last one.
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
      { label: 'Use it today', value: '1 day', tone: 'soon' },
      { label: 'Past its date', value: 'Expired', tone: 'gone' },
    ],
  },
];
const STEPS = 4;
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
  useEffect(() => {
    if (!motion) return;
    Animated.stagger(200, [
      ...enter.map((v) => Animated.timing(v, { toValue: 1, duration: 800, easing: Easing.out(Easing.back(1.2)), useNativeDriver: native })),
      Animated.timing(copy, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
    ]).start();
    const timers = Array.from({ length: STEPS - 1 }, (_, i) => setTimeout(() => setStep(i + 1), 2600 + i * TICK_MS));
    return () => timers.forEach(clearTimeout);
  }, [motion, enter, copy, native]);
  const column = Math.min(width - 48, 420);

  return (
    <View style={s.root}>
      <LinearGradient colors={['#0D271C', '#081A13']} style={StyleSheet.absoluteFill} />
      {/* The soft green light behind the cards. */}
      <View pointerEvents="none" style={[s.glow, { width: column * 1.3, height: column * 1.3, borderRadius: column, left: width / 2 - column * 0.65, top: insets.top + (compact ? 20 : 60) }]} />

      <View style={[s.inner, { paddingTop: insets.top + 18, paddingBottom: Math.max(insets.bottom, 16) + 12, width: column }]}>
        <Image
          source={brandWhiteInk}
          style={{ width: Math.round((compact ? 34 : 40) * BRAND_ASPECT), height: compact ? 34 : 40, alignSelf: 'center' }}
          resizeMode="contain"
          accessibilityLabel="Prexpire"
        />

        <View style={[s.cards, { marginTop: compact ? 22 : 44 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {CARDS.map((card, i) => (
            <CountdownCard
              key={card.name}
              card={card}
              frame={card.frames[Math.min(step, card.frames.length - 1)]}
              enter={enter[i]}
              shift={i === 1 ? 26 : i === 2 ? -10 : 0} // a loose stack, not a grid
              native={native}
            />
          ))}
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

// One card of the countdown. When its frame changes, the old state and the
// new one are both on screen for a moment: the old value rolls up and out
// while the new one rolls up into place (like a counter), and the label and
// the coloured tile cross-fade with it, so the whole row changes as one
// smooth movement instead of the text snapping.
const ROLL_MS = 700;
const ROLL_PX = 12;
function CountdownCard({ card, frame, enter, shift, native }: { card: Card; frame: Frame; enter: Animated.Value; shift: number; native: boolean }) {
  const [cur, setCur] = useState(frame);
  const [prev, setPrev] = useState<Frame | null>(null);
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (frame === cur) return;
    setPrev(cur);
    setCur(frame);
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: ROLL_MS, easing: Easing.inOut(Easing.cubic), useNativeDriver: native }).start(({ finished }) => {
      if (finished) setPrev(null);
    });
  }, [frame, cur, t, native]);

  const out = { opacity: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0, 0] }), transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -ROLL_PX] }) }] };
  const into = { opacity: t.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 0, 1] }), transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [ROLL_PX, 0] }) }] };
  const fadeOut = { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) };
  const valueChanged = !!prev && prev.value !== cur.value;
  const labelChanged = !!prev && prev.label !== cur.label;
  const toneChanged = !!prev && prev.tone !== cur.tone;

  return (
    <Animated.View
      style={[
        s.card,
        { marginLeft: shift, opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }, { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] },
      ]}
    >
      <View style={[s.tile, { backgroundColor: TONE[cur.tone].tile }]}>
        <Ionicons name={card.icon} size={21} color={TONE[cur.tone].fg} />
        {toneChanged && prev ? (
          <Animated.View style={[StyleSheet.absoluteFill, s.tileOverlay, { backgroundColor: TONE[prev.tone].tile }, fadeOut]}>
            <Ionicons name={card.icon} size={21} color={TONE[prev.tone].fg} />
          </Animated.View>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.cardName}>{card.name}</Text>
        <View style={s.rollBox}>
          <Animated.Text style={[s.cardLabel, labelChanged ? into : null]}>{cur.label}</Animated.Text>
          {labelChanged && prev ? <Animated.Text style={[s.cardLabel, s.rollPrevLeft, out]}>{prev.label}</Animated.Text> : null}
        </View>
      </View>
      <View style={[s.rollBox, { alignItems: 'flex-end' }]}>
        <Animated.Text style={[s.cardValue, { color: TONE[cur.tone].fg }, valueChanged ? into : null]}>{cur.value}</Animated.Text>
        {valueChanged && prev ? <Animated.Text style={[s.cardValue, s.rollPrevRight, { color: TONE[prev.tone].fg }, out]}>{prev.value}</Animated.Text> : null}
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // The rolling text: the new line in the flow, the old one on top of it,
  // clipped so the roll stays inside the row.
  rollBox: { position: 'relative', overflow: 'hidden' },
  rollPrevLeft: { position: 'absolute', left: 0, top: 0 },
  rollPrevRight: { position: 'absolute', right: 0, top: 0 },
  tileOverlay: { borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
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
    borderRadius: 16,
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
