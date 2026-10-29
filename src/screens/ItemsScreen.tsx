import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, useTheme, LIGHT } from '../theme';
import { useCategories } from '../categories';
import { useItems, type CategoryId } from '../items';
import { useSettings } from '../settings';
import { useShopping } from '../shopping';
import { expiryStatus, SORT_ORDERS, sortItems, type SortOrder } from '../preferences';
import { Page } from '../components/Page';
import { ItemRow } from '../components/ItemRow';
import { Note, SmallButton } from '../components/SettingsRows';
import { ChoicePill, useScrollSelectedIntoView, type PillColors } from '../components/ChoicePill';
import { SearchField } from '../components/SearchField';
import { PressScale } from '../components/Press';
import { ShoppingListBody, ShoppingToast } from './ShoppingScreen';

type Props = { badge: number; category?: CategoryId; shopping?: boolean; onNavigate: (route: string) => void };

// The search field appears once there is enough to look through; below this the
// list is still glanceable at full length (and the field never eats that space).
const SEARCH_FROM = 8;

// Short labels for the sort pills; the Settings page spells the same values out
// in full, and both always agree because they edit the same preference.
const SORT_SHORT: Record<SortOrder, string> = { expiry: 'Expiry', added: 'Recent', name: 'A–Z' };

// The Lists tab: everything you're tracking (filtered by category, searched
// and sorted), plus the Shopping List as its second view — a full-width
// segmented control at the top switches between them and shows each side's
// count, so what is expiring (Items) and what is to buy (Shopping list) are
// separated at a glance. It also keeps the bottom nav at four tabs with the
// scan button dead-centre.
export function ItemsScreen({ badge, category, shopping, onNavigate }: Props) {
  const { items } = useItems();
  const { settings, update } = useSettings();
  const { all } = useCategories();
  const { toBuyCount } = useShopping();
  const c = useTheme();
  const s = useStyles();
  const [filter, setFilter] = useState<'all' | CategoryId>(category ?? 'all');
  const [query, setQuery] = useState('');
  // Shopping-list toasts are hoisted here so they float at the screen bottom,
  // outside the scrolling Page (the body reports them through onToast).
  const [shopToast, setShopToast] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const inCategory = useMemo(() => (filter === 'all' ? items : items.filter((i) => i.category === filter)), [items, filter]);
  const searched = useMemo(() => (needle ? inCategory.filter((i) => i.name.toLowerCase().includes(needle)) : inCategory), [inCategory, needle]);
  const expired = searched.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) === 'expired');
  const shown = useMemo(
    () => sortItems(settings.showExpired ? searched : searched.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) !== 'expired'), settings.sort),
    [searched, settings.showExpired, settings.sort, settings.warningDays],
  );
  // The amber half of the toolbar's count: tracked products inside the warning
  // window (the same status the rows' day pills already colour amber).
  const soon = useMemo(() => searched.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) === 'soon').length, [searched, settings.warningDays]);

  const showSearch = items.length >= SEARCH_FROM || needle.length > 0;
  const pills: PillColors = { offBg: c.cardAlt, offBorder: c.surfaceBorder, offText: c.textMuted, onBg: c.mint, onBorder: c.mint, onText: c.scanInk };
  // Arriving from a Home category tile: scroll the pill row so that tile's
  // pill (solid green) is on screen instead of far to the right.
  const { scrollRef: pillsScroll, note: notePill } = useScrollSelectedIntoView(filter);

  return (
    <>
      <Page
        title={shopping ? 'Shopping List' : 'Items'}
        subtitle={shopping ? 'What you need to buy next.' : "Everything you're tracking."}
        badge={badge}
        maxWidth={shopping ? 640 : undefined}
        onNavigate={onNavigate}
      >
        {/* The Lists tab's two views, as one full-width segmented control:
            what is EXPIRING (Items) is always visually separated from what is
            TO BUY (Shopping list), each side carrying its live count. Tapping
            either navigates (tab:items / tab:shop), so the address bar, the
            back button and the shell's glass bar all follow the switch like
            any other route. */}
        <View style={s.viewSwitch} accessibilityRole="radiogroup" aria-label="Lists view">
          <PressScale
            onPress={() => onNavigate('tab:items')}
            scaleTo={0.98}
            style={[s.seg, !shopping && s.segOn]}
            accessibilityRole="radio"
            aria-checked={!shopping}
            accessibilityLabel="Tracked items"
          >
            <Ionicons name="list" size={17} color={!shopping ? c.scanInk : c.textMuted} />
            <Text style={[s.segText, !shopping && s.segTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              Items
            </Text>
            <View style={[s.segCount, !shopping && s.segCountOn]}>
              <Text style={[s.segCountText, !shopping && s.segCountTextOn]}>{items.length > 99 ? '99+' : items.length}</Text>
            </View>
          </PressScale>
          <PressScale
            onPress={() => onNavigate('tab:shop')}
            scaleTo={0.98}
            style={[s.seg, !!shopping && s.segOn]}
            accessibilityRole="radio"
            aria-checked={!!shopping}
            accessibilityLabel="Shopping list"
          >
            <Ionicons name="cart-outline" size={17} color={shopping ? c.scanInk : c.textMuted} />
            <Text style={[s.segText, shopping && s.segTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              Shopping list
            </Text>
            <View style={[s.segCount, !!shopping && s.segCountOn]}>
              <Text style={[s.segCountText, shopping && s.segCountTextOn]}>{toBuyCount > 99 ? '99+' : toBuyCount}</Text>
            </View>
          </PressScale>
        </View>
        {shopping ? (
          <ShoppingListBody onToast={setShopToast} />
        ) : (
          <>
            {showSearch && (
              <View style={s.searchWrap}>
                <SearchField value={query} onChange={setQuery} />
              </View>
            )}
            <ScrollView
        ref={pillsScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={s.pillRow}
        accessibilityRole="radiogroup"
        accessibilityLabel="Category filter"
      >
        <View onLayout={(e) => notePill('all', e)}>
          <ChoicePill label="All" selected={filter === 'all'} onPress={() => setFilter('all')} colors={pills} accessibilityLabel="All categories" />
        </View>
        {all.map((cat) => (
          <View key={cat.id} onLayout={(e) => notePill(cat.id, e)}>
            <ChoicePill label={cat.name} selected={filter === cat.id} onPress={() => setFilter(cat.id as CategoryId)} colors={pills} />
          </View>
        ))}
      </ScrollView>
      {/* The toolbar: the visible count (with the amber "expiring soon" half)
        on the left, the sort pills aligned right — one row instead of two. */}
      <View style={s.toolbar}>
        <View style={s.toolbarMeta}>
          <Text style={s.metaText}>{shown.length === 1 ? '1 item' : `${shown.length} items`}</Text>
          {soon > 0 && <Text style={s.soonText}>{soon === 1 ? '1 expiring soon' : `${soon} expiring soon`}</Text>}
        </View>
        <View style={s.sortRow} accessibilityRole="radiogroup" accessibilityLabel="Sort order">
          <Text style={s.sortLabel}>Sort</Text>
          {SORT_ORDERS.map((order) => (
            <ChoicePill
              key={order}
              label={SORT_SHORT[order]}
              selected={settings.sort === order}
              onPress={() => update({ sort: order })}
              colors={pills}
              size="small"
              accessibilityLabel={`Sort by ${order === 'expiry' ? 'expiry date' : order === 'added' ? 'recently added' : 'product name'}`}
            />
          ))}
        </View>
      </View>
      {!settings.showExpired && expired.length > 0 && (
        <View style={s.hidden}>
          <Note>
            {expired.length === 1 ? '1 expired item is hidden' : `${expired.length} expired items are hidden`}. You can show them again in Settings.
          </Note>
        </View>
      )}
      <View style={[s.list, settings.compact && s.listCompact]}>
        {shown.map((item) => (
          <ItemRow key={item.id} item={item} showDate />
        ))}
      </View>
      {shown.length === 0 && !!needle && (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>No matches</Text>
          <Text style={s.emptyText}>Nothing you track is called “{query.trim()}”.</Text>
          <View style={s.emptyButtons}>
            <SmallButton label="Clear search" icon="close" onPress={() => setQuery('')} />
          </View>
        </View>
      )}
      {shown.length === 0 && !needle && (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>{items.length ? 'Nothing here' : 'No items yet'}</Text>
          <Text style={s.emptyText}>Scan a label or add a product by hand.</Text>
          <View style={s.emptyButtons}>
            <SmallButton label="Scan a label" icon="scan-outline" tone="mint" onPress={() => onNavigate('scan')} />
            <SmallButton label="Add manually" icon="create-outline" onPress={() => onNavigate('manual')} />
          </View>
        </View>
      )}
          </>
        )}
      </Page>
      {shopping && shopToast && <ShoppingToast key={shopToast} text={shopToast} onDone={() => setShopToast(null)} />}
    </>
  );
}

const useStyles = makeStyles((t) => ({
  // The Items / Shopping list segmented control (the tab's two views): a
  // full-width rounded track with two 44pt segments, the selected side filled
  // mint with the count chip — the clearest possible "expiring vs to buy"
  // separation, and it still fits the narrowest iPhones.
  viewSwitch: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    backgroundColor: t.cardAlt,
    marginBottom: 16,
  },
  seg: { flex: 1, height: 44, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 6 },
  segOn: { backgroundColor: t.mint },
  segText: { color: t.textMuted, fontSize: 14.5, fontWeight: '600' },
  segTextOn: { color: t.scanInk, fontWeight: '700' },
  segCount: {
    minWidth: 22,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t === LIGHT ? 'rgba(16,29,27,0.08)' : 'rgba(255,255,255,0.10)',
  },
  segCountOn: { backgroundColor: 'rgba(4,36,27,0.16)' },
  segCountText: { color: t.textMuted, fontSize: 11.5, fontWeight: '700' },
  segCountTextOn: { color: t.scanInk },
  searchWrap: { marginBottom: 12 },
  pillRow: { gap: 8, paddingVertical: 2 },
  // The toolbar row: the count (with its amber "expiring soon" half) on the
  // left and the compact sort pills on the right, wrapped when narrow.
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 12 },
  toolbarMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metaText: { color: t.textMuted, fontSize: 13.5 },
  soonText: { color: t.amberText, fontSize: 13.5, fontWeight: '600' },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sortLabel: { color: t.textMuted, fontSize: 12.5, fontWeight: '600', marginRight: 2 },
  hidden: { marginBottom: 10 },
  list: { gap: 8 },
  listCompact: { gap: 6 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  emptyTitle: { color: t.text, fontSize: 17, fontWeight: '600' },
  emptyText: { color: t.textMuted, fontSize: 14, marginBottom: 6 },
  // Empty-state action pairs (scan + manual entry).
  emptyButtons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
}));
