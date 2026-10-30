import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { makeStyles, useTheme, LIGHT, CARD_SHADOW, CARD_SHADOW_DARK, CARD_SHADOW_LIFTED, type Tint, type Tone } from '../theme';
import { useCategories } from '../categories';
import { useItems, type Item } from '../items';
import { expiryStatus } from '../preferences';
import { useSettings } from '../settings';
import { useShopping } from '../shopping';
import { daysUntil } from '../scanner/dateParser';
import { categoryArt } from './ResultSheet';
import { FadeIn, PressScale } from './Press';
import { SmallButton } from './SettingsRows';

// The redesigned item card for the Lists tab (the reference's compact card): a
// rounded pale-green art square carrying the category's art on the left, the
// name / category / expiry-date meta rows and the thin expiry progress bar in
// the middle, and the three-dot action menu on the right. The name stays on one
// line (ellipsized when needed) so every card keeps exactly the same height,
// and the progress bar shares its row with the days-left pill: the bar takes
// the width left of the pill, both vertically centred. Every value is real data
// (the item's own fields); nothing is sampled or invented.

// The built-ins' chip/row glyphs (custom categories carry their own icon).
// Food reads as cutlery in these small text rows; its tile art stays the apple.
const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  food: 'restaurant-outline',
  medicine: 'medkit-outline',
  household: 'home-outline',
  skincare: 'water-outline',
  pantry: 'basket-outline',
};
export const categoryIcon = (id: string, customIcon?: string): keyof typeof Ionicons.glyphMap =>
  (CATEGORY_ICONS[id] ?? (customIcon as keyof typeof Ionicons.glyphMap | undefined) ?? 'cube-outline');

// The built-ins map onto their own tile gradient; custom folders know theirs;
// anything else (a deleted folder's items) reads as the neutral slate.
const BUILTIN_TINTS: Record<string, Tint> = {
  food: 'food',
  medicine: 'medicine',
  household: 'household',
  skincare: 'skincare',
  pantry: 'pantry',
};
// Shared with the Reminders screen's cards, so a reminder card's art square
// always matches the item card the same product shows on the Lists tab.
export const categoryTint = (id: string, customTint?: Tint): Tint => customTint ?? BUILTIN_TINTS[id] ?? 'slate';

type Props = {
  item: Item;
  // The Settings "compact rows" preference: a smaller art square and tighter
  // paddings, so several cards still fit an iPhone screen.
  compact?: boolean;
  // Action feedback rides the screen's hoisted toast (same channel as the
  // Shopping List's toasts).
  onToast: (text: string) => void;
};

