import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, useTheme } from '../theme';
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

const LEADS: Record<PaywallReason, (n: number) => string> = {
  welcome: () => `Free with ${FREE_ITEM_LIMIT} new items every month. Pro tracks every shop, the pantry and the medicine cabinet, with no limit.`,
  limit: () => `You've added this month's ${FREE_ITEM_LIMIT} free items. Everything you track keeps working. Pro lets you keep adding.`,
  categories: () => `The free plan includes ${FREE_CUSTOM_CATEGORIES} category of your own. Pro lets you add as many as you need.`,
  settings: () => `Free with ${FREE_ITEM_LIMIT} new items every month. Pro takes the limit away.`,
};

const PERKS: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
  { icon: 'infinite', title: 'Unlimited items', text: 'Add every shop, every week, without counting.' },
  { icon: 'grid-outline', title: 'Unlimited categories', text: 'Make a category for the garage, the baby, the first-aid kit.' },
  { icon: 'heart-outline', title: 'Keeps Prexpire independent', text: 'No ads and no tracking, now or later.' },
];

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
      Animated.timing(fade, { toValue: 1, duration: motion ? 260 : 0, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else if (shown) {
      Animated.timing(fade, { toValue: 0, duration: motion ? 180 : 0, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setShown(null));
    }
  }, [paywall]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={closePaywall}>
      <Animated.View style={{ flex: 1, opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
        <PaywallBody reason={shown} onClose={closePaywall} />
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

  useEffect(() => {
    if (!available || plans) return;
    let live = true;
    loadPlans().then(() => live && setLoadFailed(false));
    const t = setTimeout(() => live && setLoadFailed(true), 12_000);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [available, plans, loadPlans]);

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
            {PERKS.map((p) => (
              <View key={p.title} style={s.perk}>
                <View style={s.perkIcon}>
                  <Ionicons name={p.icon} size={18} color={c.mint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.perkTitle}>{p.title}</Text>
                  <Text style={s.perkText}>{p.text}</Text>
                </View>
              </View>
            ))}
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
                    <PressScale
                      key={p.id}
                      onPress={() => setSelected(p.id)}
                      scaleTo={0.98}
                      accessibilityRole={'radio' as never}
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${name}, ${p.price}`}
                      style={[s.plan, on && s.planOn]}
                    >
                      <View style={[s.radio, on && s.radioOn]}>{on ? <View style={s.radioDot} /> : null}</View>
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
                    </PressScale>
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
              {busy === 'buy' ? <ActivityIndicator color={c.scanInk} /> : <Text style={s.ctaText}>{cta}</Text>}
            </PressScale>
            <Text style={s.terms}>{terms}</Text>
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

  perks: { marginTop: 22, gap: 14 },
  perk: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  perkIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: c.btnMintBg, borderWidth: 1, borderColor: c.btnMintBorder, alignItems: 'center', justifyContent: 'center' },
  perkTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
  perkText: { color: c.textMuted, fontSize: 14, lineHeight: 20, marginTop: 2 },
  freeLine: { color: c.textMuted, fontSize: 13.5, lineHeight: 19, marginTop: 2 },

  plans: { marginTop: 22, gap: 10 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1.5, borderColor: c.surfaceBorder, backgroundColor: c.surface },
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
  terms: { color: c.textMuted, fontSize: 12.5, lineHeight: 17, marginTop: 10, textAlign: 'center' },
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
