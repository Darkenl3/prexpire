import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, space, useTheme, LIGHT, type Tint } from '../theme';
import { categories, type ArtKey } from '../data';
import { useCategories } from '../categories';
import { useItems } from '../items';
import { useSettings } from '../settings';
import { expiryStatus } from '../preferences';
import { AttentionCard, CategoryTile, NAV_HEIGHT, navOffset, SectionHeader } from '../components/HomeComponents';
import { AutohideHeader, HEADER_HEIGHT, NO_RUBBER_BAND, useNavAutohide } from '../components/navAutohide';
import { TabTransition } from '../components/TabTransition';
import { ItemRow } from '../components/ItemRow';
import { AlertSpacer } from '../components/ExpiryAlert';
import { gridFor, useLayout } from '../layout';
import { AddArt, AppleArt, CapsuleArt, HouseArt, JarArt, PumpBottleArt } from '../components/Art';
import { IconArt } from '../components/IconArt';
import { SmallButton } from '../components/SettingsRows';

function categoryArt(art: ArtKey, size: number) {
  switch (art) {
    case 'apple':
      return <AppleArt size={size} />;
    case 'capsule':
      return <CapsuleArt size={size} />;
    case 'house':
      return <HouseArt size={0.95 * size} />;
    case 'pump':
      return <PumpBottleArt size={size} />;
    case 'jar':
      return <JarArt size={size} />;
    default:
      return <AddArt size={0.82 * size} />;
  }
}

// How many items "Coming up next" shows, soonest first.
const UPCOMING_COUNT = 4;

type HomeProps = {
  onNavigate?: (route: string) => void;
  // Reminders due, shown on the bell.
  badge: number;
  // A short confirmation, e.g. after an item was added from the scanner.
  notice?: string | null;
  onNoticeDone?: () => void;
};

