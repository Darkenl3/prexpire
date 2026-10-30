import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, useTheme, LIGHT, CARD_SHADOW, CARD_SHADOW_DARK, type Tone } from '../theme';
import { useItems, type Item } from '../items';
import { useCategories } from '../categories';
import { useSettings } from '../settings';
import { expiryStatus, remindersDue, sortItems, SORT_ORDERS, type SortOrder } from '../preferences';
import { daysUntil } from '../scanner/dateParser';
import { Page } from '../components/Page';
import { PressScale } from '../components/Press';
import { categoryArt } from '../components/ResultSheet';
import { SmallButton } from '../components/SettingsRows';

type Props = { badge: number; onNavigate: (route: string) => void };

// The sort control's labels (the reference's "Soonest first" wording). The
// control edits the app's ONE shared sort preference — the same value the
// Lists tab's pills and Settings' picker write — so every surface always
// agrees. Soonest first (expiry) is the default and the reference's state.
const SORT_SHORT: Record<SortOrder, string> = { expiry: 'Soonest first', added: 'Recently added', name: 'A–Z' };

// The Reminders tab, redesigned to the reference screenshot: the glass
// information banner under the title, "Due now" with its live status and the
// big "All caught up!" empty card, "Upcoming (N)" with the soonest-first sort
// control, and horizontal reminder cards — the category's art in a tinted
// rounded square, the name over the category, and the remaining-days pill
// with a chevron. The pill is the only expiry countdown on the card (the
// exact date lives on the Lists tab's item cards), so the row stays clean.
// Everything is derived from the same real data as before (remindersDue +
// the shared sort preference): grouping, expiry maths, navigation and
// notification behaviour are untouched, and the reminders-off state still
// routes to Settings.

