import { useMemo } from 'react';
import { Image, Text, View } from 'react-native';
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
import { StatusMedallion } from '../components/HomeComponents';

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
  const { warning, formatDate } = useSettings();
  const { nameOf } = useCategories();
  const status = expiryStatus(item.expiresOn, warning(item.category));
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
        {item.image ? (
          <Image source={{ uri: item.image }} style={s.thumbImage} accessibilityLabel={`${item.name} product photo`} accessibilityRole="image" />
        ) : (
          categoryArt(item.category, compact ? 26 : 30)
        )}
      </View>
      <View style={s.body}>
        {/* The name wraps to a second line instead of cutting to an ellipsis,
            matching the item cards on the Lists tab. */}
        <Text style={s.name} numberOfLines={2}>
          {item.name}
        </Text>
        {/* The category and the exact date beside the countdown pill. */}
        <Text style={s.meta} numberOfLines={1}>
          {nameOf(item.category)} · {formatDate(item.expiresOn, item.datePrecision)}
        </Text>
      </View>
      <View style={[s.pill, { backgroundColor: t.pills[tone].bg }]}>
        <Ionicons name={status === 'expired' ? 'alert-circle' : 'time-outline'} size={13} color={t.pills[tone].text} />
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
  // Upcoming, split into the next seven days and later.
  const now = new Date();
  const thisWeek = upcoming.filter((i) => daysUntil(i.expiresOn, now) <= 7);
  const later = upcoming.filter((i) => daysUntil(i.expiresOn, now) > 7);
  const next = [...upcoming].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0];
  const nextDays = next ? daysUntil(next.expiresOn, now) : null;

  // Cycles the shared sort preference through the app's orders (the control
  // the reference shows as "Soonest first" with its up/down icon).
  const cycleSort = () => update({ sort: SORT_ORDERS[(SORT_ORDERS.indexOf(settings.sort) + 1) % SORT_ORDERS.length] });

  if (!settings.reminders) {
    return (
      <Page tab="reminders" title="Reminders" subtitle="Keep track before it's too late." badge={badge} onNavigate={onNavigate}>
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
    <Page tab="reminders" title="Reminders" subtitle="Keep track before it's too late." badge={badge} onNavigate={onNavigate}>
      {/* The summary: how much is due now, this week, and later. */}
      <View style={s.summary}>
        {[
          { label: 'Due now', value: due.length, color: due.length ? t.red : t.text },
          { label: 'This week', value: thisWeek.length, color: thisWeek.length ? t.amberText : t.text },
          { label: 'Later', value: later.length, color: t.text },
        ].map((x) => (
          <View key={x.label} style={s.summaryBox}>
            <Text style={[s.summaryValue, { color: x.color }]}>{x.value}</Text>
            <Text style={s.summaryLabel}>{x.label}</Text>
          </View>
        ))}
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
          <StatusMedallion tone="ok" size={46} />
          <Text style={s.caughtUpTitle}>All caught up!</Text>
          <Text style={s.caughtUpSub}>
            {next
              ? `Nothing is due. Next up: ${next.name}, ${nextDays === 0 ? 'today' : nextDays === 1 ? 'tomorrow' : `in ${nextDays} days`}.`
              : 'Nothing is due, and nothing is being tracked yet.'}
          </Text>
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
          style={s.sortHit}
          accessibilityRole="button"
          accessibilityLabel={`Sort order: ${SORT_SHORT[settings.sort]}. Tap to change.`}
        >
          <View style={s.sortBtn}>
            <Text style={s.sortText} numberOfLines={1}>
              {SORT_SHORT[settings.sort]}
            </Text>
            <Ionicons name="chevron-expand" size={14} color={t.textMuted} />
          </View>
        </PressScale>
      </View>
      {upcoming.length > 0 ? (
        [
          { key: 'week', title: 'This week', list: thisWeek },
          { key: 'later', title: 'Later', list: later },
        ]
          .filter((g) => g.list.length)
          .map((g) => (
            <View key={g.key}>
              <Text style={s.groupTitle}>{g.title}</Text>
              <View style={[s.list, settings.compact && s.listCompact]}>
                {g.list.map((item) => (
                  <ReminderCard key={item.id} item={item} compact={settings.compact} onPress={() => onNavigate('tab:items')} />
                ))}
              </View>
            </View>
          ))
      ) : (
        <Text style={s.noneText}>No upcoming reminders.</Text>
      )}
      {/* What notifications are here, honestly: in-app alerts only. */}
      <View style={s.footnote}>
        <Ionicons name="information-circle-outline" size={16} color={t.textMuted} />
        <Text style={s.footnoteText}>Expiry alerts appear while the app is open. Nothing is sent in the background yet.</Text>
      </View>
    </Page>
  );
}

const useStyles = makeStyles((t) => ({
  // The summary row: three numbers in the cards' surface language.
  summary: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  summaryBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    ...(t === LIGHT ? CARD_SHADOW : null),
  },
  summaryValue: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  summaryLabel: { color: t.textMuted, fontSize: 12.5, fontWeight: '600', marginTop: 1 },
  groupTitle: { color: t.textMuted, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 6, marginBottom: 8 },
  footnote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, paddingHorizontal: 4 },
  footnoteText: { flex: 1, color: t.textMuted, fontSize: 12.5, lineHeight: 17 },
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
  // The pill keeps its size; the tap area around it is a full 44 pt.
  sortHit: { paddingVertical: 6, marginVertical: -6 },
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
    borderRadius: 16,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
  },
  cardCompact: { paddingVertical: 10, paddingHorizontal: 11, gap: 11 },
  // The art square: the same pale-green tile the item cards use.
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.iconTile,
    overflow: 'hidden',
  },
  thumbCompact: { width: 50, height: 50, borderRadius: 12 },
  // The scanned product's retrieved photo fills the art tile.
  thumbImage: { width: '100%', height: '100%' },
  body: { flex: 1, minWidth: 0 },
  name: { color: t.text, fontSize: 16, fontWeight: '700', lineHeight: 20 },
  meta: { color: t.textSub, fontSize: 13, lineHeight: 18, marginTop: 3 },
  pill: { minHeight: 28, paddingHorizontal: 10, borderRadius: 999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 },
  pillText: { fontSize: 13, fontWeight: '700' },

  // The "All caught up!" empty card: a quiet but clearly-visible card on
  // the light page too — hairline plus the soft shadow.
  caughtUp: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 26,
    paddingHorizontal: 20,
    borderRadius: 20,
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
  caughtUpTitle: { color: t.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, marginTop: 8 },
  caughtUpSub: { color: t.textMuted, fontSize: 14, lineHeight: 19, textAlign: 'center' },
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
