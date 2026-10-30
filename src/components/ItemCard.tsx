import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { makeStyles, useTheme, LIGHT, CARD_SHADOW_LIFTED, type Tint, type Tone } from '../theme';
import { useCategories } from '../categories';
import { useItems, type Item } from '../items';
import { expiryStatus } from '../preferences';
import { useSettings } from '../settings';
import { useShopping } from '../shopping';
import { daysUntil } from '../scanner/dateParser';
import { categoryArt } from './ResultSheet';
import { FadeIn, PressScale } from './Press';
import { SmallButton } from './SettingsRows';

// The redesigned item card for the Lists tab (the reference screenshot's
// layout): a wide rounded glass card per tracked product — a tinted rounded
// square carrying the category's art on the left, the name / category / expiry
// date meta rows and a horizontal expiry progress bar in the middle, and on
// the right the three-dot action menu above the days-left pill. Every value is
// real data (the item's own fields); nothing is sampled or invented.

// The built-ins' chip/row glyphs (custom categories carry their own icon).
const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  food: 'nutrition-outline',
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
  const barColor = status === 'expired' ? t.red : status === 'soon' ? t.amber : t.mint;

  const known = custom.find((cat) => cat.id === item.category);
  const tint = categoryTint(item.category, known?.tint);
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
    <View style={[s.card, compact && s.cardCompact, ...(t === LIGHT ? [CARD_SHADOW_LIFTED] : [])]}>
      {/* Left: the product's art in a rounded square tinted by its category —
          the image slot of the reference card, carrying real category data. */}
      <View style={[s.thumb, compact && s.thumbCompact, { backgroundColor: t.tints[tint].top, borderColor: t.tints[tint].border }]}>
        {categoryArt(item.category, compact ? 26 : 32)}
      </View>
      {/* Middle: name, category, expiry date, and the expiry progress bar. */}
      <View style={s.body}>
        <Text style={[s.name, compact && s.nameCompact]} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={s.metaRow}>
          <Ionicons name={icon} size={12.5} color={t.textMuted} />
          <Text style={s.metaText} numberOfLines={1}>
            {nameOf(item.category)}
          </Text>
        </View>
        <View style={s.metaRow}>
          <Ionicons name="calendar-outline" size={12.5} color={t.textMuted} />
          <Text style={s.metaText} numberOfLines={1}>
            {formatDate(item.expiresOn, item.datePrecision)}
          </Text>
        </View>
        <View
          style={s.barTrack}
          accessibilityRole="progressbar"
          accessibilityLabel={`${Math.round(progress * 100)} percent of its tracked time left`}
        >
          <View style={[s.barFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: barColor }]} />
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
          <Text style={[s.pillText, { color: t.pills[tone].text }]} numberOfLines={1} minimumFontScale={0.8} adjustsFontSizeToFit>
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
              <Text style={s.menuName} numberOfLines={1}>
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
  // The wide glass card: dark translucent surface with a hairline on dark,
  // a borderless floating white card on light.
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
  // The art square (the reference's product-image slot).
  thumb: {
    width: 62,
    height: 62,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbCompact: { width: 48, height: 48, borderRadius: 12 },
  body: { flex: 1, minWidth: 0, gap: 3 },
  name: { color: t.text, fontSize: 15.5, fontWeight: '700' },
  nameCompact: { fontSize: 14.5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  metaText: { color: t.textMuted, fontSize: 12.5, flexShrink: 1 },
  // The expiry progress bar: a hairline track with the status-coloured fill.
  barTrack: { height: 6, borderRadius: 3, backgroundColor: t.separator, marginTop: 4, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  side: { alignItems: 'flex-end', gap: 9, maxWidth: 118 },
  dots: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  pill: { minHeight: 26, paddingHorizontal: 11, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 12.5, fontWeight: '700' },

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
  menuName: { color: t.textMuted, fontSize: 13, fontWeight: '600', marginBottom: 4, paddingHorizontal: 2 },
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
