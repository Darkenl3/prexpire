import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, useTheme, LIGHT, CARD_SHADOW, type Tone } from '../theme';
import { useItems, type Item } from '../items';
import { useCategories } from '../categories';
import { useSettings } from '../settings';
import { expiryStatus, remindersDue, sortItems, SORT_ORDERS, type SortOrder } from '../preferences';
import { daysUntil } from '../scanner/dateParser';
import { Page } from '../components/Page';
import { PressScale } from '../components/Press';
import { categoryArt } from '../components/ResultSheet';
import { categoryTint } from '../components/ItemCard';
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
// rounded square, the name over "Category • Expires on {date}", and the
// remaining-days pill with a chevron. Everything is derived from the same
// real data as before (remindersDue + the shared sort preference): grouping,
// expiry maths, navigation and notification behaviour are untouched, and the
// reminders-off state still routes to Settings.

// One reminder card (the reference's horizontal list card). The days pill
// carries the expiry maths: green for upcoming, amber inside the warning
// window, red once expired, "Due today" on the day itself.
function ReminderCard({ item, compact = false, onPress }: { item: Item; compact?: boolean; onPress: () => void }) {
  const t = useTheme();
  const s = useStyles();
  const { settings, formatDate } = useSettings();
  const { nameOf, custom } = useCategories();
  const status = expiryStatus(item.expiresOn, settings.warningDays);
  const days = daysUntil(item.expiresOn, new Date());
  const tone: Tone = status === 'expired' ? 'red' : status === 'soon' ? 'amber' : 'green';
  const pill = status === 'expired' ? 'Expired' : days === 0 ? 'Due today' : days === 1 ? '1 day' : `${days} days`;
  const known = custom.find((cat) => cat.id === item.category);
  const tint = categoryTint(item.category, known?.tint);
  return (
    <PressScale
      onPress={onPress}
      scaleTo={0.985}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${pill}`}
      style={[s.card, compact && s.cardCompact, ...(t === LIGHT ? [CARD_SHADOW] : [])]}
    >
      <View style={[s.thumb, compact && s.thumbCompact, { backgroundColor: t.tints[tint].top, borderColor: t.tints[tint].border }]}>
        {categoryArt(item.category, compact ? 26 : 30)}
      </View>
      <View style={s.body}>
        <Text style={s.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={s.meta} numberOfLines={1}>
          {nameOf(item.category)}  •  Expires on {formatDate(item.expiresOn, item.datePrecision)}
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
          <Ionicons name="information" size={17} color={t.mint} />
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

      {/* The reference's right-aligned Add item action: a translucent green
          capsule with the bright mint plus medallion, opening the app's
          existing manual add flow (the same one the Lists tab's button opens). */}
      <View style={s.addRow}>
        <PressScale
          onPress={() => onNavigate('manual')}
          scaleTo={0.96}
          style={s.addBtn}
          accessibilityRole="button"
          accessibilityLabel="Add an item"
        >
          <View style={s.addPlus}>
            <Ionicons name="add" size={19} color={t.scanInk} />
          </View>
          <Text style={s.addText}>Add item</Text>
        </PressScale>
      </View>
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
    borderWidth: t === LIGHT ? 0 : 1,
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

  // One reminder card: the item cards' glass language (hairline on dark,
  // floating white on light), sized to the reference's proportions.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: t.surface,
    borderWidth: t === LIGHT ? 0 : 1,
    borderColor: t.surfaceBorder,
  },
  cardCompact: { paddingVertical: 9, paddingHorizontal: 10, gap: 10 },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbCompact: { width: 48, height: 48, borderRadius: 12 },
  body: { flex: 1, minWidth: 0 },
  name: { color: t.text, fontSize: 15.5, fontWeight: '700' },
  meta: { color: t.textMuted, fontSize: 12.5, marginTop: 3 },
  pill: { minHeight: 26, paddingHorizontal: 11, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 12.5, fontWeight: '700' },

  // The "All caught up!" empty card: a quieter surface than the content
  // cards, with the calendar medallion and its mint check badge.
  caughtUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: 16,
    backgroundColor: t.cardAlt,
    borderWidth: t === LIGHT ? 0 : 1,
    borderColor: t.surfaceBorder,
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

  // The right-aligned Add item capsule: translucent green with the mint plus
  // medallion and a soft mint glow.
  addRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingLeft: 8,
    paddingRight: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.btnMintBorder,
    backgroundColor: t.btnMintBg,
    ...(t === LIGHT
      ? { shadowColor: '#12C894', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 10, elevation: 3 }
      : { shadowColor: '#2EE8B6', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 14, elevation: 6 }),
  },
  addPlus: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.mint },
  addText: { color: t.mint, fontSize: 15, fontWeight: '700' },

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
