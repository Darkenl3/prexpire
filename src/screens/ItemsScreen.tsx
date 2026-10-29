import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PressScale } from '../components/Press';
import { makeStyles } from '../theme';
import { useCategories } from '../categories';
import { useItems, type CategoryId } from '../items';
import { useSettings } from '../settings';
import { expiryStatus, SORT_LABELS, sortItems } from '../preferences';
import { Page } from '../components/Page';
import { ItemRow } from '../components/ItemRow';
import { Note, Options, SmallButton } from '../components/SettingsRows';

type Props = { badge: number; category?: CategoryId; onNavigate: (route: string) => void };

// Every tracked item, filtered by category (built-in or the user's own) and
// ordered by the sorting chosen in Settings.
export function ItemsScreen({ badge, category, onNavigate }: Props) {
  const { items } = useItems();
  const { settings } = useSettings();
  const { all } = useCategories();
  const c = useStyles();
  const [filter, setFilter] = useState<'all' | CategoryId>(category ?? 'all');

  const inCategory = useMemo(() => (filter === 'all' ? items : items.filter((i) => i.category === filter)), [items, filter]);
  const expired = inCategory.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) === 'expired');
  const shown = useMemo(
    () => sortItems(settings.showExpired ? inCategory : inCategory.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) !== 'expired'), settings.sort),
    [inCategory, settings.showExpired, settings.sort, settings.warningDays],
  );

  return (
    <Page title="Items" subtitle="Everything you're tracking." badge={badge} onNavigate={onNavigate}>
      <Options
        label="Category"
        value={filter}
        onChange={setFilter}
        options={[{ value: 'all' as const, label: 'All' }, ...all.map((cat) => ({ value: cat.id as CategoryId, label: cat.name }))]}
      />
      <View style={c.meta}>
        <Text style={c.metaText}>
          {shown.length === 1 ? '1 item' : `${shown.length} items`} · {SORT_LABELS[settings.sort]}
        </Text>
        <PressScale onPress={() => onNavigate('tab:settings')} accessibilityRole="link" hitSlop={8} scaleTo={0.97}>
          <Text style={c.link}>Change</Text>
        </PressScale>
      </View>
      {!settings.showExpired && expired.length > 0 && (
        <View style={c.hidden}>
          <Note>
            {expired.length === 1 ? '1 expired item is hidden' : `${expired.length} expired items are hidden`}. You can show them again in Settings.
          </Note>
        </View>
      )}
      <View style={[c.list, settings.compact && c.listCompact]}>
        {shown.map((item) => (
          <ItemRow key={item.id} item={item} showDate />
        ))}
      </View>
      {shown.length === 0 && (
        <View style={c.empty}>
          <Text style={c.emptyTitle}>{items.length ? 'Nothing here' : 'No items yet'}</Text>
          <Text style={c.emptyText}>Scan a label or add a product by hand.</Text>
          <View style={c.emptyButtons}>
            <SmallButton label="Scan a label" icon="scan-outline" tone="mint" onPress={() => onNavigate('scan')} />
            <SmallButton label="Add manually" icon="create-outline" onPress={() => onNavigate('manual')} />
          </View>
        </View>
      )}
    </Page>
  );
}

const useStyles = makeStyles((t) => ({
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 10 },
  metaText: { color: t.textMuted, fontSize: 13.5 },
  link: { color: t.mint, fontSize: 14, fontWeight: '600' },
  hidden: { marginBottom: 10 },
  list: { gap: 8 },
  listCompact: { gap: 6 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  emptyTitle: { color: t.text, fontSize: 17, fontWeight: '600' },
  emptyText: { color: t.textMuted, fontSize: 14, marginBottom: 6 },
  // Empty-state action pairs (scan + manual entry).
  emptyButtons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
}));