export function HomeScreen({ onNavigate, badge, notice, onNoticeDone }: HomeProps) {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  const { items, saved } = useItems();
  const { settings, motion } = useSettings();
  const { custom, removed } = useCategories();
  const t = useTheme();
  const c = useStyles();
  const { warningDays, showExpired } = settings;
  const upcoming = useMemo(
    () =>
      items
        .filter((i) => showExpired || expiryStatus(i.expiresOn, warningDays) !== 'expired')
        .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
        .slice(0, UPCOMING_COUNT),
    [items, showExpired, warningDays],
  );
  // Expired items, and items expiring within the warning period chosen in Settings.
  const attention = useMemo(() => {
    const statuses = items.map((i) => ({ category: i.category, status: expiryStatus(i.expiresOn, warningDays) }));
    return {
      expired: statuses.filter((x) => x.status === 'expired').length,
      soon: statuses.filter((x) => x.status === 'soon').length,
      byCategory: (id: string) => statuses.filter((x) => x.category === id && x.status !== 'ok').length,
    };
  }, [items, warningDays]);

  const go = (route: string) => {
    onNavigate?.(route);
  };

  const { mode, gutter } = layout;
  const split = mode === 'split';
  const gridGap = mode === 'phone' ? space.gridGap : 12;
  const columnGap = layout.width >= 900 ? 28 : 18;

  // Width of the content area after safe-area insets, max width and gutters.
  const usable = layout.width - insets.left - insets.right;
  const bodyWidth = Math.min(usable, layout.maxContentWidth) - 2 * gutter;
  const leftWidth = split ? Math.min(Math.round((bodyWidth - columnGap) * layout.leftFraction), 560) : bodyWidth;

  // The grid is measured once laid out (split view, multitasking); the estimate covers the first frame.
  const [measuredGrid, setMeasuredGrid] = useState(0);
  const onGridLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== measuredGrid) setMeasuredGrid(w);
  };
  const gridWidth = measuredGrid || leftWidth;
  const { tileWidth } = gridFor(gridWidth, gridGap, 100);
  const compact = tileWidth < 112 || layout.short;

  // The grid in order: the built-ins the user keeps, then their own folders,
  // and the Add-category tile always last (it opens Settings' category page).
  const keptBuiltins = categories.filter((x) => x.tint !== 'add' && !removed.includes(x.id));
  const addTile = categories.find((x) => x.tint === 'add');

  // Every category the user keeps is on Home, always: a folder they add
  // appears right away (it used to land behind a "View all" once the grid
  // passed two rows, which on a phone was the very first folder).
  const catTiles = [
    ...keptBuiltins.map((t) => ({
      key: t.id,
      tint: t.tint,
      name: t.name,
      sub: `${saved.filter((i) => i.category === t.id).length} items`,
      status: tileStatus(attention.byCategory(t.id)),
      art: categoryArt(t.art, compact ? 56 : 64),
      onPress: () => go(`category:${t.id}`),
    })),
    ...custom.map((cat) => ({
      key: cat.id,
      tint: cat.tint as Tint,
      name: cat.name,
      sub: `${saved.filter((i) => i.category === cat.id).length} items`,
      status: tileStatus(attention.byCategory(cat.id)),
      // The folder's illustration, in the built-ins' style (an unknown or old
      // icon identifier shows the folder picture, never a blank).
      art: <IconArt icon={cat.icon} size={compact ? 56 : 64} />,
      onPress: () => go(`category:${cat.id}`),
    })),
  ];

  const bottomClearance = NAV_HEIGHT + navOffset(insets.bottom) + 16;

  const needAttention = attention.expired + attention.soon;
  const summary =
    needAttention > 0 ? (
      <AttentionCard
        title={needAttention === 1 ? '1 item needs attention' : `${needAttention} items need attention`}
        subtitle={[
          ...(attention.expired ? [`${attention.expired} expired`] : []),
          ...(attention.soon ? [`${attention.soon} expiring soon`] : []),
        ]}
        onPress={() => go('tab:reminders')}
      />
    ) : (
      // Nothing urgent: the same card in its calm green register, so the
      // slot always tells the user where they stand.
      <AttentionCard
        tone="green"
        title="All caught up!"
        subtitle={[items.length === 0 ? 'Nothing to watch yet' : 'Nothing needs attention']}
        onPress={() => go('tab:reminders')}
      />
    );

  const categorySection = (
    <>
      <SectionHeader title="Your categories" />
      {catTiles.length === 0 ? (
        // Every category removed and none added: a helpful empty state with
        // the action to create the first one (no placeholder tiles).
        <View style={c.empty}>
          <Text style={c.emptyTitle}>No categories yet</Text>
          <Text style={c.emptyText}>Create your first folder to organise what you track.</Text>
          <SmallButton label="Add category" icon="add-circle-outline" tone="mint" onPress={() => go('settings:categories')} />
        </View>
      ) : (
        <View style={[c.grid, { rowGap: gridGap }]} onLayout={onGridLayout}>
          {catTiles.map((tile) => (
            <CategoryTile
              key={tile.key}
              tint={tile.tint}
              width={tileWidth}
              name={tile.name}
              sub={tile.sub}
              status={tile.status}
              art={tile.art}
              compact={compact}
              onPress={tile.onPress}
            />
          ))}
          {/* Add category is always the last tile in the order. */}
          {addTile && (
            <CategoryTile
              key={addTile.id}
              tint={addTile.tint}
              width={tileWidth}
              name={addTile.name}
              art={categoryArt(addTile.art, compact ? 56 : 64)}
              compact={compact}
              onPress={() => go('settings:categories')}
            />
          )}
        </View>
      )}
    </>
  );

  const upcomingSection = (first: boolean) => (
    <>
      <SectionHeader title="Coming up next" action="View all" onAction={() => go('tab:items')} first={first} />
      <View style={[c.list, settings.compact && c.listCompact]}>
        {upcoming.map((item) => (
          <ItemRow key={item.id} item={item} onPress={() => go('tab:items')} />
        ))}
        {upcoming.length === 0 && (
          <View style={c.empty}>
            <Text style={c.emptyTitle}>Nothing here yet</Text>
            <Text style={c.emptyText}>Scan a label or add a product by hand to start tracking it.</Text>
            <View style={c.emptyButtons}>
              <SmallButton label="Scan a label" icon="scan-outline" tone="mint" onPress={() => go('scan')} />
              <SmallButton label="Add manually" icon="create-outline" onPress={() => go('manual')} />
            </View>
          </View>
        )}
      </View>
    </>
  );

  const frame = { maxWidth: layout.maxContentWidth, paddingHorizontal: gutter };
  // YouTube-style: ONLY the header hides while scrolling down (the bottom
  // navigation is permanent).
  const { hidden, onScroll } = useNavAutohide();

  return (
    <View style={[c.root, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      {/* The tab-switch transition wraps the header AND the scrolling body:
          Home's title IS the wordmark, so the header and the content enter as
          ONE screen - the same unified fade Settings has always had. The
          header still overlays the content (see navAutohide.tsx): hiding it
          never resizes the scroller, so the content never jumps and the
          scroll direction never oscillates while it slides. */}
      <TabTransition tab="home">
        <AutohideHeader hidden={hidden} badge={badge} gutter={gutter} maxWidth={layout.maxContentWidth} onMenu={() => go('tab:settings')} onBell={() => go('tab:reminders')} />
        <ScrollView
          style={[c.scroll, NO_RUBBER_BAND]}
          onScroll={onScroll}
          contentContainerStyle={[c.scrollContent, { paddingTop: HEADER_HEIGHT, paddingBottom: bottomClearance }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[c.frame, frame]}>
            <AlertSpacer />
            {split ? (
              <View style={[c.columns, { columnGap }]}>
                <View style={{ width: leftWidth }}>
                  {summary}
                  {categorySection}
                </View>
                <View style={c.rightColumn}>{upcomingSection(true)}</View>
              </View>
            ) : (
              <>
                {summary}
                {categorySection}
                {upcomingSection(false)}
              </>
            )}
          </View>
        </ScrollView>
      </TabTransition>
      {notice && <Toast key={notice} text={notice} bottom={bottomClearance} motion={motion} onDone={onNoticeDone} />}
    </View>
  );
}

function tileStatus(n: number) {
  return n > 0 ? { label: `${n} expiring`, tone: 'amber' as const } : { label: 'All good', tone: 'green' as const };
}

function Toast({ text, bottom, motion, onDone }: { text: string; bottom: number; motion: boolean; onDone?: () => void }) {
  const t = useTheme();
  const c = useStyles();
  const opacity = useRef(new Animated.Value(motion ? 0 : 1)).current;
  useEffect(() => {
    // With animations off the toast appears and disappears without fading.
    const fade = motion ? 200 : 0;
    const anim = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: fade, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(opacity, { toValue: 0, duration: fade, useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => finished && onDone?.());
    return () => anim.stop();
  }, [opacity, motion, onDone]);
  return (
    <Animated.View pointerEvents="none" style={[c.toastWrap, { bottom, opacity }]} accessibilityLiveRegion="polite">
      <View style={[c.toast, { backgroundColor: t.toastBg, borderColor: t.toastBorder }]}>
        <Ionicons name="checkmark-circle" size={18} color={t.mint} />
        <Text style={[c.toastText, { color: t.toastInk }]} numberOfLines={2}>
          {text}
        </Text>
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  frame: { width: '100%', alignSelf: 'center' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  rightColumn: { flex: 1, minWidth: 0 },
  // space-between absorbs the rounding left over from whole-pixel tile widths.
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  // 8px between "Coming up next" rows.
  list: { gap: 8 },
  listCompact: { gap: 6 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 26 },
  emptyTitle: { color: t.text, fontSize: 16.5, fontWeight: '600' },
  emptyText: { color: t.textMuted, fontSize: 14, marginBottom: 6, textAlign: 'center' },
  // Empty-state action pairs (scan + manual entry).
  emptyButtons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  toastWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 460,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1,
  },
  toastText: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
}));
