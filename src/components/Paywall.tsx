import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, ScrollView, Text, View, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DARK, ForcedTheme, makeStyles, useTheme } from '../theme';
import { useSettings } from '../settings';
import { useItems } from '../items';
import { useCategories } from '../categories';
import { FREE_CUSTOM_CATEGORIES, FREE_ITEM_LIMIT, nextReset, useMonthlyAdds, usePro, type PaywallReason, type ProPlan } from '../pro';
import { PressScale } from './Press';
import { BottomSheet } from './BottomSheet';
import { LegalDetail, type LegalDoc } from '../screens/SettingsScreen';
import legal from '../legal.json';

// The Pro offer. One idea carries it: the free plan's 20 places, drawn as a
// row of pips that fill with the items you track today. Pro is simply "no
// row": everything else in the app stays free.

// Inside the iPhone app the native tab bar floats over the page; while the
// paywall is open it steps aside (App.tsx reports the full-screen route, and
// newer shells also take this overlay message).
type Shell = { postMessage?: (data: string) => void };
const shellOf = (): Shell | undefined => (typeof window !== 'undefined' ? (window as { ReactNativeWebView?: Shell }).ReactNativeWebView : undefined);
const shellHidesBar = () => typeof window !== 'undefined' && !!(window as { __prexpireOverlay?: number }).__prexpireOverlay;
function tellShell(open: boolean) {
  if (!shellHidesBar()) return;
  try {
    shellOf()?.postMessage?.(JSON.stringify({ type: 'overlay', open }));
  } catch {}
}

const LEADS: Record<PaywallReason, (n: number) => string> = {
  welcome: () => `Free with ${FREE_ITEM_LIMIT} new items every month. Pro tracks every shop, the pantry and the medicine cabinet, with no limit.`,
  limit: () => `You've added this month's ${FREE_ITEM_LIMIT} free items. Everything you track keeps working. Pro lets you keep adding.`,
  categories: () => `The free plan includes ${FREE_CUSTOM_CATEGORIES} category of your own. Pro lets you add as many as you need.`,
  settings: () => `Free with ${FREE_ITEM_LIMIT} new items every month. Pro takes the limit away.`,
};

type Perk = { icon: keyof typeof Ionicons.glyphMap; title: string; text: string };
const PERKS: Perk[] = [
  { icon: 'infinite', title: 'Unlimited items', text: 'Add every shop, every week, without counting.' },
  { icon: 'grid-outline', title: 'Unlimited categories', text: 'Make a category for the garage, the baby, the first-aid kit.' },
  { icon: 'heart-outline', title: 'Keeps Prexpire independent', text: 'No ads and no tracking, now or later.' },
];
// Opens inside the Lifetime card while it's the chosen plan (the card grows
// downward, so nothing above it moves).
const FAMILY: Perk = { icon: 'people-outline', title: 'Shared with your family', text: 'Up to 5 family members get Pro too, through Family Sharing.' };

function savingVsMonthly(plans: ProPlan[]): number | null {
  const m = plans.find((p) => p.kind === 'monthly');
  const y = plans.find((p) => p.kind === 'annual');
  if (!m || !y || m.priceValue <= 0) return null;
  const pct = Math.round((1 - y.priceValue / (m.priceValue * 12)) * 100);
  return pct >= 10 ? pct : null;
}

