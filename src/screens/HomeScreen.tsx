import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, space, useTheme, LIGHT, type Tint } from '../theme';
import { categories, type ArtKey } from '../data';
import { presetIcon, useCategories } from '../categories';
import { useItems } from '../items';
import { useSettings } from '../settings';
import { expiryStatus } from '../preferences';
import { AddActions, AttentionCard, CategoryTile, NAV_HEIGHT, navOffset, SectionHeader } from '../components/HomeComponents';
import { AutohideHeader, HEADER_HEIGHT, NO_RUBBER_BAND, useNavAutohide } from '../components/navAutohide';
import { TabTransition } from '../components/TabTransition';
import { ItemRow } from '../components/ItemRow';
import { AlertSpacer } from '../components/ExpiryAlert';
import { gridFor, useLayout } from '../layout';
import { AddArt, AppleArt, CapsuleArt, HouseArt, JarArt, PumpBottleArt } from '../components/Art';
import { IconArt } from '../components/IconArt';
import { SmallButton } from '../components/SettingsRows';
import { FadeIn, PressScale } from '../components/Press';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../auth';
import { SignInSheet } from '../components/SignInSheet';

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

// How many rows of category tiles Home shows before collapsing: on a phone
// that is a 3-column, 2-row grid (the last slot of the second row is reserved
// for the Add-category tile). Beyond it, the folders wait behind the
// "View all" action beside the section heading.
const COLLAPSED_ROWS = 2;

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
  const { settings, motion, warning } = useSettings();
  const { all, custom, lookOf } = useCategories();
  const t = useTheme();
  const c = useStyles();
  const { showExpired } = settings;
  // Tall screens (iPad, either way up) have room for more of the list.
  // More rows on taller screens: a 13" iPad (1376 pt) has room for 12.
  const upcomingCount = layout.height >= 1300 ? 12 : layout.height >= 1000 ? 8 : layout.mode === 'split' && layout.height >= 740 ? 6 : UPCOMING_COUNT;
  const upcoming = useMemo(
    () =>
      items
        .filter((i) => showExpired || expiryStatus(i.expiresOn, warning(i.category)) !== 'expired')
        .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
        .slice(0, upcomingCount),
    [items, showExpired, warning, upcomingCount],
  );
  // Expired items, and items expiring within the warning period chosen in Settings.
  const attention = useMemo(() => {
    const statuses = items.map((i) => ({ category: i.category, status: expiryStatus(i.expiresOn, warning(i.category)) }));
    return {
      expired: statuses.filter((x) => x.status === 'expired').length,
      soon: statuses.filter((x) => x.status === 'soon').length,
      byCategory: (id: string) => statuses.filter((x) => x.category === id && x.status !== 'ok').length,
    };
  }, [items, warning]);

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
  const { columns, tileWidth } = gridFor(gridWidth, gridGap, 100);
  const compact = tileWidth < 112 || layout.short;

  // The grid in the user's order (Settings > Categories), built-ins and their
  // own folders alike, and the Add-category tile always last (it opens
  // Settings' category page).
  const addTile = categories.find((x) => x.tint === 'add');

  // A long grid collapses to two full rows; the folders beyond them wait
  // behind the "View all" action in the section heading. Add always stays
  // visible (its slot is reserved), so it is reachable and last whatever the
  // user's folder count. Expanding never reorders or duplicates anything -
  // the same array is simply shown in full.
  const [gridExpanded, setGridExpanded] = useState(false);
  const catTiles = all.flatMap((cat) => {
    const builtin = categories.find((x) => x.id === cat.id && x.tint !== 'add');
    const folder = custom.find((x) => x.id === cat.id);
    if (!builtin && !folder) return [];
    return [
      {
        key: cat.id,
        tint: (builtin ? (lookOf(cat.id).tint ?? builtin.tint) : folder!.tint) as Tint,
        name: cat.name,
        sub: ((n) => (n === 1 ? '1 item' : `${n} items`))(saved.filter((i) => i.category === cat.id).length),
        status: tileStatus(attention.byCategory(cat.id)),
        // A folder's illustration is in the built-ins' style (an unknown or
        // old icon identifier shows the folder picture, never a blank).
        art: builtin
          ? <IconArt icon={lookOf(cat.id).icon ?? presetIcon(cat.id) ?? 'folder-outline'} size={compact ? 56 : 64} />
          : <IconArt icon={folder!.icon} size={compact ? 56 : 64} />,
        onPress: () => go(`category:${cat.id}`),
      },
    ];
  });
  // When collapsed, the last visible category slot is reserved for Add, so
  // the collapsed grid is always exactly COLLAPSED_ROWS full rows.
  const cap = columns * COLLAPSED_ROWS;
  const overflow = catTiles.length + 1 > cap;
  const shownCats = gridExpanded || !overflow ? catTiles : catTiles.slice(0, cap - 1);

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
        subtitle={[items.length === 0 ? 'Nothing to watch yet' : `Nothing needs attention  •  ${items.length} tracked`]}
        onPress={() => go('tab:reminders')}
      />
    );

  const categorySection = (
    <>
      {/* The expansion control lives in the heading itself: "View all" only
          appears when there are actually more categories than the collapsed
          grid shows, and becomes "Show less" once expanded. With few enough
          categories there is no control at all. */}
      <SectionHeader
        title="Your categories"
        action={overflow ? (gridExpanded ? 'Show less' : 'View all') : undefined}
        actionLabel={overflow ? (gridExpanded ? 'Show fewer categories' : `Show all ${catTiles.length} categories`) : undefined}
        onAction={
          overflow
            ? () => {
                setGridExpanded((e) => !e);
              }
            : undefined
        }
      />
      {catTiles.length === 0 ? (
        // Every category removed and none added: a helpful empty state with
        // the action to create the first one (no placeholder tiles).
        <View style={c.empty}>
          <Text style={c.emptyTitle}>No categories yet</Text>
          <Text style={c.emptyText}>Create your first folder to organise what you track.</Text>
          <SmallButton label="Add category" icon="add-circle-outline" tone="mint" onPress={() => go('settings:categories')} />
        </View>
      ) : (
        <View style={[c.grid, { rowGap: gridGap, columnGap: gridGap }]} onLayout={onGridLayout}>
          {shownCats.map((tile, i) => {
            const el = (
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
            );
            // Tiles revealed by expanding fade in gently; the always-visible
            // ones (and a grid that never overflows) render as before.
            return overflow && gridExpanded && i >= cap - 1 ? <FadeIn key={tile.key}>{el}</FadeIn> : el;
          })}
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
            <AddActions onScan={() => go('scan')} onManual={() => go('manual')} />
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
                  <BackupCard count={items.length} />
                  {categorySection}
                </View>
                <View style={c.rightColumn}>{upcomingSection(true)}</View>
              </View>
            ) : (
              <>
                {summary}
                <BackupCard count={items.length} />
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

// Once there's something worth keeping (BACKUP_AT items) and no account,
// one quiet card: the items live only on this phone. Tap to create a free
// account; the cross hides it for good.
const BACKUP_AT = 10;
const BACKUP_DISMISSED_KEY = 'prexpire.backupNudge.v1';

function BackupCard({ count }: { count: number }) {
  const t = useTheme();
  const c = useStyles();
  const { session } = useAuth();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(BACKUP_DISMISSED_KEY)
      .then((v) => setDismissed(v === '1'))
      .catch(() => setDismissed(false));
  }, []);
  const show = !session && dismissed === false && count >= BACKUP_AT;
  const hide = () => {
    setDismissed(true);
    AsyncStorage.setItem(BACKUP_DISMISSED_KEY, '1').catch(() => {});
  };
  return (
    <>
      {show ? (
        <FadeIn>
          <PressScale onPress={() => setOpen(true)} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={`Back up your ${count} items`} style={c.backup}>
            <View style={c.backupIcon}>
              <Ionicons name="cloud-upload-outline" size={20} color={t.mint} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={c.backupTitle}>Back up your {count} items</Text>
              <Text style={c.backupSub}>They're only on this phone. A free account keeps them safe.</Text>
            </View>
            <PressScale onPress={hide} scaleTo={0.9} accessibilityRole="button" accessibilityLabel="Hide this" hitSlop={10} style={c.backupClose}>
              <Ionicons name="close" size={16} color={t.textMuted} />
            </PressScale>
          </PressScale>
        </FadeIn>
      ) : null}
      <SignInSheet
        visible={open && !session}
        onClose={() => setOpen(false)}
        onSignedIn={() => setOpen(false)}
        initialMode="signup"
        intro={{ title: 'Keep your items safe', text: `Your ${count} items live only on this phone. Create a free account and a lost, broken or new phone never loses them.` }}
      />
    </>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg },
  backup: {
    marginTop: 10,
    minHeight: 58,
    paddingVertical: 9,
    paddingLeft: 9,
    paddingRight: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    backgroundColor: t.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backupIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: t.btnMintBg, borderWidth: 1, borderColor: t.btnMintBorder },
  backupTitle: { color: t.text, fontSize: 15.5, fontWeight: '700' },
  backupSub: { color: t.textBody, fontSize: 13, lineHeight: 18, marginTop: 2 },
  backupClose: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '100%', alignSelf: 'center' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  rightColumn: { flex: 1, minWidth: 0 },
  // A fixed gap between tiles, from the left: a last row that isn't full
  // (Skincare, Household, Add category) stays together instead of being
  // spread across the width. Whole-pixel tile widths leave at most a few
  // pixels at the right edge.
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
  // 8px between "Coming up next" rows.
  list: { gap: 8 },
  listCompact: { gap: 6 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 26 },
  emptyTitle: { color: t.text, fontSize: 16.5, fontWeight: '600' },
  emptyText: { color: t.textBody, fontSize: 14, marginBottom: 6, textAlign: 'center' },
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