export function ItemCard({ item, compact = false, onToast }: Props) {
  const t = useTheme();
  const s = useStyles();
  const { settings, formatDate } = useSettings();
  const { nameOf, custom } = useCategories();
  const { removeItem } = useItems();
  const { addManual } = useShopping();
  const [menuOpen, setMenuOpen] = useState(false);
  // Removing asks twice, exactly like the app's other destructive actions
  // (clearing purchased items, deleting a category folder).
  const [confirmRemove, setConfirmRemove] = useState(false);

  const status = expiryStatus(item.expiresOn, settings.warningDays);
  const days = daysUntil(item.expiresOn, new Date());
  const tone: Tone = status === 'expired' ? 'red' : status === 'soon' ? 'amber' : 'green';
  const pill = status === 'expired' ? 'Expired' : days === 0 ? 'Today' : days === 1 ? '1 day left' : `${days} days left`;

  // The progress bar: how much of the item's TRACKED window remains — from the
  // day it was added to its expiry date. A product added yesterday with 60 days
  // left sits near full; the same product weeks later has visibly run down; an
  // expired one is empty. (Scanned and manual items alike always carry addedAt.)
  const total = daysUntil(item.expiresOn, new Date(item.addedAt));
  const progress = total > 0 ? Math.min(Math.max(days / total, 0), 1) : days > 0 ? 1 : 0;

  const known = custom.find((cat) => cat.id === item.category);
  const icon = categoryIcon(item.category, known?.icon);

  const closeMenu = () => {
    setMenuOpen(false);
    setConfirmRemove(false);
  };
  const openMenu = () => {
    setConfirmRemove(false);
    setMenuOpen(true);
    Haptics.selectionAsync().catch(() => {});
  };

  const addToShoppingList = async () => {
    const result = await addManual({ name: item.name, category: item.category, quantity: 1 });
    closeMenu();
    onToast(result.ok ? `${result.item.name} added to your list` : 'That is already on your list');
  };

  const removePressed = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      Haptics.selectionAsync().catch(() => {});
      return;
    }
    closeMenu();
    await removeItem(item.id);
    onToast(`${item.name} removed`);
  };

  return (
    <View style={[s.card, compact && s.cardCompact, ...(t === LIGHT ? [CARD_SHADOW] : [CARD_SHADOW_DARK])]}>
      {/* Left: the product's art in a rounded pale-green square — the image
          slot of the reference card, carrying real category data. */}
      <View style={[s.thumb, compact && s.thumbCompact]}>
        {categoryArt(item.category, compact ? 26 : 32)}
      </View>
      {/* Middle: name, category and expiry date, then the expiry progress bar
          on the same row as the days-left pill. The name stays on ONE line and
          ellipsizes (`Dolce Gusto Espresso Roma…`) so long products can never
          push the date, the bar, the pill or the menu out of position — every
          card keeps the same height, on every screen width. */}
      <View style={s.body}>
        <Text style={[s.name, compact && s.nameCompact]} numberOfLines={1} ellipsizeMode="tail">
          {item.name}
        </Text>
        <View style={s.metaRow}>
          <Ionicons name={icon} size={13.5} color={t.textSub} />
          <Text style={s.metaText} numberOfLines={1}>
            {nameOf(item.category)}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Ionicons name="calendar-outline" size={13.5} color={t.textSub} />
          <Text style={s.metaText} numberOfLines={1}>
            {formatDate(item.expiresOn, item.datePrecision)}
          </Text>
        </View>
        {/* The expiry progress row: the thin mint bar fills the width left of
            the days pill, both vertically centred with a small consistent gap —
            never a separate full-width row under the pill. */}
        <View
          style={s.progressRow}
          accessibilityRole="progressbar"
          accessibilityLabel={`${Math.round(progress * 100)} percent of its tracked time left`}
        >
          <View style={s.barTrack}>
            <View style={[s.barFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          <View style={[s.pill, compact && s.pillCompact, { backgroundColor: t.pills[tone].bg }]}>
            <Text
              style={[s.pillText, compact && s.pillTextCompact, { color: t.pills[tone].text }]}
              numberOfLines={1}
              minimumFontScale={0.7}
              adjustsFontSizeToFit
            >
              {pill}
            </Text>
          </View>
        </View>
      </View>
      {/* Right: the three-dot action menu, vertically centred on the card. */}
      <PressScale
        onPress={openMenu}
        hitSlop={8}
        scaleTo={0.88}
        style={s.dots}
        accessibilityRole="button"
        accessibilityLabel={`Actions for ${item.name}`}
      >
        <Ionicons name="ellipsis-vertical" size={17} color={t.textMuted} />
      </PressScale>

      {/* The actions menu: a compact centered dialog (the app's own dialog
          language — see the Shopping List's add dialog), so it works on every
          screen size with no positioning math and stays fully accessible. */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
        <View style={s.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu} accessibilityLabel="Close" importantForAccessibility="no" />
          <FadeIn>
            <View
              style={[s.menu, { backgroundColor: t.dialogBg, borderColor: t.surfaceBorder }]}
              accessibilityRole={'dialog' as never}
              accessibilityLabel={`Actions for ${item.name}`}
              {...({ 'aria-modal': true } as object)}
            >
              <Text style={s.menuName} numberOfLines={2}>
                {item.name}
              </Text>
              <PressScale onPress={() => void addToShoppingList()} style={s.menuRow} accessibilityRole="button" accessibilityLabel={`Add ${item.name} to your Shopping List`}>
                <Ionicons name="cart-outline" size={19} color={t.green} />
                <Text style={[s.menuRowText, { color: t.text }]}>Add to Shopping List</Text>
              </PressScale>
              <PressScale onPress={() => void removePressed()} style={s.menuRow} accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`}>
                <Ionicons name="trash-outline" size={19} color={t.red} />
                <Text style={[s.menuRowText, { color: t.red }]}>{confirmRemove ? 'Tap again to remove' : 'Remove item'}</Text>
              </PressScale>
              <View style={s.menuClose}>
                <SmallButton label="Close" onPress={closeMenu} />
              </View>
            </View>
          </FadeIn>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // The compact product card (the reference's layout): a rounded pale-green
  // art square on the left, the name / category / expiry-date meta rows and
  // the progress row in the middle, the three-dot menu on the right. White
  // with a fine hairline on the light page, the dark theme's translucent glass
  // — every value is real data (the item's own fields). The name is one line
  // (ellipsized), so EVERY card is the same height however long the product.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
  },
  cardCompact: { paddingVertical: 10, paddingHorizontal: 10, gap: 10 },
  // The art square: the reference's pale-green image tile, in both themes
  // (the dark page gets the same soft green so the category art pops).
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.iconTile,
  },
  thumbCompact: { width: 52, height: 52, borderRadius: 13 },
  body: { flex: 1, minWidth: 0, gap: 4 },
  // One-line names: the text ellipsizes when it cannot fit, so a long product
  // never grows its card or nudges the date / bar / pill / menu out of place.
  name: { color: t.text, fontSize: 16.5, fontWeight: '700', lineHeight: 21 },
  nameCompact: { fontSize: 15, lineHeight: 19 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  // Subtexts breathe a little cyan (theme.textSub) and grow a size, so the
  // category and date read at a glance like the reference's metadata rows.
  metaText: { color: t.textSub, fontSize: 13.5, flexShrink: 1 },
  // The expiry progress row: the thin bar (flex) to the left of the days pill,
  // both vertically centred with a small consistent gap. The pill shrinks its
  // own font before it ever squeezes the bar to nothing.
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  // The track: pale gray-green on the light page, dark translucent green on
  // the dark one (theme.expiryTrack); the fill is always the mint accent.
  barTrack: { flex: 1, minWidth: 0, height: 5, borderRadius: 999, backgroundColor: t.expiryTrack, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, backgroundColor: t.mint },
  pill: { height: 24, paddingHorizontal: 11, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pillCompact: { height: 22, paddingHorizontal: 9 },
  pillText: { fontSize: 12.5, fontWeight: '700' },
  pillTextCompact: { fontSize: 12 },
  dots: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },

  backdrop: { flex: 1, backgroundColor: 'rgba(8,14,11,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  menu: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 8,
    ...(t === LIGHT ? CARD_SHADOW_LIFTED : null),
  },
  menuName: { color: t.textMuted, fontSize: 13, fontWeight: '600', lineHeight: 16, marginBottom: 4, paddingHorizontal: 2 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 13,
    backgroundColor: t.cardAlt,
  },
  menuRowText: { fontSize: 15, fontWeight: '600' },
  menuClose: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
}));
