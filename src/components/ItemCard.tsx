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

// The redesigned item card for the Lists tab (the reference's compact white
// card): a rounded pale-green art square carrying the category's art on the
// left, the name / category / expiry-date meta rows in the middle, and on the
// right the three-dot action menu above the days-left pill. Every value is
// real data (the item's own fields); nothing is sampled or invented.

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
      {/* Middle: name, category and expiry date. The name wraps to a second
          line before it ever cuts to an ellipsis, so long product names stay
          readable. */}
      <View style={s.body}>
        <Text style={[s.name, compact && s.nameCompact]} numberOfLines={2}>
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
      </View>
      {/* Right: the three-dot action menu above the days-left pill. */}
      <View style={s.side}>
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
        <View style={[s.pill, { backgroundColor: t.pills[tone].bg }]}>
          <Text style={[s.pillText, { color: t.pills[tone].text }]} numberOfLines={1} minimumFontScale={0.7} adjustsFontSizeToFit>
            {pill}
          </Text>
        </View>
      </View>

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
                <Ionicons name="cart-outline" size={19} color={t.mint} />
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
  // The compact white product card (the reference's layout): a rounded
  // pale-green art square on the left, the name / category / expiry-date meta
  // rows in the middle, and the three-dot menu above the days-left pill on
  // the right. White with a fine hairline on the light page, the dark theme's
  // translucent glass — every value is real data (the item's own fields).
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
  cardCompact: { paddingVertical: 9, paddingHorizontal: 10, gap: 10 },
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
  // Two-line names: only a genuinely long product grows the card; short ones
  // sit on one line exactly as before.
  name: { color: t.text, fontSize: 16.5, fontWeight: '700', lineHeight: 21 },
  nameCompact: { fontSize: 15, lineHeight: 19 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  // Subtexts breathe a little cyan (theme.textSub) and grow a size, so the
  // category and date read at a glance like the reference's metadata rows.
  metaText: { color: t.textSub, fontSize: 13.5, flexShrink: 1 },
  // Slimmed so the name column keeps the width it needs for long products;
  // the pill shrinks its own font before it ever overflows.
  side: { alignItems: 'flex-end', gap: 9, maxWidth: 106 },
  dots: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pill: { minHeight: 28, paddingHorizontal: 12, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 13, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
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
