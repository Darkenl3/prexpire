import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { makeStyles, useTheme, accents, LIGHT, CARD_SHADOW, CARD_SHADOW_DARK, CARD_SHADOW_LIFTED } from '../theme';
import { useCategories } from '../categories';
import { useItems, type CategoryId } from '../items';
import { useSettings } from '../settings';
import type { DateFormat } from '../preferences';
import { useShopping, type ShoppingItem as ListEntry } from '../shopping';
import { groupShopping } from '../shoppingLogic';
import { daysUntil } from '../scanner/dateParser';
import { SectionHeader } from '../components/HomeComponents';
import { FadeIn, PressScale } from '../components/Press';
import { Note, Options, SmallButton } from '../components/SettingsRows';
import { categoryIcon } from '../components/ItemCard';
import { useWebKeyboardInset } from '../components/WebKeyboardInset';

// The Shopping List, now a view of the Lists tab (ItemsScreen renders this
// body below its Items/Shopping segmented control): what to buy, what was
// bought, and the two ways entries arrive (typed by the user, or placed
// automatically because a tracked product is expiring soon). Empty states
// guide the first steps; nothing here is ever pre-filled with sample content.
// The toast is hoisted to the parent (outside the scrolling Page) so it floats
// at the screen bottom like Home's notice; the add dialog is a Modal and
// escapes the scroll view on its own. The dialog's OPEN STATE is owned by the
// parent too, so the title block's "Add item" capsule opens the same dialog.

