import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, useTheme, LIGHT, CARD_SHADOW } from '../theme';
import { useCategories } from '../categories';
import { useItems, type CategoryId } from '../items';
import { useSettings } from '../settings';
import { useShopping } from '../shopping';
import { expiryStatus, SORT_LABELS, SORT_ORDERS, sortItems, type SortOrder } from '../preferences';
import { Page } from '../components/Page';
import { ItemCard, categoryIcon } from '../components/ItemCard';
import { Note, OptionSheet, SmallButton } from '../components/SettingsRows';
import { ChoicePill, useScrollSelectedIntoView, type PillColors } from '../components/ChoicePill';
import { SearchField } from '../components/SearchField';
import { PressScale } from '../components/Press';
import { ShoppingListBody, ShoppingToast } from './ShoppingScreen';

type Props = { badge: number; category?: CategoryId; shopping?: boolean; onNavigate: (route: string) => void };

// Labels for the sort picker, in the reference's dropdown wording; the Settings
// page spells the same values out in full, and both always agree because they
// edit the same preference.
const SORT_SHORT: Record<SortOrder, string> = { expiry: 'Expiry date', added: 'Recent', name: 'A–Z' };

// The Lists tab, redesigned to the light reference: the compact title block
// with the prominent mint "Add item" capsule, the white rounded Items /
// Shopping list segmented control with small integrated count badges, the
// scrollable category chips, the search field beside the sort picker, the
// live count with real expired/valid status badges, and compact white
// product cards (pale-green art square, meta rows, thin expiry bar, days
// pill). Everything reads the same real data as before — no sample products,
// no new dependencies.
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
  // The sort picker sheet (one control instead of three pills — the reference's
  // single "Expiry date ⌄" dropdown).
  const [sortOpen, setSortOpen] = useState(false);

  const needle = query.trim().toLowerCase();
  const inCategory = useMemo(() => (filter === 'all' ? items : items.filter((i) => i.category === filter)), [items, filter]);
  const searched = useMemo(() => (needle ? inCategory.filter((i) => i.name.toLowerCase().includes(needle)) : inCategory), [inCategory, needle]);
  const expired = searched.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) === 'expired');
  const shown = useMemo(
    () => sortItems(settings.showExpired ? searched : searched.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) !== 'expired'), settings.sort),
    [searched, settings.showExpired, settings.sort, settings.warningDays],
  );
  // The toolbar's status badges, both computed from the real filtered items:
  // what has already expired, and what is still valid.
  const valid = searched.length - expired.length;

  const pills: PillColors =
    c === LIGHT
      ? // The reference's chips: white inactive capsules with a fine gray
        // border, solid mint selected with white ink.
        { offBg: c.surface, offBorder: c.surfaceBorder, offText: c.textMuted, onBg: c.mint, onBorder: c.mint, onText: '#FFFFFF' }
      : { offBg: c.cardAlt, offBorder: c.surfaceBorder, offText: c.textMuted, onBg: c.mint, onBorder: c.mint, onText: c.scanInk };
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
        dense
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
            {/* Search beside the sort picker (the reference's row below the
                chips): the field filters real products by name; the picker opens
                the same shared sort sheet as before. */}
            <View style={s.searchSortRow}>
              <View style={s.searchWrap}>
                <SearchField value={query} onChange={setQuery} />
              </View>
              <PressScale
                onPress={() => setSortOpen(true)}
                scaleTo={0.96}
                style={s.sortBtn}
                accessibilityRole="button"
                accessibilityLabel={`Sort by ${SORT_SHORT[settings.sort]}. Change sort order.`}
              >
                <Ionicons name="swap-vertical" size={15} color={c.textMuted} />
                <Text style={s.sortBtnText} numberOfLines={1}>
                  {SORT_SHORT[settings.sort]}
                </Text>
                <Ionicons name="chevron-down" size={14} color={c.textMuted} />
              </PressScale>
            </View>
            {/* The count row: the live total on the left, real expired/valid
                status badges on the right — every number is computed from the
                actual filtered items, never hardcoded. */}
            <View style={s.toolbar}>
              <Text style={s.metaText}>{searched.length === 1 ? '1 item' : `${searched.length} items`}</Text>
              <View style={s.badgeRow}>
                <View style={[s.countBadge, { backgroundColor: c.pills.red.bg }]}>
                  <Ionicons name="alert-circle-outline" size={12} color={c.pills.red.text} />
                  <Text style={[s.countBadgeText, { color: c.pills.red.text }]}>
                    {expired.length} expired
                  </Text>
                </View>
                <View style={[s.countBadge, { backgroundColor: c.pills.green.bg }]}>
                  <Ionicons name="checkmark-circle-outline" size={12} color={c.pills.green.text} />
                  <Text style={[s.countBadgeText, { color: c.pills.green.text }]}>{valid} valid</Text>
                </View>
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
            {/* The sort picker sheet: the same iOS-style value picker Settings
                uses, editing the same shared preference. */}
            <OptionSheet
              visible={sortOpen}
              title="Sort items"
              value={settings.sort}
              options={SORT_ORDERS.map((o) => ({ value: o, label: SORT_LABELS[o] }))}
              onChange={(v) => update({ sort: v })}
              onClose={() => setSortOpen(false)}
            />
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
      ? { shadowColor: '#16C58B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.28, shadowRadius: 10, elevation: 3 }
      : { shadowColor: '#0B3B2E', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 }),
  },
  addBtnText: { color: t.scanInk, fontSize: 15, fontWeight: '700' },

  // The Items / Shopping list segmented control (the tab's two views), in
  // the reference's language: a white rounded container, the selected side
  // filled emerald with white ink and a small pale-green count badge, the
  // inactive side quiet gray with a soft gray badge — small integrated
  // badges, never oversized bubbles.
  viewSwitch: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    backgroundColor: t === LIGHT ? t.surface : t.cardAlt,
    marginBottom: 12,
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
    // Inactive badges carry enough fill to read at a glance on the white
    // container (the old near-invisible tint is gone).
    backgroundColor: t === LIGHT ? 'rgba(130,146,159,0.22)' : 'rgba(255,255,255,0.12)',
  },
  // The selected side's badge: the reference's small pale-green chip.
  segCountOn: { backgroundColor: t === LIGHT ? '#DFF6EA' : 'rgba(4,36,27,0.30)' },
  segCountText: { color: t === LIGHT ? '#5C6B77' : '#C5D0D5', fontSize: 11.5, fontWeight: '700' },
  segCountTextOn: { color: t === LIGHT ? '#0E8A5F' : '#04241B' },
  pillRow: { gap: 8, paddingVertical: 2 },
  // Search beside the sort picker (the reference's row under the chips).
  searchSortRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, marginBottom: 12 },
  searchWrap: { flex: 1, minWidth: 0 },
  // The sort picker capsule: the same height and rounding as the search
  // field, so the row reads as one control strip.
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    backgroundColor: t === LIGHT ? t.surface : t.cardAlt,
  },
  sortBtnText: { color: t.textMuted, fontSize: 13, fontWeight: '600' },
  // The count row: the live total left, real expired/valid badges right.
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 },
  metaText: { color: t.text, fontSize: 13.5, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  countBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 10, borderRadius: 999 },
  countBadgeText: { fontSize: 12, fontWeight: '700' },
  hidden: { marginBottom: 10 },
  list: { gap: 12 },
  listCompact: { gap: 9 },
  // The waste-reduction summary card: the same wide card language as the
  // item cards, with the leaf medallion on a soft mint disc.
  waste: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: t.surface,
    borderWidth: 1,
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