// One reminder card (the reference's horizontal list card). The days pill
// carries the expiry maths: green for upcoming, amber inside the warning
// window, red once expired, "Due today" on the day itself.
function ReminderCard({ item, compact = false, onPress }: { item: Item; compact?: boolean; onPress: () => void }) {
  const t = useTheme();
  const s = useStyles();
  const { settings } = useSettings();
  const { nameOf } = useCategories();
  const status = expiryStatus(item.expiresOn, settings.warningDays);
  const days = daysUntil(item.expiresOn, new Date());
  const tone: Tone = status === 'expired' ? 'red' : status === 'soon' ? 'amber' : 'green';
  const pill = status === 'expired' ? 'Expired' : days === 0 ? 'Due today' : days === 1 ? '1 day' : `${days} days`;
  return (
    <PressScale
      onPress={onPress}
      scaleTo={0.985}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${pill}`}
      style={[s.card, compact && s.cardCompact, ...(t === LIGHT ? [CARD_SHADOW] : [CARD_SHADOW_DARK])]}
    >
      <View style={[s.thumb, compact && s.thumbCompact]}>
        {categoryArt(item.category, compact ? 26 : 30)}
      </View>
      <View style={s.body}>
        {/* The name wraps to a second line instead of cutting to an ellipsis,
            matching the item cards on the Lists tab. */}
        <Text style={s.name} numberOfLines={2}>
          {item.name}
        </Text>
        {/* Clean meta: just the category. The pill is the countdown; the
            exact date stays on the Lists tab's item cards. */}
        <Text style={s.meta} numberOfLines={1}>
          {nameOf(item.category)}
        </Text>
      </View>
      <View style={[s.pill, { backgroundColor: t.pills[tone].bg }]}>
        <Text style={[s.pillText, { color: t.pills[tone].text }]} numberOfLines={1} minimumFontScale={0.8} adjustsFontSizeToFit>
          {pill}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={t.textMuted} />
    </PressScale>
  );
}

export function RemindersScreen({ badge, onNavigate }: Props) {
  const t = useTheme();
  const s = useStyles();
  const { items } = useItems();
  const { settings, update } = useSettings();
  const { due, upcoming } = useMemo(() => {
    const dueList = sortItems(remindersDue(items, settings.reminderLead), 'expiry');
    const dueIds = new Set(dueList.map((i) => i.id));
    return { due: dueList, upcoming: sortItems(items.filter((i) => !dueIds.has(i.id)), settings.sort) };
  }, [items, settings.reminderLead, settings.sort]);

  // Cycles the shared sort preference through the app's orders (the control
  // the reference shows as "Soonest first" with its up/down icon).
  const cycleSort = () => update({ sort: SORT_ORDERS[(SORT_ORDERS.indexOf(settings.sort) + 1) % SORT_ORDERS.length] });

  if (!settings.reminders) {
    return (
      <Page title="Reminders" subtitle="Keep track before it's too late." badge={badge} onNavigate={onNavigate}>
        <View style={s.off}>
          <View style={s.offIcon}>
            <Ionicons name="notifications-off-outline" size={26} color={t.textMuted} />
          </View>
          <Text style={s.offTitle}>Expiry reminders are off</Text>
          <Text style={s.offText}>Turn them on in Settings to see which items need a reminder.</Text>
          <SmallButton label="Open Settings" icon="settings-outline" tone="mint" onPress={() => onNavigate('tab:settings')} />
        </View>
      </Page>
    );
  }

  return (
    <Page title="Reminders" subtitle="Keep track before it's too late." badge={badge} onNavigate={onNavigate}>
      {/* The information banner: what this page shows and what notifications
          actually are here (in-app alerts while open, nothing in the
          background) — the same accurate message as before, in the
          reference's glass card with the mint info medallion. */}
      <View style={s.banner}>
        <View style={s.bannerIcon}>
          <Ionicons name="information" size={17} color={t.green} />
        </View>
        <Text style={s.bannerText}>Reminders are listed here. Expiry alerts also appear while the app is open; nothing is sent in the background.</Text>
      </View>

      {/* Due now: the live status beside the heading, and either the actual
          due reminders or the reference's large empty-state card. */}
      <View style={[s.sectionRow, s.sectionFirst]}>
        <Text style={s.sectionTitle} accessibilityRole="header">
          Due now
        </Text>
        <Text style={s.sectionMeta}>{due.length === 0 ? 'No reminders are due.' : due.length === 1 ? '1 reminder due' : `${due.length} reminders due`}</Text>
      </View>
      {due.length > 0 ? (
        <View style={[s.list, settings.compact && s.listCompact]}>
          {due.map((item) => (
            <ReminderCard key={item.id} item={item} compact={settings.compact} onPress={() => onNavigate('tab:items')} />
          ))}
        </View>
      ) : (
        <View style={s.caughtUp}>
          <View style={s.caughtUpIcon}>
            <Ionicons name="calendar-outline" size={25} color={t.textMuted} />
            <View style={s.caughtUpCheck}>
              <Ionicons name="checkmark" size={12} color={t.scanInk} />
            </View>
          </View>
          <View style={s.caughtUpText}>
            <Text style={s.caughtUpTitle}>All caught up!</Text>
            <Text style={s.caughtUpSub}>You have no reminders due right now.</Text>
          </View>
        </View>
      )}

      {/* Upcoming: the live count in the heading, the sort control on the
          right. */}
      <View style={s.sectionRow}>
        <Text style={s.sectionTitle} accessibilityRole="header">
          Upcoming ({upcoming.length})
        </Text>
        <PressScale
          onPress={cycleSort}
          scaleTo={0.96}
          hitSlop={6}
          style={s.sortBtn}
          accessibilityRole="button"
          accessibilityLabel={`Sort order: ${SORT_SHORT[settings.sort]}. Tap to change.`}
        >
          <Text style={s.sortText} numberOfLines={1}>
            {SORT_SHORT[settings.sort]}
          </Text>
          <Ionicons name="chevron-expand" size={14} color={t.textMuted} />
        </PressScale>
      </View>
      {upcoming.length > 0 ? (
        <View style={[s.list, settings.compact && s.listCompact]}>
          {upcoming.map((item) => (
            <ReminderCard key={item.id} item={item} compact={settings.compact} onPress={() => onNavigate('tab:items')} />
          ))}
        </View>
      ) : (
        <Text style={s.noneText}>No upcoming reminders.</Text>
      )}
    </Page>
  );
}

const useStyles = makeStyles((t) => ({
  // The glass information banner: the content cards' own surface language.
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    marginBottom: 18,
    ...(t === LIGHT ? CARD_SHADOW : null),
  },
  bannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: t.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerText: { flex: 1, color: t.textMuted, fontSize: 13.5, lineHeight: 19 },

  // Section headings with their right-side live status / sort control.
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 22, marginBottom: 10 },
  sectionFirst: { marginTop: 2 },
  sectionTitle: { color: t.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3, flexShrink: 1 },
  sectionMeta: { color: t.textMuted, fontSize: 13, textAlign: 'right' },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    backgroundColor: t.cardAlt,
  },
  sortText: { color: t.textMuted, fontSize: 12.5, fontWeight: '600' },

  list: { gap: 10 },
  listCompact: { gap: 8 },

  // One reminder card: the item cards' language — white with a fine
  // #DFECE5 hairline and a soft shadow on the light page (so it stays
  // clearly visible against the near-white page), translucent glass with a
  // hairline on dark.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
  },
  cardCompact: { paddingVertical: 10, paddingHorizontal: 11, gap: 11 },
  // The art square: the same pale-green tile the item cards use.
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.iconTile,
  },
  thumbCompact: { width: 50, height: 50, borderRadius: 13 },
  body: { flex: 1, minWidth: 0 },
  name: { color: t.text, fontSize: 16, fontWeight: '700', lineHeight: 20 },
  meta: { color: t.textSub, fontSize: 13, lineHeight: 18, marginTop: 3 },
  pill: { minHeight: 28, paddingHorizontal: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 13, fontWeight: '700' },

  // The "All caught up!" empty card: a quiet but clearly-visible card on
  // the light page too — hairline plus the soft shadow.
  caughtUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: 16,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    ...(t === LIGHT ? CARD_SHADOW : null),
  },
  caughtUpIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.iconTile,
  },
  caughtUpCheck: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 19,
    height: 19,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.mint,
    borderWidth: 1.5,
    borderColor: t.bg,
  },
  caughtUpText: { flex: 1, minWidth: 0 },
  caughtUpTitle: { color: t.text, fontSize: 17, fontWeight: '700' },
  caughtUpSub: { color: t.textMuted, fontSize: 13.5, marginTop: 2 },
  noneText: { color: t.textMuted, fontSize: 14, paddingVertical: 8 },

  // Reminders off: the same quiet card, centred, still one tap from Settings.
  off: {
    alignItems: 'center',
    gap: 9,
    paddingVertical: 36,
    paddingHorizontal: 18,
    borderRadius: 16,
    backgroundColor: t.cardAlt,
    borderWidth: t === LIGHT ? 0 : 1,
    borderColor: t.surfaceBorder,
  },
  offIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: t.iconTile, marginBottom: 4 },
  offTitle: { color: t.text, fontSize: 17, fontWeight: '700' },
  offText: { color: t.textMuted, fontSize: 14, textAlign: 'center', marginBottom: 7 },
}));
