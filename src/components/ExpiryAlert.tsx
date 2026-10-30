import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { accents, makeStyles, useTheme, LIGHT, CARD_SHADOW_LIFTED } from '../theme';
import { useSettings } from '../settings';
import { useShopping } from '../shopping';
import { daysUntil } from '../scanner/dateParser';
import { FadeIn, PressScale } from './Press';

// The in-app expiry alert. One alert is on screen at a time (the rest are
// queued); it slides in gently below the header, answers with two clear
// actions, and leaves on its own after a while. It appears only while the
// app is open: nothing is delivered in the background.
//
// The card reflects the live list state: if the product is already on the
// Shopping List (for example because it was added automatically), the alert
// says so and offers to open the list instead of asking to add it again.

// How long the card waits before dismissing itself (treated as "Not now").
const AUTO_DISMISS_MS = 12_000;
// Breathing room kept between the card and the content pushed below it.
const CARD_GAP = 12;

// The measured height of the alert currently on screen (plus its breathing
// room). Screens reserve exactly this much space at the top of their scroll
// content (see AlertSpacer), so the floating card never covers a row: the
// content is pushed below it while it is visible, and settles back when it
// leaves.
const AlertSpaceCtx = createContext(0);

export function useAlertSpace() {
  return useContext(AlertSpaceCtx);
}

// The reserved space, rendered as the first thing inside a screen's scroll
// content. It grows and shrinks in step with the card's own slide so rows
// glide down under the alert and back up after it leaves.
export function AlertSpacer() {
  const space = useAlertSpace();
  const { motion } = useSettings();
  const h = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(h, { toValue: space, duration: motion ? 200 : 0, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [space, motion, h]);
  return <Animated.View pointerEvents="none" style={{ height: h }} />;
}

// Owns the measured height and renders the alert above the screens' content.
export function ExpiryAlertLayer({ onNavigate, children }: { onNavigate: (route: string) => void; children: ReactNode }) {
  const [space, setSpace] = useState(0);
  return (
    <AlertSpaceCtx.Provider value={space}>
      {children}
      <ExpiryAlertHost onNavigate={onNavigate} onHeight={setSpace} />
    </AlertSpaceCtx.Provider>
  );
}

export function ExpiryAlertHost({ onNavigate, onHeight }: { onNavigate: (route: string) => void; onHeight: (h: number) => void }) {
  const { alert } = useShopping();
  const insets = useSafeAreaInsets();
  // No alert on screen: the reserved space collapses everywhere at once.
  useEffect(() => {
    if (!alert) onHeight(0);
  }, [alert, onHeight]);
  if (!alert) return null;
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + 72, left: 0, right: 0, alignItems: 'center', zIndex: 60, elevation: 60 }}
    >
      <ExpiryAlertCard key={alert.key} alert={alert} onNavigate={onNavigate} onHeight={onHeight} />
    </View>
  );
}

function ExpiryAlertCard({ alert, onNavigate, onHeight }: { alert: { key: string; itemId: string; name: string; expiresOn: string }; onNavigate: (route: string) => void; onHeight: (h: number) => void }) {
  const c = useTheme();
  const s = useStyles();
  const { items: shopping, resolveAlert, dismissAlert } = useShopping();
  const { motion } = useSettings();
  const motionRef = useRef(motion);
  motionRef.current = motion;

  // Live list state, so the actions always match what is really on the list.
  const inList = shopping.some((x) => x.eventKey === alert.key && !x.purchasedAt);
  const days = daysUntil(alert.expiresOn, new Date());
  const expired = days < 0;

  // "Added" confirmation shown briefly before the card leaves.
  const [added, setAdded] = useState(false);
  // One action at a time: guards double taps and the auto-dismiss timer.
  const busy = useRef(false);

  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: motionRef.current ? 240 : 0, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [t]);
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] });

  // Leaves on its own after a while, unless the user just acted.
  useEffect(() => {
    if (added) return;
    const id = setTimeout(() => act('later'), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [added]);

  function act(action: 'add' | 'later', route?: string) {
    if (busy.current) return;
    busy.current = true;
    Haptics.selectionAsync().catch(() => {});
    if (route) onNavigate(route);
    const ok = resolveAlert(action);
    if (action === 'add' && ok) {
      // Show the confirmation briefly, then leave.
      setAdded(true);
      setTimeout(() => leave(), 750);
    } else {
      leave();
    }
  }

  function leave() {
    Animated.timing(t, { toValue: 0, duration: motionRef.current ? 190 : 0, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => dismissAlert());
  }

  const when =
    days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
  const body = inList
    ? expired
      ? `Your ${alert.name} has expired. It is already on your Shopping List.`
      : `Your ${alert.name} is expected to expire ${when}. It is already on your Shopping List.`
    : expired
      ? `Your ${alert.name} has expired. Would you like to add it to your Shopping List?`
      : `Your ${alert.name} is expected to expire ${when}. Would you like to add it to your Shopping List?`;

  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLabel={`${alert.name} is ${expired ? 'expired' : 'expiring soon'}`}
      // The measured height (plus its gap) is what every screen reserves, so
      // the card pushes content instead of covering it.
      onLayout={(e) => onHeight(Math.round(e.nativeEvent.layout.height) + CARD_GAP)}
      style={[s.wrap, { opacity: t, transform: [{ translateY }] }]}
    >
      <View style={s.card}>
        <View style={s.head}>
          <View style={[s.icon, { backgroundColor: expired ? c.alertIconBg : c.statusWarnBg }]}>
            <Ionicons name={expired ? 'alert-circle' : 'time'} size={22} color={expired ? c.red : accents.amber} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.title} numberOfLines={1}>
              {expired ? `${alert.name} has expired` : `${alert.name} is expiring soon`}
            </Text>
            <Text style={s.body}>{body}</Text>
          </View>
        </View>
        <View style={s.actions}>
          {added ? (
            <FadeIn style={s.added}>
              <Ionicons name="checkmark-circle" size={17} color={c.green} />
              <Text style={s.addedText}>Added to your Shopping List</Text>
            </FadeIn>
          ) : inList ? (
            <>
              <AlertButton label="View Shopping List" icon="cart-outline" tone="mint" onPress={() => act('later', 'tab:shop')} />
              <AlertButton label="Not now" onPress={() => act('later')} />
            </>
          ) : (
            <>
              <AlertButton label="Add to Shopping List" icon="cart-outline" tone="mint" onPress={() => act('add')} />
              <AlertButton label="Not now" onPress={() => act('later')} />
            </>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

function AlertButton({ label, icon, tone = 'neutral', onPress }: { label: string; icon?: keyof typeof Ionicons.glyphMap; tone?: 'neutral' | 'mint'; onPress: () => void }) {
  const c = useTheme();
  const s = useStyles();
  const color = tone === 'mint' ? c.green : c.textMuted;
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      scaleTo={0.96}
      style={[s.button, tone === 'mint' && { borderColor: c.btnMintBorder, backgroundColor: c.btnMintBg }]}
    >
      {icon && <Ionicons name={icon} size={15} color={color} />}
      <Text style={[s.buttonText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </PressScale>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { width: '100%', maxWidth: 440, paddingHorizontal: 16 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c.surface,
    padding: 14,
    gap: 12,
    ...(c === LIGHT ? CARD_SHADOW_LIFTED : null),
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: c.text, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  body: { color: c.textMuted, fontSize: 13.5, lineHeight: 18.5, marginTop: 2 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c.cardAlt,
  },
  buttonText: { fontSize: 14, fontWeight: '600' },
  added: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 4 },
  addedText: { color: c.green, fontSize: 14, fontWeight: '600' },
}));