export function Paywall() {
  const { paywall, closePaywall } = usePro();
  // Kept mounted through the close animation.
  const [shown, setShown] = useState<PaywallReason | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const { motion } = useSettings();
  useEffect(() => {
    if (paywall) {
      setShown(paywall);
      tellShell(true);
      Animated.timing(fade, { toValue: 1, duration: motion ? 260 : 0, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else if (shown) {
      tellShell(false);
      Animated.timing(fade, { toValue: 0, duration: motion ? 180 : 0, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setShown(null));
    }
  }, [paywall]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={closePaywall}>
      <Animated.View style={{ flex: 1, opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
        <ForcedTheme palette={DARK}>
          <PaywallBody reason={shown} onClose={closePaywall} />
        </ForcedTheme>
      </Animated.View>
    </Modal>
  );
}

function PaywallBody({ reason, onClose }: { reason: PaywallReason; onClose: () => void }) {
  const c = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { items } = useItems();
  const { custom } = useCategories();
  const { available, isPro, plans, loadPlans, buy, restore, manage, state } = usePro();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [doc, setDoc] = useState<'terms' | 'privacy' | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Prices fresh from the App Store every time the paywall opens (they follow
  // the App Store country, which can change); the last ones show meanwhile.
  useEffect(() => {
    if (!available) return;
    let live = true;
    loadPlans().then(() => live && setLoadFailed(false));
    const t = setTimeout(() => live && setLoadFailed(true), 12_000);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [available, loadPlans]);

  const ordered = useMemo(() => {
    const rank = { annual: 0, monthly: 1, lifetime: 2, other: 3 } as const;
    return (plans ?? []).slice().sort((a, b) => rank[a.kind] - rank[b.kind]);
  }, [plans]);
  useEffect(() => {
    if (!selected && ordered.length) setSelected((ordered.find((p) => p.kind === 'annual') ?? ordered[0]).id);
  }, [ordered, selected]);
  const plan = ordered.find((p) => p.id === selected) ?? null;
  const saving = savingVsMonthly(ordered);

  const added = useMonthlyAdds();
  const count = items.length;
  const resets = nextReset().toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  const selling = available && !isPro && !!plans;
  const { motion } = useSettings();
  const filled = Math.min(added, FREE_ITEM_LIMIT);

  const onBuy = async () => {
    if (!plan || busy) return;
    setBusy('buy');
    setNote(null);
    const out = await buy(plan.id);
    setBusy(null);
    if (out.error) setNote({ text: out.error, bad: true });
  };
  const onRestore = async () => {
    if (busy) return;
    setBusy('restore');
    setNote(null);
    const out = await restore();
    setBusy(null);
    if (out.error) setNote({ text: out.error, bad: true });
    else if (!out.found) setNote({ text: 'No Pro purchase was found for this Apple ID.', bad: true });
  };

  const cta = !plan
    ? 'Continue'
    : plan.trialDays > 0
      ? `Try ${plan.trialDays} days free`
      : plan.kind === 'lifetime'
        ? `Buy for ${plan.price}`
        : `Subscribe for ${plan.price}`;
  const terms = !plan
    ? ''
    : plan.kind === 'lifetime'
      ? 'One payment. Pro is yours for good, and Family Sharing gives it to up to 5 family members too.'
      : `${plan.trialDays > 0 ? `${plan.trialDays} days free, then ` : ''}${plan.price} a ${plan.kind === 'annual' ? 'year' : 'month'}. Renews automatically until you cancel, at least 24 hours before the end of the period, in your Apple ID's subscriptions.`;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.topBar}>
        <PressScale onPress={onClose} scaleTo={0.9} accessibilityRole="button" accessibilityLabel="Close" style={s.close}>
          <Ionicons name="close" size={20} color={c.text} />
        </PressScale>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={[s.scroll, { paddingBottom: selling ? 20 : insets.bottom + 28 }]} showsVerticalScrollIndicator={false}>
        <View style={s.column}>
          <Text style={s.title} accessibilityRole="header">
            Prexpire Pro
          </Text>
          <Text style={s.lead}>{isPro ? 'Thank you. Pro is on: no limits on items or categories.' : LEADS[reason](count)}</Text>

          {/* The free plan's places. */}
          <View style={s.meter} accessible accessibilityLabel={`${added} of ${FREE_ITEM_LIMIT} free items used this month`}>
            <View style={s.pips}>
              {Array.from({ length: FREE_ITEM_LIMIT }, (_, i) => (
                <View key={i} style={[s.pip, i < filled && (filled >= FREE_ITEM_LIMIT && !isPro ? s.pipFull : s.pipOn)]} />
              ))}
              <View style={s.pipInf}>
                <Ionicons name="infinite" size={18} color={isPro ? c.mint : c.textMuted} />
              </View>
            </View>
            <Text style={s.meterText}>
              {isPro ? `${count} ${count === 1 ? 'item' : 'items'}, no limit` : `${filled} of ${FREE_ITEM_LIMIT} free items this month. Resets on ${resets}`}
            </Text>
          </View>

          <View style={s.perks}>
            <PerkRow perk={PERKS[0]} />
            <PerkRow perk={PERKS[1]} spaced />
            <PerkRow perk={PERKS[2]} spaced />
            <Text style={s.freeLine}>Scanning, reminders and backup stay free for everyone.</Text>
          </View>

          {isPro ? (
            <>
              {!state?.lifetime && (
                <PressScale onPress={manage} scaleTo={0.97} accessibilityRole="button" accessibilityLabel="Manage subscription" style={s.secondary}>
                  <Text style={s.secondaryText}>Manage subscription</Text>
                </PressScale>
              )}
              <PressScale onPress={onClose} scaleTo={0.96} pressedStyle={{ opacity: 0.85 }} accessibilityRole="button" accessibilityLabel="Done" style={s.cta}>
                <Text style={s.ctaText}>Done</Text>
              </PressScale>
            </>
          ) : !available ? (
            <Text style={s.unavailable}>Pro is available in the Prexpire iPhone app.</Text>
          ) : !plans ? (
            <View style={s.loading}>
              {loadFailed ? (
                <Text style={s.unavailable}>Couldn't reach the App Store. Check your connection, then open this again.</Text>
              ) : (
                <ActivityIndicator color={c.textMuted} />
              )}
            </View>
          ) : (
            <>
              <View style={s.plans} accessibilityRole={'radiogroup' as never}>
                {ordered.map((p) => {
                  const on = p.id === selected;
                  const name = p.kind === 'annual' ? 'Yearly' : p.kind === 'monthly' ? 'Monthly' : p.kind === 'lifetime' ? 'Lifetime' : p.id;
                  const sub =
                    p.kind === 'annual'
                      ? `${p.perMonth ? `${p.perMonth} a month` : 'Billed yearly'}${p.trialDays ? `, ${p.trialDays} days free` : ''}`
                      : p.kind === 'monthly'
                        ? 'Billed monthly'
                        : 'Pay once, share with your family';
                  return (
                    <PlanCard
                      key={p.id}
                      on={on}
                      motion={motion}
                      onPress={() => setSelected(p.id)}
                      label={`${name}, ${p.price}`}
                      extra={p.kind === 'lifetime' ? <PerkRow perk={FAMILY} compact /> : undefined}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={s.planNameRow}>
                          <Text style={s.planName}>{name}</Text>
                          {p.kind === 'annual' && saving ? (
                            <View style={s.badge}>
                              <Text style={s.badgeText}>Save {saving}%</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={s.planSub}>{sub}</Text>
                      </View>
                      <Text style={s.planPrice}>{p.price}</Text>
                    </PlanCard>
                  );
                })}
              </View>
            </>
          )}

          <View style={s.links}>
            {!isPro && available ? (
              <PressScale onPress={onRestore} scaleTo={0.95} accessibilityRole="button" accessibilityLabel="Restore purchases" style={s.link}>
                {busy === 'restore' ? <ActivityIndicator size="small" color={c.textMuted} /> : <Text style={s.linkText}>Restore purchases</Text>}
              </PressScale>
            ) : null}
            <PressScale onPress={() => setDoc('terms')} scaleTo={0.95} accessibilityRole="button" accessibilityLabel="Terms of Use" style={s.link}>
              <Text style={s.linkText}>Terms</Text>
            </PressScale>
            <PressScale onPress={() => setDoc('privacy')} scaleTo={0.95} accessibilityRole="button" accessibilityLabel="Privacy Policy" style={s.link}>
              <Text style={s.linkText}>Privacy</Text>
            </PressScale>
          </View>
        </View>
      </ScrollView>
      {/* The buy button stays in reach, whatever the screen height. */}
      {selling ? (
        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={s.column}>
            {note ? <Text style={[s.note, note.bad && { color: c.red }]}>{note.text}</Text> : null}
            <PressScale onPress={onBuy} scaleTo={0.96} pressedStyle={{ opacity: 0.85 }} accessibilityRole="button" accessibilityLabel={cta} style={[s.cta, busy === 'buy' && { opacity: 0.7 }]}>
              {busy === 'buy' ? <ActivityIndicator color={c.scanInk} /> : <SwapText text={cta} style={s.ctaText} motion={motion} />}
            </PressScale>
            <SwapText text={terms} style={s.terms} motion={motion} block />
            {reason === 'welcome' ? (
              <PressScale onPress={onClose} scaleTo={0.96} accessibilityRole="button" accessibilityLabel="Continue with the free plan" style={s.skip}>
                <Text style={s.skipText}>Continue free</Text>
              </PressScale>
            ) : null}
          </View>
        </View>
      ) : null}
      <BottomSheet visible={!!doc} onClose={() => setDoc(null)} title={doc === 'privacy' ? 'Privacy Policy' : 'Terms of Use'} maxHeightRatio={0.9} maxWidth={620}>
        {doc ? <LegalDetail doc={(doc === 'privacy' ? legal.privacy : legal.terms) as LegalDoc} /> : null}
      </BottomSheet>
    </View>
  );
}

function PerkRow({ perk, spaced = false, compact = false }: { perk: Perk; spaced?: boolean; compact?: boolean }) {
  const c = useTheme();
  const s = useStyles();
  return (
    <View style={[s.perk, spaced && { marginTop: 14 }]}>
      <View style={[s.perkIcon, compact && s.perkIconSmall]}>
        <Ionicons name={perk.icon} size={compact ? 16 : 18} color={c.mint} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.perkTitle, compact && { fontSize: 14.5 }]}>{perk.title}</Text>
        <Text style={[s.perkText, compact && { fontSize: 13, lineHeight: 18 }]}>{perk.text}</Text>
      </View>
    </View>
  );
}

// Folds a row open (its height, a fade, and a short drop into place) and shut.
function Unfold({ open, motion, children }: { open: boolean; motion: boolean; children: ReactNode }) {
  const v = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [h, setH] = useState(0);
  useEffect(() => {
    Animated.timing(v, {
      toValue: open ? 1 : 0,
      duration: motion ? (open ? 340 : 220) : 0,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [open, motion, v]);
  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      aria-hidden={!open}
      style={{
        overflow: 'hidden',
        height: h ? v.interpolate({ inputRange: [0, 1], outputRange: [0, h] }) : 0,
        opacity: v.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] }),
      }}
    >
      {/* Measured off-flow so the fold knows the row's full height. */}
      <Animated.View
        onLayout={(e) => setH(Math.ceil(e.nativeEvent.layout.height))}
        style={{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: 12, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] }}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}

// A plan row: the chosen one takes the lime border and a faint lime wash,
// and its radio dot springs in.
function PlanCard({ on, motion, onPress, label, extra, children }: { on: boolean; motion: boolean; onPress: () => void; label: string; extra?: ReactNode; children: ReactNode }) {
  const c = useTheme();
  const s = useStyles();
  const v = useRef(new Animated.Value(on ? 1 : 0)).current;
  const dot = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: on ? 1 : 0, duration: motion ? 220 : 0, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
    if (motion && on) {
      dot.setValue(0);
      Animated.spring(dot, { toValue: 1, damping: 16, stiffness: 300, mass: 0.6, useNativeDriver: false }).start();
    } else dot.setValue(on ? 1 : 0);
  }, [on, motion, v, dot]);
  return (
    <PressScale onPress={onPress} scaleTo={0.98} accessibilityRole={'radio' as never} accessibilityState={{ selected: on }} accessibilityLabel={label}>
      <Animated.View
        style={[
          s.planBox,
          {
            borderColor: v.interpolate({ inputRange: [0, 1], outputRange: [c.surfaceBorder, c.mint] }),
            // Both ends opaque: blending into a see-through lime passed
            // through a bright half-lime on the way.
            backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: [c.surface, SELECTED_BG] }),
          },
        ]}
      >
        <View style={s.plan}>
        <Animated.View style={[s.radio, { borderColor: v.interpolate({ inputRange: [0, 1], outputRange: [c.textMuted, c.mint] }) }]}>
          <Animated.View
            style={[
              s.radioDot,
              {
                opacity: dot.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
                transform: [{ scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
              },
            ]}
          />
        </Animated.View>
        {children}
        </View>
        {extra ? (
          <Unfold open={on} motion={motion}>
            <View style={s.planExtra}>{extra}</View>
          </Unfold>
        ) : null}
      </Animated.View>
    </PressScale>
  );
}

// The surface with a 7% lime wash, as one solid colour.
const SELECTED_BG = '#13221A';

// Text that changes wording with a short crossfade (nothing moves).
function SwapText({ text, style, motion, block = false }: { text: string; style: TextStyle; motion: boolean; block?: boolean }) {
  const [current, setCurrent] = useState(text);
  const [old, setOld] = useState<string | null>(null);
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (text === current) return;
    if (!motion) {
      setCurrent(text);
      return;
    }
    setOld(current);
    setCurrent(text);
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 220, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(() => setOld(null));
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = block ? ((style.marginTop as number | undefined) ?? 0) : 0;
  return (
    <View style={block ? undefined : { alignSelf: 'stretch', alignItems: 'center' }}>
      {old !== null ? (
        <Animated.Text
          aria-hidden
          style={[
            style,
            {
              position: 'absolute',
              left: 0,
              right: 0,
              top,
              marginTop: 0,
              opacity: v.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: 'clamp' }),
            },
          ]}
        >
          {old}
        </Animated.Text>
      ) : null}
      <Animated.Text
        style={[
          style,
          {
            opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] }),
          },
        ]}
      >
        {current}
      </Animated.Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  topBar: { height: 52, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingHorizontal: 16 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 4 },
  column: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  title: { color: c.text, fontSize: 36, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
  lead: { color: c.textMuted, fontSize: 16, lineHeight: 23, marginTop: 10, maxWidth: 420 },

  meter: { marginTop: 20, paddingVertical: 16, paddingHorizontal: 16, borderRadius: 18, backgroundColor: c.surface, borderWidth: 1, borderColor: c.surfaceBorder, gap: 12 },
  pips: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pip: { flex: 1, height: 14, borderRadius: 4, backgroundColor: c.surfaceBorder },
  pipOn: { backgroundColor: c.mint },
  pipFull: { backgroundColor: c.amber },
  pipInf: { width: 30, alignItems: 'flex-end' },
  meterText: { color: c.textMuted, fontSize: 13.5, fontWeight: '600' },

  perks: { marginTop: 22 },
  perk: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  perkIconSmall: { width: 30, height: 30, borderRadius: 9 },
  perkIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: c.btnMintBg, borderWidth: 1, borderColor: c.btnMintBorder, alignItems: 'center', justifyContent: 'center' },
  perkTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  perkText: { color: c.textMuted, fontSize: 14, lineHeight: 20, marginTop: 2 },
  freeLine: { color: c.textMuted, fontSize: 13.5, lineHeight: 19, marginTop: 16 },

  plans: { marginTop: 22, gap: 10 },
  planBox: { borderRadius: 16, borderWidth: 1.5, borderColor: c.surfaceBorder, backgroundColor: c.surface, paddingHorizontal: 16 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 61, paddingVertical: 12 },
  planExtra: { borderTopWidth: 1, borderTopColor: 'rgba(166,223,107,0.16)', paddingTop: 12, paddingBottom: 14 },
  planOn: { borderColor: c.mint },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.textMuted, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: c.mint },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.mint },
  planNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planName: { color: c.text, fontSize: 16.5, fontWeight: '700' },
  planSub: { color: c.textMuted, fontSize: 13.5, marginTop: 2 },
  planPrice: { color: c.text, fontSize: 16.5, fontWeight: '800' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, backgroundColor: c.mint },
  badgeText: { color: c.scanInk, fontSize: 12, fontWeight: '800' },

  note: { color: c.textMuted, fontSize: 14, lineHeight: 19, marginTop: 14 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.surfaceBorder, backgroundColor: c.bg },
  cta: { marginTop: 4, height: 56, borderRadius: 16, backgroundColor: c.mint, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: c.scanInk, fontSize: 17, fontWeight: '800' },
  terms: { color: c.textMuted, fontSize: 12.5, lineHeight: 17, marginTop: 10, textAlign: 'center', minHeight: 51 },
  skip: { alignSelf: 'center', marginTop: 10, paddingHorizontal: 14, height: 40, justifyContent: 'center' },
  skipText: { color: c.text, fontSize: 15, fontWeight: '700' },
  secondary: { marginTop: 28, height: 50, borderRadius: 16, borderWidth: 1, borderColor: c.surfaceBorder, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: c.text, fontSize: 16, fontWeight: '700' },
  unavailable: { color: c.textMuted, fontSize: 15, lineHeight: 21, marginTop: 28, textAlign: 'center' },
  loading: { marginTop: 28, minHeight: 120, alignItems: 'center', justifyContent: 'center' },

  links: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 4, marginTop: 18 },
  link: { paddingHorizontal: 10, height: 36, justifyContent: 'center' },
  linkText: { color: c.textMuted, fontSize: 13.5, fontWeight: '600', textDecorationLine: 'underline' },
}));