export function ShoppingListBody({
  addOpen,
  setAddOpen,
  onToast,
}: {
  addOpen: boolean;
  setAddOpen: (open: boolean) => void;
  onToast: (text: string) => void;
}) {
  const c = useStyles();
  const t = useTheme();
  const { items, ready, saveError, setPurchased, remove, clearPurchased } = useShopping();
  const { custom } = useCategories();
  const { toBuy, purchased } = useMemo(() => groupShopping(items), [items]);

  // Rows animate out (collapse) before they are actually moved or removed.
  // One leave at a time; an action arriving while one runs simply executes.
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const afterLeave = useRef<null | (() => void)>(null);

  const runLeave = useCallback((id: string, then: () => void) => {
    if (leavingId) {
      then();
      return;
    }
    setLeavingId(id);
    afterLeave.current = then;
  }, [leavingId]);

  const finishLeave = useCallback(() => {
    afterLeave.current?.();
    afterLeave.current = null;
    setLeavingId(null);
  }, []);

  const togglePurchased = useCallback(
    (entry: ListEntry) => {
      Haptics.selectionAsync().catch(() => {});
      runLeave(entry.id, () => {
        setPurchased(entry.id, !entry.purchasedAt);
        if (!entry.purchasedAt) onToast('Moved to Purchased');
      });
    },
    [runLeave, setPurchased, onToast],
  );

  const removeEntry = useCallback(
    (entry: ListEntry) => {
      Haptics.selectionAsync().catch(() => {});
      runLeave(entry.id, () => {
        remove(entry.id);
        onToast('Removed from your list');
      });
    },
    [runLeave, remove, onToast],
  );

  // Clearing purchased items asks twice (like deleting a category folder).
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const id = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(id);
  }, [confirmClear]);
  const onClearPurchased = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    clearPurchased();
    onToast('Cleared purchased items');
  }, [confirmClear, clearPurchased, onToast]);

  const empty = ready && toBuy.length === 0 && purchased.length === 0;

  return (
    <>
      {saveError && (
        <View style={c.banner} accessibilityRole="alert">
          <Note tone="warn">Your last change couldn't be saved in this browser's storage. It applies until you close the page.</Note>
        </View>
      )}

        {!ready ? (
          <View style={c.loading}>
            <ActivityIndicator size="small" color={t.mint} />
          </View>
        ) : empty ? (
          <FadeIn>
            <View style={c.empty}>
              <View style={c.emptyIcon}>
                <Ionicons name="cart-outline" size={30} color={accents.mint} />
              </View>
              <Text style={c.emptyTitle}>Your list is empty</Text>
              <Text style={c.emptyText}>Add what you need to buy. Products that are expiring soon can land here automatically.</Text>
              <SmallButton label="Add an item" icon="add" tone="mint" onPress={() => setAddOpen(true)} accessibilityLabel="Add an item to your Shopping List" />
            </View>
          </FadeIn>
        ) : (
          <>
            <SectionHeader title={toBuy.length ? `To buy (${toBuy.length})` : 'To buy'} action="Add item" onAction={() => setAddOpen(true)} />
            <View style={c.list}>
              {toBuy.map((entry) => (
                <ShoppingRow
                  key={entry.id}
                  entry={entry}
                  purchased={false}
                  leaving={leavingId === entry.id}
                  onLeaveDone={finishLeave}
                  onToggle={togglePurchased}
                  onRemove={removeEntry}
                  categoryIconName={categoryIcon(entry.category, custom.find((x) => x.id === entry.category)?.icon)}
                />
              ))}
              {toBuy.length === 0 && purchased.length > 0 && (
                <FadeIn>
                  <View style={c.allDone}>
                    <Ionicons name="checkmark-done-circle-outline" size={22} color={t.mint} />
                    <Text style={c.allDoneText}>Everything on your list is bought.</Text>
                  </View>
                </FadeIn>
              )}
            </View>

            {purchased.length > 0 && (
              <>
                <SectionHeader title={`Purchased (${purchased.length})`} action={confirmClear ? 'Tap again to clear' : 'Clear'} onAction={onClearPurchased} />
                <View style={c.list}>
                  {purchased.map((entry) => (
                    <ShoppingRow
                      key={entry.id}
                      entry={entry}
                      purchased
                      leaving={leavingId === entry.id}
                      onLeaveDone={finishLeave}
                      onToggle={togglePurchased}
                      onRemove={removeEntry}
                      categoryIconName={categoryIcon(entry.category, custom.find((x) => x.id === entry.category)?.icon)}
                    />
                  ))}
                </View>
                <Note>Purchased items stay until you clear them.</Note>
              </>
            )}
          </>
        )}

      <AddItemDialog visible={addOpen} onClose={() => setAddOpen(false)} onAdded={(name) => onToast(`${name} added to your list`)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Rows

type RowProps = {
  entry: ListEntry;
  purchased: boolean;
  leaving: boolean;
  // The entry's category glyph (the item cards' meta-row icon), shown on the
  // to-buy rows' category line.
  categoryIconName: keyof typeof Ionicons.glyphMap;
  onLeaveDone: () => void;
  onToggle: (entry: ListEntry) => void;
  onRemove: (entry: ListEntry) => void;
};

function ShoppingRow({ entry, purchased, leaving, categoryIconName, onLeaveDone, onToggle, onRemove }: RowProps) {
  const c = useStyles();
  const t = useTheme();
  const { nameOf } = useCategories();
  const { settings, motion } = useSettings();
  const { setQuantity } = useShopping();

  // The row's height is measured so the animations can grow and collapse to
  // zero. One value drives the whole row: it rises on mount (grow + fade) and
  // collapses when the row leaves (moved to Purchased, or removed).
  const [height, setHeight] = useState(60);
  const onLayout = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 0 && h !== height) setHeight(h);
  };

  const anim = useRef(new Animated.Value(0)).current;
  const motionRef = useRef(motion);
  motionRef.current = motion;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: motionRef.current ? 180 : 0, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [anim]);
  useEffect(() => {
    if (!leaving) return;
    Animated.timing(anim, { toValue: 0, duration: motionRef.current ? 190 : 0, easing: Easing.in(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (finished) onLeaveDone();
    });
  }, [leaving, anim, onLeaveDone]);

  const maxHeight = anim.interpolate({ inputRange: [0, 1], outputRange: [0, height] });
  const marginBottom = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 8] });

  const days = entry.expiresOn ? daysUntil(entry.expiresOn, new Date()) : null;
  const pill = days === null ? null : days < 0 ? 'Expired' : days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;
  const amber = days !== null && days <= settings.warningDays;

  const reasonLabel = entry.reason === 'expiring' ? 'Expiring soon' : 'Manually added';
  const sub = entry.purchasedAt ? purchasedLabel(entry.purchasedAt, settings.dateFormat) : `${nameOf(entry.category)}  •  ${reasonLabel}`;

  return (
    <Animated.View style={{ maxHeight, opacity: anim, marginBottom }}>
      <View style={c.row} onLayout={onLayout}>
        <CheckButton checked={purchased} label={`${purchased ? 'Bought' : 'Mark bought'}: ${entry.name}`} onPress={() => onToggle(entry)} />
        <View style={c.rowText}>
          {/* The name wraps to a second line before it ever cuts to an
              ellipsis, matching the item cards on the Items view. */}
          <Text style={[c.rowTitle, purchased && c.rowTitleDone]} numberOfLines={2}>
            {entry.name}
            {entry.quantity > 1 ? <Text style={c.qtyInline}>{`  ×${entry.quantity}`}</Text> : null}
          </Text>
          {!purchased ? (
            <View style={c.rowSubRow}>
              <Ionicons name={categoryIconName} size={11.5} color={t.textMuted} />
              <Text style={c.rowSub} numberOfLines={1}>
                {sub}
              </Text>
            </View>
          ) : (
            <Text style={c.rowSub} numberOfLines={1}>
              {sub}
            </Text>
          )}
        </View>
        {!purchased && pill ? (
          <View style={[c.pill, amber && c.pillAmber]}>
            <Text style={[c.pillText, amber && c.pillTextAmber]}>{pill}</Text>
          </View>
        ) : null}
        {!purchased ? <QtyStepper value={entry.quantity} onChange={(q) => setQuantity(entry.id, q)} label={entry.name} /> : null}
        <PressScale
          onPress={() => onRemove(entry)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${entry.name}`}
          scaleTo={0.88}
          style={c.remove}
        >
          <Ionicons name="trash-outline" size={17} color={purchased ? t.textMuted : t.red} />
        </PressScale>
      </View>
    </Animated.View>
  );
}

// The round checkbox. Checking fills with mint and pops the checkmark in;
// un-checking returns to the empty circle.
function CheckButton({ checked, label, onPress }: { checked: boolean; label: string; onPress: () => void }) {
  const c = useStyles();
  const t = useTheme();
  const { motion } = useSettings();
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!checked) return;
    pop.setValue(0.4);
    Animated.timing(pop, { toValue: 1, duration: motion ? 160 : 0, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [checked, pop, motion]);
  return (
    <PressScale
      onPress={onPress}
      accessibilityRole="checkbox"
      aria-checked={checked}
      accessibilityLabel={label}
      scaleTo={0.88}
      style={[c.check, checked && { backgroundColor: t.mint, borderColor: t.mint }]}
    >
      {checked ? (
        <Animated.View style={{ transform: [{ scale: pop }] }}>
          <Ionicons name="checkmark" size={16} color={t.scanInk} />
        </Animated.View>
      ) : null}
    </PressScale>
  );
}

// The quantity stepper. Deliberately a plain Pressable (like the scanner's
// steppers): it must answer rapid repeated taps instantly.
function QtyStepper({ value, onChange, label }: { value: number; onChange: (q: number) => void; label: string }) {
  const c = useStyles();
  const t = useTheme();
  const btn = (icon: keyof typeof Ionicons.glyphMap, delta: number, disabled: boolean, a11y: string) => (
    <Pressable
      onPress={() => !disabled && onChange(value + delta)}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${a11y} quantity of ${label}`}
      style={({ pressed }) => [c.stepBtn, pressed && c.stepPressed, disabled && c.stepDisabled]}
    >
      <Ionicons name={icon} size={14} color={disabled ? t.textMuted : t.text} />
    </Pressable>
  );
  return (
    <View style={c.stepper}>
      {btn('remove', -1, value <= 1, 'Decrease')}
      <Text style={c.qty} accessibilityLabel={`Quantity of ${label}: ${value}`}>
        {value}
      </Text>
      {btn('add', 1, value >= 99, 'Increase')}
    </View>
  );
}

