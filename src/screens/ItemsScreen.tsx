import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, useTheme, LIGHT, CARD_SHADOW } from '../theme';
import { useCategories } from '../categories';
import { useItems, type CategoryId } from '../items';
import { useSettings } from '../settings';
import { useShopping } from '../shopping';
import { expiryStatus, SORT_ORDERS, sortItems, type SortOrder } from '../preferences';
import { Page } from '../components/Page';
import { ItemCard, categoryIcon } from '../components/ItemCard';
import { Note, SmallButton } from '../components/SettingsRows';
import { ChoicePill, useScrollSelectedIntoView, type PillColors } from '../components/ChoicePill';
import { SearchField } from '../components/SearchField';
import { PressScale } from '../components/Press';
import { ShoppingListBody, ShoppingToast } from './ShoppingScreen';

type Props = { badge: number; category?: CategoryId; shopping?: boolean; onNavigate: (route: string) => void };

// The search field appears once there is enough to look through; below this the
// list is still glanceable at full length (and the field never eats that space).
const SEARCH_FROM = 8;

// Labels for the sort pills, in the reference's dropdown wording; the Settings
// page spells the same values out in full, and both always agree because they
// edit the same preference.
const SORT_SHORT: Record<SortOrder, string> = { expiry: 'Expiry date', added: 'Recent', name: 'A–Z' };

// The Lists tab, redesigned to the reference screenshot: the prominent mint
// "Add item" capsule beside the title, the Items / Shopping list segmented
// switch, icon category chips, the count + sort-by toolbar, wide glass item
// cards (art square, meta rows, expiry progress bar, actions menu, days-left
// pill) and the waste-reduction summary card under the list. Everything reads
// the same real data as before — no sample products, no new dependencies.
export function ItemsScreen({ badge, category, shopping, onNavigate }: Props) {
  const { items } = useItems();
  const { settings, update } = useSettings();
  const { all, custom } = useCategories();
  const { toBuyCount } = useShopping();
  const c = useTheme();
  const s = useStyles();
  const [filter, setFilter] = useState<'all' | CategoryId>(category ?? 'all');
  const [query, setQuery] = useState('');
  // Shopping-list toasts are hoisted here so they float at the screen bottom,
  // outside the scrolling Page (the body and the item cards report them through
  // onToast). Rendered for BOTH views of the tab.
  const [shopToast, setShopToast] = useState<string | null>(null);
  // The Shopping List's add dialog, hoisted so the title block's "Add item"
  // capsule can open it too (not only the section header's action).
  const [shopAddOpen, setShopAddOpen] = useState(false);

  const needle = query.trim().toLowerCase();
  const inCategory = useMemo(() => (filter === 'all' ? items : items.filter((i) => i.category === filter)), [items, filter]);
  const searched = useMemo(() => (needle ? inCategory.filter((i) => i.name.toLowerCase().includes(needle)) : inCategory), [inCategory, needle]);
  const expired = searched.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) === 'expired');
  const shown = useMemo(
    () => sortItems(settings.showExpired ? searched : searched.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) !== 'expired'), settings.sort),
    [searched, settings.showExpired, settings.sort, settings.warningDays],
  );
  // The amber half of the toolbar's count: tracked products inside the warning
  // window (the same status the cards' day pills already colour amber).
  const soon = useMemo(() => searched.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) === 'soon').length, [searched, settings.warningDays]);

  const showSearch = items.length >= SEARCH_FROM || needle.length > 0;
  const pills: PillColors = { offBg: c.cardAlt, offBorder: c.surfaceBorder, offText: c.textMuted, onBg: c.mint, onBorder: c.mint, onText: c.scanInk };
  // Arriving from a Home category tile: scroll the pill row so that tile's
  // pill (solid green) is on screen instead of far to the right.
  const { scrollRef: pillsScroll, note: notePill } = useScrollSelectedIntoView(filter);

  // The prominent mint capsule beside the title: on the Items view it opens
  // the manual add flow; on the Shopping List view it opens the list's own
  // add dialog (the same one its section header's action opens).
  const headerAction = (
    <PressScale
      onPress={() => (shopping ? setShopAddOpen(true) : onNavigate('manual'))}
      scaleTo={0.96}
      style={s.addBtn}
      accessibilityRole="button"
      accessibilityLabel={shopping ? 'Add an item to your Shopping List' : 'Add an item'}
    >
      <Ionicons name="add" size={19} color={c.scanInk} />
      <Text style={s.addBtnText}>Add item</Text>
    </PressScale>
  );

  return (
    <>
      <Page
        title={shopping ? 'Shopping List' : 'Items'}
        subtitle={shopping ? 'What you need to buy next.' : "Everything you're tracking."}
        badge={badge}
        maxWidth={shopping ? 640 : undefined}
        headerAction={headerAction}
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
          <ShoppingListBody addOpen={shopAddOpen} setAddOpen={setShopAddOpen} onToast={setShopToast} />
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
                  <ChoicePill
                    label={cat.name}
                    selected={filter === cat.id}
                    onPress={() => setFilter(cat.id as CategoryId)}
                    colors={pills}
                    icon={categoryIcon(cat.id, custom.find((x) => x.id === cat.id)?.icon)}
                    accessibilityLabel={`Category: ${cat.name}`}
                  />
                </View>
              ))}
            </ScrollView>
            {/* The toolbar: the visible count (with the amber "expiring soon"
                half) on the left, "Sort by" with its pills aligned right. */}
            <View style={s.toolbar}>
              <View style={s.toolbarMeta}>
                <Text style={s.metaText}>{shown.length === 1 ? '1 item' : `${shown.length} items`}</Text>
                {soon > 0 && <Text style={s.soonText}>{soon === 1 ? '1 expiring soon' : `${soon} expiring soon`}</Text>}
              </View>
              <View style={s.sortRow} accessibilityRole="radiogroup" accessibilityLabel="Sort order">
                <Text style={s.sortLabel}>Sort by</Text>
                {SORT_ORDERS.map((order) => (
                  <ChoicePill
                    key={order}
                    label={SORT_SHORT[order]}
                    selected={settings.sort === order}
                    onPress={() => update({ sort: order })}
                    colors={pills}
                    size="small"
                    // The primary control carries the dropdown's chevron, like
                    // the reference's "Expiry date" pill.
                    icon={order === 'expiry' ? 'chevron-down' : undefined}
                    iconAfter
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
                <ItemCard key={item.id} item={item} compact={settings.compact} onToast={setShopToast} />
              ))}
            </View>
            {/* The waste-reduction summary card under the list: the real tracked
                count and the app's own mission line. It opens Home, where the
                attention card, "Coming up next" and the category grid live —
                the app's summary dashboard. */}
            {items.length > 0 && (
              <PressScale onPress={() => onNavigate('tab:home')} scaleTo={0.985} style={s.waste} accessibilityRole="button" accessibilityLabel="Your waste reduction summary">
                <View style={s.wasteIcon}>
                  <Ionicons name="leaf" size={22} color={c.mint} />
                </View>
                <View style={s.wasteText}>
                  <Text style={s.wasteTitle}>{items.length === 1 ? '1 item tracked' : `${items.length} items tracked`}</Text>
                  <Text style={s.wasteSub} numberOfLines={1}>
                    You're helping to reduce food waste!
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
              </PressScale>
            )}
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
      {shopToast && <ShoppingToast key={shopToast} text={shopToast} onDone={() => setShopToast(null)} />}
    </>
  );
}

