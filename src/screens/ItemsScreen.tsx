import { useCallback, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, useTheme, LIGHT } from '../theme';
import { useCategories } from '../categories';
import { useItems, type CategoryId } from '../items';
import { useSettings } from '../settings';
import { expiryStatus, SORT_LABELS, SORT_ORDERS, sortItems, type SortOrder } from '../preferences';
import { Page } from '../components/Page';
import { ItemCard, categoryIcon } from '../components/ItemCard';
import { Note, SmallButton } from '../components/SettingsRows';
import { SearchField } from '../components/SearchField';
import { FadeIn, PressScale } from '../components/Press';
import { BottomSheet } from '../components/BottomSheet';
import { ShoppingListBody, ShoppingToast } from './ShoppingScreen';

type Props = { badge: number; category?: CategoryId; shopping?: boolean; onNavigate: (route: string) => void };

// Labels for the sort picker, in the reference's dropdown wording; the Settings
// page spells the same values out in full, and both always agree because they
// edit the same preference.
const SORT_SHORT: Record<SortOrder, string> = { expiry: 'Expiry date', added: 'Recent', name: 'A–Z' };

// The Lists tab, simplified to the reference: the title block with the lime
// "Add item" capsule, the compact Items / Shopping list switcher, then ONE
// row — the search field beside a small Filter button that opens the category
// and sort choices in a sheet (no permanent chip row), the quiet count line
// ("4 items · 0 expired · 4 valid"), and the product cards as the screen's
// focus. Everything reads the same real data as before — no sample products,
// no new dependencies, and every list behaviour (search, category filtering,
// sorting, item management) unchanged.
export function ItemsScreen({ badge, category, shopping, onNavigate }: Props) {
  const { items } = useItems();
  const { settings, update } = useSettings();
  const { all, custom } = useCategories();
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
  // The filter sheet: the categories AND the sort order live together behind
  // the small Filter button, so the screen itself carries no second control
  // row — the reference's "Search items… | Filter" strip.
  const [filterOpen, setFilterOpen] = useState(false);

  const needle = query.trim().toLowerCase();
  const inCategory = useMemo(() => (filter === 'all' ? items : items.filter((i) => i.category === filter)), [items, filter]);
  const searched = useMemo(() => (needle ? inCategory.filter((i) => i.name.toLowerCase().includes(needle)) : inCategory), [inCategory, needle]);
  const expired = searched.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) === 'expired');
  const shown = useMemo(
    () => sortItems(settings.showExpired ? searched : searched.filter((i) => expiryStatus(i.expiresOn, settings.warningDays) !== 'expired'), settings.sort),
    [searched, settings.showExpired, settings.sort, settings.warningDays],
  );
  // The count line's valid half, computed from the real filtered items.
  const valid = searched.length - expired.length;

  // Arriving from a Home category tile: the tile's category is the filter, and
  // the Filter button says its name until it is changed or cleared.
  const filterLabel = filter === 'all' ? null : (all.find((cat) => cat.id === filter)?.name ?? null);

  // The prominent lime action capsule beside the title: on the Items view it
  // opens the manual add flow; on the Shopping List view it opens the list's
  // own add dialog (the same one its section header's action opens).
  const headerAction = (
    <PressScale
      onPress={() => (shopping ? setShopAddOpen(true) : onNavigate('manual'))}
      scaleTo={0.96}
      style={s.addBtn}
      pressedStyle={s.addBtnPressed}
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
        tab="items"
        title={shopping ? 'Shopping List' : 'Items'}
        subtitle={shopping ? 'What you need to buy next.' : "Everything you're tracking."}
        badge={badge}
        maxWidth={shopping ? 640 : undefined}
        dense
        headerAction={headerAction}
        onNavigate={onNavigate}
      >
        {/* The Lists tab's two views, as one compact segmented control: what is
            EXPIRING (Items) is always visually separated from what is TO BUY
            (Shopping list) — icon and label only, no counters. Tapping either
            navigates (tab:items / tab:shop), so the address bar, the back
            button and the shell's glass bar all follow the switch like any
            other route. */}
        <View style={s.viewSwitch} accessibilityRole="radiogroup" aria-label="Lists view">
          <PressScale
            onPress={() => onNavigate('tab:items')}
            scaleTo={0.98}
            style={[s.seg, !shopping && s.segOn]}
            accessibilityRole="radio"
            aria-checked={!shopping}
            accessibilityLabel="Tracked items"
          >
            <Ionicons name="list" size={16} color={!shopping ? c.scanInk : c.textMuted} />
            <Text style={[s.segText, !shopping && s.segTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              Items
            </Text>
          </PressScale>
          <PressScale
            onPress={() => onNavigate('tab:shop')}
            scaleTo={0.98}
            style={[s.seg, !!shopping && s.segOn]}
            accessibilityRole="radio"
            aria-checked={!!shopping}
            accessibilityLabel="Shopping list"
          >
            <Ionicons name="cart-outline" size={16} color={shopping ? c.scanInk : c.textMuted} />
            <Text style={[s.segText, shopping && s.segTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              Shopping list
            </Text>
          </PressScale>
        </View>
        {shopping ? (
          <ShoppingListBody addOpen={shopAddOpen} setAddOpen={setShopAddOpen} onToast={setShopToast} />
        ) : (
          <>
            {/* The reference's one control row: the search field as the main
                control, the small Filter button beside it. The button opens the
                sheet below (categories + sort); while a category filter is
                active it wears the accent and says the category's name, so the
                current filter is always visible on the screen itself. */}
            <View style={s.searchRow}>
              <View style={s.searchWrap}>
                <SearchField value={query} onChange={setQuery} />
              </View>
              <PressScale
                onPress={() => setFilterOpen(true)}
                scaleTo={0.96}
                style={[s.filterBtn, !!filterLabel && s.filterBtnOn]}
                accessibilityRole="button"
                accessibilityLabel={`Filter and sort. Category: ${filterLabel ?? 'all'}. Sort by ${SORT_SHORT[settings.sort]}.`}
              >
                <Ionicons name="funnel" size={15} color={filterLabel ? c.green : c.textMuted} />
                <Text style={[s.filterBtnText, !!filterLabel && s.filterBtnTextOn]} numberOfLines={1}>
                  {filterLabel ?? 'Filter'}
                </Text>
              </PressScale>
            </View>
            {/* The quiet count line: the live total on the left (with the
                active category when one is set), the expired/valid split on the
                right as plain coloured text — no badge containers, no cards,
                every number computed from the real filtered items. */}
            <View style={s.countRow}>
              <Text style={s.countText} numberOfLines={1}>
                {searched.length === 1 ? '1 item' : `${searched.length} items`}
                {filterLabel ? ` · ${filterLabel}` : ''}
              </Text>
              <Text style={s.countSplit} numberOfLines={1}>
                <Text style={{ color: expired.length ? c.red : c.textMuted }}>{expired.length} expired</Text>
                <Text style={{ color: c.textMuted }}> · </Text>
                <Text style={{ color: c.green }}>{valid} valid</Text>
              </Text>
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
      {/* The filter sheet: the category list (with "All categories" clearing
          the filter) and the sort order, in the app's own bottom-sheet
          language. Only ever on screen while the user asked for it. */}
      {!shopping && (
        <FilterSheet
          visible={filterOpen}
          filter={filter}
          sort={settings.sort}
          categories={all.map((cat) => ({ id: cat.id as CategoryId, name: cat.name, icon: categoryIcon(cat.id, custom.find((x) => x.id === cat.id)?.icon) }))}
          onFilter={(f) => setFilter(f)}
          onSort={(o) => update({ sort: o })}
          onClose={() => setFilterOpen(false)}
        />
      )}
      {shopToast && <ShoppingToast key={shopToast} text={shopToast} onDone={() => setShopToast(null)} />}
    </>
  );
}

// The filter sheet: one bottom sheet in the app's shared picker language,
// carrying the category choices (All categories clears the filter) and the
// sort order. Selecting any option applies it and closes — exactly how every
// other sheet in the app behaves — and the Cancel row simply dismisses.
// The frame itself (safe areas, navigation clearance, max height, scrolling,
// swipe-down-to-close, the rise/settle animation) is the shared BottomSheet.
function FilterSheet({
  visible,
  filter,
  sort,
  categories,
  onFilter,
  onSort,
  onClose,
}: {
  visible: boolean;
  filter: 'all' | CategoryId;
  sort: SortOrder;
  categories: { id: CategoryId; name: string; icon: keyof typeof Ionicons.glyphMap }[];
  onFilter: (f: 'all' | CategoryId) => void;
  onSort: (o: SortOrder) => void;
  onClose: () => void;
}) {
  const c = useTheme();
  const s = useSheetStyles();
  const close = useCallback(() => onClose(), [onClose]);

  const categoryRow = (value: 'all' | CategoryId, label: string, icon?: keyof typeof Ionicons.glyphMap) => {
    const on = filter === value;
    return (
      <PressScale
        key={value}
        onPress={() => {
          onFilter(value);
          close();
        }}
        accessibilityRole="radio"
        aria-checked={on}
        accessibilityLabel={label}
        style={[s.option, on && s.optionOn]}
        pressedStyle={s.optionPressed}
      >
        {icon ? (
          <Ionicons name={icon} size={17} color={on ? c.green : c.textMuted} />
        ) : (
          <View style={s.optionIconBlank} />
        )}
        <Text style={[s.optionText, on && s.optionTextOn]} numberOfLines={1}>
          {label}
        </Text>
        {on && (
          <FadeIn>
            <Ionicons name="checkmark" size={18} color={c.green} />
          </FadeIn>
        )}
      </PressScale>
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filter & sort" accessibilityLabel="Filter and sort" footer={
      <PressScale onPress={close} accessibilityRole="button" accessibilityLabel="Cancel" style={s.cancel} pressedStyle={s.optionPressed}>
        <Text style={s.cancelText}>Cancel</Text>
      </PressScale>
    }>
      <View>
        <Text style={s.section}>Category</Text>
        <View style={s.options} accessibilityRole="radiogroup" accessibilityLabel="Category">
          {categoryRow('all', 'All categories')}
          {categories.map((cat) => categoryRow(cat.id, cat.name, cat.icon))}
        </View>
      </View>
      <View>
        <Text style={s.section}>Sort by</Text>
        <View style={s.options} accessibilityRole="radiogroup" accessibilityLabel="Sort order">
          {SORT_ORDERS.map((o) => {
            const on = sort === o;
            return (
              <PressScale
                key={o}
                onPress={() => {
                  onSort(o);
                  close();
                }}
                accessibilityRole="radio"
                aria-checked={on}
                accessibilityLabel={SORT_LABELS[o]}
                style={[s.option, on && s.optionOn]}
                pressedStyle={s.optionPressed}
              >
                <Ionicons name={o === 'expiry' ? 'calendar-outline' : o === 'added' ? 'time-outline' : 'text-outline'} size={17} color={on ? c.green : c.textMuted} />
                <Text style={[s.optionText, on && s.optionTextOn]} numberOfLines={1}>
                  {SORT_LABELS[o]}
                </Text>
                {on && (
                  <FadeIn>
                    <Ionicons name="checkmark" size={18} color={c.green} />
                  </FadeIn>
                )}
              </PressScale>
            );
          })}
        </View>
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((t) => ({
  // The prominent lime action capsule beside the title (the reference's
  // "＋ Add item"): the solid primary green with deep ink, flat and clean —
  // no glow, no shadow — and the pressed register (a hair deeper green)
  // while touched.
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 18, borderRadius: 999, backgroundColor: t.mint },
  addBtnPressed: { backgroundColor: t.mintPressed },
  addBtnText: { color: t.scanInk, fontSize: 15, fontWeight: '700' },

  // The Items / Shopping list segmented control (the tab's two views), in
  // the reference's language: a compact rounded capsule (white on light, the
  // unselected control surface on dark), the selected side filled with the
  // selected-tab green and deep ink, the inactive side quiet gray — icon and
  // label only, no count badges.
  viewSwitch: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    backgroundColor: t === LIGHT ? t.surface : t.cardAlt,
    marginBottom: 10,
  },
  // Compact internal spacing: icon and label stay vertically centred with a
  // tight gap; 40pt keeps the control quiet while the touch target stays real
  // (the row has generous margin around it).
  seg: { flex: 1, height: 40, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 6 },
  segOn: { backgroundColor: t.selBg },
  segText: { color: t.textMuted, fontSize: 14, fontWeight: '600' },
  segTextOn: { color: t.scanInk, fontWeight: '700' },
  // The reference's one control row: the search field is the main control
  // (flex), the Filter button a smaller secondary capsule beside it.
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  searchWrap: { flex: 1, minWidth: 0 },
  // The Filter button: the search field's own height and rounding so the row
  // reads as one strip, but clearly the quiet partner — muted funnel + label.
  // While a category filter is active it wears the accent (green funnel and
  // text, the green hairline) and says the category's name, so the active
  // filter is always visible on the screen itself.
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    backgroundColor: t === LIGHT ? t.surface : t.cardAlt,
    maxWidth: 150,
    minWidth: 96,
  },
  filterBtnOn: { borderColor: t.chipOnBorder },
  filterBtnText: { color: t.textMuted, fontSize: 13, fontWeight: '600' },
  filterBtnTextOn: { color: t.green },
  // The quiet count line: plain text on the page background, never badges or
  // containers — the total (with the active category) left, the expired /
  // valid split right in the status colours.
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 },
  countText: { color: t.text, fontSize: 13.5, fontWeight: '700' },
  countSplit: { fontSize: 13, fontWeight: '600' },
  hidden: { marginBottom: 10 },
  list: { gap: 12 },
  listCompact: { gap: 9 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  emptyTitle: { color: t.text, fontSize: 17, fontWeight: '600' },
  emptyText: { color: t.textMuted, fontSize: 14, marginBottom: 6 },
  // Empty-state action pairs (scan + manual entry).
  emptyButtons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
}));

// The filter sheet's own styles, in the app's shared bottom-sheet language
// (the same metrics as the Settings pickers, plus a section label).
const useSheetStyles = makeStyles((c) => ({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(3,7,9,0.5)' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    paddingTop: 6,
    paddingHorizontal: 14,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, backgroundColor: c.separator, alignSelf: 'center', marginTop: 6 },
  title: { color: c.textMuted, fontSize: 15, fontWeight: '600', textAlign: 'center', paddingVertical: 12 },
  section: { color: c.textSub, fontSize: 12.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 16, marginTop: 8, marginBottom: 4 },
  options: { borderRadius: 14, overflow: 'hidden', backgroundColor: c === LIGHT ? c.cardAlt : 'rgba(255,255,255,0.02)' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 16 },
  optionOn: { backgroundColor: c.pills.green.bg },
  optionPressed: { opacity: 0.7 },
  // The "All categories" row has no icon; this blank keeps its label aligned
  // with the iconed rows above it.
  optionIconBlank: { width: 17, height: 17 },
  optionText: { color: c.text, fontSize: 15.5, fontWeight: '500', flex: 1 },
  optionTextOn: { color: c.green, fontWeight: '600' },
  cancel: { borderRadius: 14, minHeight: 52, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  cancelText: { color: c.textMuted, fontSize: 16, fontWeight: '600' },
}));