function purchasedLabel(purchasedAt: string, format: DateFormat): string {
  const [y, m, d] = purchasedAt.slice(0, 10).split('-').map(Number);
  const now = new Date();
  const days = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const shown = format === 'YMD' ? `${y}-${pad(m)}-${pad(d)}` : format === 'MDY' ? `${pad(m)}/${pad(d)}/${y}` : `${pad(d)}/${pad(m)}/${y}`;
  return days === 0 ? 'Purchased today' : days === -1 ? 'Purchased yesterday' : `Purchased ${shown}`;
}

// ---------------------------------------------------------------------------
// The manual add dialog

function AddItemDialog({ visible, onClose, onAdded }: { visible: boolean; onClose: () => void; onAdded: (name: string) => void }) {
  const t = useTheme();
  const c = useStyles();
  // The phone keyboard's footprint on the web (0 everywhere else): the
  // backdrop pads by it, so the centered dialog rides above the keys and the
  // name input is never covered while typing.
  const webKeyboard = useWebKeyboardInset();
  const { addManual } = useShopping();
  const { all } = useCategories();
  const { defaultCategory } = useItems();
  // The default may name a category the user removed; fall back to the first one they keep.
  const known = (all.some((cat) => cat.id === defaultCategory) ? defaultCategory : (all[0]?.id ?? 'food')) as CategoryId;
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [category, setCategory] = useState<CategoryId>(known);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setQuantity(1);
      setCategory(known);
      setError(null);
      setBusy(false);
    }
  }, [visible, known]);

  const save = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await addManual({ name, category, quantity });
    if (result.ok) {
      onAdded(result.item.name);
      onClose();
    } else {
      setError(result.reason === 'duplicate' ? 'That is already on your list.' : 'Type a name first.');
      setBusy(false);
    }
  }, [busy, name, category, quantity, addManual, onAdded, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? () => {} : onClose}>
      <View style={[c.backdrop, webKeyboard > 0 && { paddingBottom: webKeyboard }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} accessibilityLabel="Close" importantForAccessibility="no" />
        <View
          style={[c.dialog, { backgroundColor: t.dialogBg, borderColor: t.surfaceBorder }]}
          accessibilityRole={'dialog' as never}
          accessibilityLabel="Add to Shopping List"
          {...({ 'aria-modal': true } as object)}
        >
          <Text style={c.dialogTitle} accessibilityRole="header">
            Add to Shopping List
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="What do you need?"
            placeholderTextColor={t.textMuted}
            maxLength={80}
            autoFocus
            accessibilityLabel="Item name"
            style={c.input}
            returnKeyType="done"
            onSubmitEditing={() => void save()}
          />
          <Text style={c.fieldLabel}>Quantity</Text>
          <QtyStepper value={quantity} onChange={setQuantity} label={name || 'the item'} />
          <Text style={c.fieldLabel}>Category</Text>
          <Options
            label="Category"
            value={category}
            onChange={setCategory}
            options={all.map((cat) => ({ value: cat.id as CategoryId, label: cat.name }))}
          />
          {error ? (
            <FadeIn>
              <Note tone="warn">{error}</Note>
            </FadeIn>
          ) : null}
          <View style={c.dialogButtons}>
            <SmallButton label="Cancel" onPress={onClose} disabled={busy} />
            <SmallButton label={busy ? 'Adding…' : 'Add to list'} icon="add" tone="mint" onPress={() => void save()} disabled={busy || !name.trim()} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The toast, rendered by the PARENT (ItemsScreen) outside the scrolling Page
// so it floats at the screen bottom like Home's notice. Keyed by its text so
// a follow-up toast restarts the fade.

export function ShoppingToast({ text, onDone }: { text: string; onDone: () => void }) {
  const t = useTheme();
  const c = useStyles();
  const { motion } = useSettings();
  const opacity = useRef(new Animated.Value(motion ? 0 : 1)).current;
  useEffect(() => {
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
    <Animated.View pointerEvents="none" style={[c.toastWrap, { opacity }]} accessibilityLiveRegion="polite">
      <View style={[c.toast, { backgroundColor: t.toastBg, borderColor: t.toastBorder }]}>
        <Ionicons name="checkmark-circle" size={18} color={t.mint} />
        <Text style={[c.toastText, { color: t.text }]} numberOfLines={2}>
          {text}
        </Text>
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  banner: { borderRadius: 14, borderWidth: 1, borderColor: t.dangerBorder, backgroundColor: t.dangerBg, padding: 12, marginBottom: 16 },
  loading: { alignItems: 'center', paddingVertical: 48 },
  list: {},
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 36,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    backgroundColor: t.surface,
    ...(t === LIGHT ? CARD_SHADOW : null),
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t === LIGHT ? '#D9FBF0' : 'rgba(46,232,182,0.10)',
    marginBottom: 4,
  },
  emptyTitle: { color: t.text, fontSize: 17.5, fontWeight: '700' },
  emptyText: { color: t.textMuted, fontSize: 14, lineHeight: 19, textAlign: 'center', marginBottom: 8 },
  allDone: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14 },
  allDoneText: { color: t.textMuted, fontSize: 14, fontWeight: '500' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 62,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: t.surface,
    // The item cards' language: a fine hairline on both themes so the white
    // rows stay visible on the near-white page, plus the soft light shadow
    // (and a soft black anchor on the dark page).
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    ...(t === LIGHT ? CARD_SHADOW : CARD_SHADOW_DARK),
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: t === LIGHT ? '#B6C4D2' : '#3A4E55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: t.text, fontSize: 15.5, fontWeight: '600', lineHeight: 20 },
  rowTitleDone: { color: t.textMuted, textDecorationLine: 'line-through' },
  qtyInline: { color: t.textMuted, fontSize: 13.5, fontWeight: '500' },
  // The category line, with the same small glyph the item cards' meta rows use.
  rowSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0, marginTop: 1 },
  rowSub: { color: t.textMuted, fontSize: 12.5, flexShrink: 1 },
  pill: { height: 25, paddingHorizontal: 10, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: t.pills.green.bg },
  pillAmber: { backgroundColor: t.pills.amber.bg },
  pillText: { fontSize: 12.5, fontWeight: '600', color: t.pills.green.text },
  pillTextAmber: { color: t.pills.amber.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  stepBtn: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.cardAlt },
  stepPressed: { opacity: 0.6 },
  stepDisabled: { opacity: 0.35 },
  qty: { minWidth: 20, textAlign: 'center', color: t.text, fontSize: 13.5, fontWeight: '600' },
  remove: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },

  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 10,
    ...(t === LIGHT ? CARD_SHADOW_LIFTED : null),
  },
  dialogTitle: { color: t.text, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: t.surfaceBorder,
    borderRadius: 12,
    backgroundColor: t === LIGHT ? '#FFFFFF' : t.cardAlt,
    color: t.text,
    fontSize: 16,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  fieldLabel: { color: t.textMuted, fontSize: 13, fontWeight: '600', marginTop: 4 },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8, flexWrap: 'wrap' },

  toastWrap: { position: 'absolute', left: 16, right: 16, bottom: 110, alignItems: 'center' },
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