const useStyles = makeStyles((t) => ({
  // The prominent mint action capsule beside the title (the reference's
  // "＋ Add item"): solid mint with dark ink, soft lift on the light page.
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: t.mint,
    ...(t === LIGHT
      ? { shadowColor: '#12C894', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10, elevation: 3 }
      : { shadowColor: '#0B3B2E', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 }),
  },
  addBtnText: { color: t.scanInk, fontSize: 15, fontWeight: '700' },

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
  // left and "Sort by" with its pills on the right, wrapped when narrow.
  // Its bottom margin is the breathing room the reference shows between the
  // sort row and the first item card — without it the cards crowd the pills.
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 12, marginBottom: 16 },
  toolbarMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  metaText: { color: t.textMuted, fontSize: 13.5 },
  soonText: { color: t.amberText, fontSize: 13.5, fontWeight: '600' },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  sortLabel: { color: t.textMuted, fontSize: 12.5, fontWeight: '600', marginRight: 2 },
  hidden: { marginBottom: 10 },
  list: { gap: 10 },
  listCompact: { gap: 8 },
  // The waste-reduction summary card: the same wide glass card as the item
  // cards, with the leaf medallion on a soft mint disc.
  waste: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: t.surface,
    borderWidth: t === LIGHT ? 0 : 1,
    borderColor: t.surfaceBorder,
    marginTop: 12,
    ...(t === LIGHT ? CARD_SHADOW : null),
  },
  wasteIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t === LIGHT ? '#D9FBF0' : 'rgba(46,232,182,0.10)',
  },
  wasteText: { flex: 1, minWidth: 0 },
  wasteTitle: { color: t.text, fontSize: 15.5, fontWeight: '700' },
  wasteSub: { color: t.textMuted, fontSize: 13, marginTop: 1 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  emptyTitle: { color: t.text, fontSize: 17, fontWeight: '600' },
  emptyText: { color: t.textMuted, fontSize: 14, marginBottom: 6 },
  // Empty-state action pairs (scan + manual entry).
  emptyButtons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
}));
