import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SCANNER_COLORS as colors, radius } from '../theme';
import { useCategories } from '../categories';
import { type CategoryId } from '../items';
import { formatDate, isoToday, type ConfirmReason, type DayOrder, type Interpretation } from '../scanner/dateParser';
import type { Detection } from '../scanner/useExpiryScanner';
import { AppleArt, CapsuleArt, HouseArt, JarArt, PumpBottleArt } from './Art';
import { PressScale } from './Press';
import { ChoicePill, useScrollSelectedIntoView, type PillColors } from './ChoicePill';

// The sheet's category pills: the same solid-green "selected" language as the
// Items filters and sort row, rendered in the scanner's fixed dark palette -
// green fill, no checkmark, soft crossfade when picked.
const SHEET_PILLS: PillColors = {
  offBg: 'rgba(255,255,255,0.05)',
  offBorder: colors.surfaceBorder,
  offText: colors.textMuted,
  onBg: colors.selBg,
  onBorder: colors.selBg,
  onText: colors.scanInk,
};

export function categoryArt(id: CategoryId, size: number) {
  switch (id) {
    case 'food':
      return <AppleArt size={size} />;
    case 'medicine':
      return <CapsuleArt size={size} />;
    case 'household':
      return <HouseArt size={0.95 * size} />;
    case 'skincare':
      return <PumpBottleArt size={size} />;
    default:
      return <JarArt size={size} />;
  }
}

const REASON_TEXT: Partial<Record<ConfirmReason, string>> = {
  'no-label': 'No EXP or BEST BEFORE label was found next to this date.',
  'multiple-dates': 'More than one date was found, so the latest one was picked.',
  'month-only': 'Only a month is printed. The item will expire at the end of that month.',
  'in-past': 'This date has already passed.',
  'sell-by': 'This is a sell-by date, which can be earlier than the real expiry date.',
  'no-year': 'No year is printed, so the next time this date comes round was used. Check the year.',
};

export type SaveInput = { name: string; category: CategoryId; date: Interpretation };

type Props = {
  // A scanned detection, or null when the user enters the date by hand.
  detection: Detection | null;
  initialCategory: CategoryId;
  // True when the category was picked from the label's words (see
  // scanner/categoryGuess.ts) - shown as a gentle hint under the chips.
  categoryGuessed?: boolean;
  // The day/month order named by the user's Date format setting ('DMY'/'MDY'),
  // or null when the setting says nothing about it (YMD falls back to the
  // device region). When set, an ambiguous date is read that way straight
  // away — preselected and confirmed with a small note — instead of asking
  // which reading it is. The date stays editable either way.
  assumedOrder?: DayOrder | null;
  layout: 'bottom' | 'side';
  // Full-screen portrait form (the scanner's save sheet now fills everything
  // below the header bar instead of floating at half height): no drag handle,
  // taller top padding - the content scrolls and the actions stay pinned.
  full?: boolean;
  maxHeight: number;
  bottomInset: number;
  secondaryLabel: string;
  onAdd: (input: SaveInput) => Promise<void>;
  onSecondary: () => void;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function ResultSheet({ detection, initialCategory, categoryGuessed = false, assumedOrder = null, layout, full = false, maxHeight, bottomInset, secondaryLabel, onAdd, onSecondary }: Props) {
  const { all } = useCategories();
  const [name, setName] = useState('');
  // The name field is a real, visible input box: focus lights its border so it
  // reads unmistakably as somewhere to type (especially in manual entry, where
  // the product name is the whole point of the screen).
  const [nameFocused, setNameFocused] = useState(false);
  const nameRef = useRef<TextInput>(null);
  const [category, setCategory] = useState<CategoryId>(initialCategory);
  const readings = useMemo(() => (detection ? [detection.primary, ...detection.alternatives] : []), [detection]);
  const ambiguous = readings.length > 1;
  // The Date format setting resolved the day/month order: the reading that
  // matches it (the parser puts it first) is preselected, and a small note
  // says how it was read. Only a format that says nothing about the order
  // keeps the question below.
  const autoRead = ambiguous && !!assumedOrder;
  // For an unresolved day/month order the user must pick a reading; nothing is preselected.
  const [picked, setPicked] = useState<number | null>(ambiguous && !autoRead ? null : 0);
  const [edited, setEdited] = useState<Interpretation | null>(detection ? null : { iso: isoToday(new Date()), precision: 'day' });
  const [editing, setEditing] = useState(!detection);
  // Dates that are not high confidence need an explicit "this is the expiry date".
  const needsTick = !!detection && detection.confidence === 'medium' && detection.reasons.some((r) => r !== 'ambiguous-order' && r !== 'month-only');
  const [ticked, setTicked] = useState(false);
  const [save, setSave] = useState<SaveState>('idle');
  // Inline validation: the product name is required, so an empty name shows a
  // concise error under the field instead of silently inventing a placeholder.
  const [nameError, setNameError] = useState(false);
  // Keep the chip row scrolled so the initially selected category is visible.
  const { scrollRef: chipsScroll, note: noteChip } = useScrollSelectedIntoView(category);
  // A ref, not state, so a second tap in the same frame is ignored too.
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const date: Interpretation | null = edited ?? (picked !== null ? readings[picked] : null);
  const confirmed = !!date && (!!edited || !needsTick || ticked);
  const canSave = confirmed && save !== 'saving' && save !== 'saved';

  const submit = async () => {
    if (!canSave || !date || busy.current) return;
    if (!name.trim()) {
      // The name is required: show the inline error, keep everything entered.
      setNameError(true);
      return;
    }
    busy.current = true;
    setSave('saving');
    try {
      await onAdd({ name: name.trim(), category, date });
      if (mounted.current) setSave('saved');
    } catch {
      busy.current = false;
      if (mounted.current) setSave('error');
    }
  };

  const reasons = detection ? detection.reasons.filter((r) => REASON_TEXT[r]) : [];
  const dateTitle = !detection ? 'Expiry date' : edited ? 'Expiry date (edited)' : confirmed ? 'Detected expiry date' : 'Check the expiry date';

  return (
    <View
      style={[
        s.sheet,
        layout === 'side' ? s.sheetSide : s.sheetBottom,
        full && s.sheetFull,
        // Full mode: the sheet spans the whole available height (minHeight
        // pins the action bar to the bottom of the screen; maxHeight still
        // guards tiny viewports), so the form owns the screen instead of
        // floating at half height with dead space beneath it.
        { maxHeight, ...(full ? { minHeight: maxHeight } : null), paddingBottom: Math.max(bottomInset, 14) },
      ]}
    >
      {layout === 'bottom' && !full && <View style={s.handle} />}
      <ScrollView
        style={[s.scroll, full && s.scrollFull]}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        bounces={false}
      >
        <View style={s.nameBlock}>
          <Text style={s.nameLabel}>Product name</Text>
          <View style={[s.nameField, nameFocused && !nameError && s.nameFieldFocus, nameError && s.nameFieldWarn]}>
            <View style={s.nameArt}>{categoryArt(category, 28)}</View>
            <TextInput
              ref={nameRef}
              value={name}
              onChangeText={(t) => {
                setName(t);
                if (nameError && t.trim()) setNameError(false);
              }}
              placeholder="e.g. Greek yogurt"
              placeholderTextColor={colors.textMuted}
              style={s.nameInput}
              returnKeyType="done"
              maxLength={80}
              autoCorrect={false}
              accessibilityLabel="Product name"
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              onSubmitEditing={() => nameRef.current?.blur()}
            />
          </View>
          {nameError && <Text style={s.nameError}>Give the product a name first.</Text>}
        </View>

        <ScrollView ref={chipsScroll} horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
          {all.map((cat) => (
            <View key={cat.id} onLayout={(e) => noteChip(cat.id, e)}>
              <ChoicePill
                label={cat.name}
                selected={cat.id === category}
                onPress={() => setCategory(cat.id)}
                colors={SHEET_PILLS}
                accessibilityLabel={`Category ${cat.name}`}
              />
            </View>
          ))}
        </ScrollView>
        {categoryGuessed && <Text style={s.guessed}>Category picked from the label; tap another to change it.</Text>}

        <View style={s.divider} />

        <PressScale
          onPress={() => setEditing((e) => !e)}
          scaleTo={0.99}
          style={s.dateRow}
          accessibilityRole="button"
          accessibilityLabel={`${dateTitle}: ${date ? formatDate(date) : 'not chosen'}. Edit date`}
        >
          <View style={[s.calendar, !confirmed && s.calendarWarn]}>
            <Ionicons name="calendar" size={22} color={confirmed ? colors.mint : colors.amber} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.dateLabel, !confirmed && { color: colors.amberText }]}>{dateTitle}</Text>
            <Text style={s.dateValue}>{date ? formatDate(date) : 'Choose the date below'}</Text>
          </View>
          <Ionicons name={editing ? 'chevron-down' : 'chevron-forward'} size={20} color={colors.textMuted} />
        </PressScale>

        {ambiguous && !autoRead && !edited && (
          <View style={s.block}>
            <Text style={s.question}>The day and month could be either way round. Which is it?</Text>
            <View style={s.choiceRow}>
              {readings.map((r, i) => (
                <PressScale
                  key={r.iso}
                  onPress={() => setPicked(i)}
                  scaleTo={0.97}
                  style={[s.choice, picked === i && s.choiceOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: picked === i }}
                >
                  <Text style={[s.choiceText, picked === i && s.choiceTextOn]}>{formatDate(r)}</Text>
                </PressScale>
              ))}
            </View>
          </View>
        )}

        {/* Resolved by the Date format setting: no question, just how the date
            was read — and the date row above opens the editor to change it. */}
        {autoRead && !edited && (
          <View style={s.block}>
            <View style={s.reason}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
              <Text style={s.autoNote}>Read as {assumedOrder === 'DMY' ? 'day/month/year' : 'month/day/year'} — your Date format setting; tap the date to change it</Text>
            </View>
          </View>
        )}

        {!edited && reasons.length > 0 && (
          <View style={s.block}>
            {reasons.map((r) => (
              <View key={r} style={s.reason}>
                <Ionicons name="information-circle-outline" size={16} color={colors.amberText} />
                <Text style={s.reasonText}>{REASON_TEXT[r]}</Text>
              </View>
            ))}
            {detection && <Text style={s.raw}>Read on the label: “{detection.labelText ? `${detection.labelText} ` : ''}{detection.raw}”</Text>}
          </View>
        )}

        {editing && (
          <DateEditor
            value={date ?? readings[0] ?? { iso: isoToday(new Date()), precision: 'day' }}
            onChange={(iso) => setEdited({ iso, precision: 'day' })}
          />
        )}
      </ScrollView>

      {needsTick && !edited && (
        <PressScale
          onPress={() => setTicked((t) => !t)}
          scaleTo={0.99}
          style={s.tickRow}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: ticked }}
        >
          <Ionicons name={ticked ? 'checkbox' : 'square-outline'} size={22} color={ticked ? colors.mint : colors.textMuted} />
          <Text style={s.tickText}>Yes, this is the expiry date</Text>
        </PressScale>
      )}

      {save === 'error' && <Text style={s.error}>Couldn't save the item. Please try again.</Text>}
      <PressScale
        onPress={submit}
        disabled={!canSave}
        scaleTo={0.98}
        style={[s.primary, !canSave && save !== 'saved' && s.disabled]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSave, busy: save === 'saving' }}
        accessibilityLabel={save === 'saved' ? 'Item added' : 'Add item'}
      >
        {save === 'saving' ? (
          <ActivityIndicator color={colors.scanInk} />
        ) : save === 'saved' ? (
          <View style={s.savedRow}>
            <Ionicons name="checkmark-circle" size={20} color={colors.scanInk} />
            <Text style={s.primaryText}>Added</Text>
          </View>
        ) : (
          <Text style={s.primaryText}>Add item</Text>
        )}
      </PressScale>
      <PressScale
        onPress={onSecondary}
        disabled={save === 'saving' || save === 'saved'}
        scaleTo={0.98}
        style={s.secondary}
        accessibilityRole="button"
      >
        <Text style={s.secondaryText}>{secondaryLabel}</Text>
      </PressScale>
    </View>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Day, month and year steppers. Works the same on iOS, Android and web without a native picker.
function DateEditor({ value, onChange }: { value: Interpretation; onChange: (iso: string) => void }) {
  const [y, m, d] = value.iso.split('-').map(Number);
  const set = (year: number, month: number, day: number) => {
    const max = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const dd = Math.min(Math.max(day, 1), max);
    onChange(`${year}-${String(month).padStart(2, '0')}-${String(dd).padStart(2, '0')}`);
  };
  const wrap = (n: number, lo: number, hi: number) => (n < lo ? hi : n > hi ? lo : n);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const thisYear = new Date().getFullYear();
  return (
    <View style={s.editor}>
      <Stepper label="Day" value={String(d)} onDown={() => set(y, m, wrap(d - 1, 1, daysInMonth))} onUp={() => set(y, m, wrap(d + 1, 1, daysInMonth))} />
      <Stepper label="Month" value={MONTHS[m - 1]} onDown={() => set(y, wrap(m - 1, 1, 12), d)} onUp={() => set(y, wrap(m + 1, 1, 12), d)} />
      <Stepper
        label="Year"
        value={String(y)}
        onDown={() => set(Math.max(y - 1, thisYear - 5), m, d)}
        onUp={() => set(Math.min(y + 1, thisYear + 15), m, d)}
      />
    </View>
  );
}

function Stepper({ label, value, onDown, onUp }: { label: string; value: string; onDown: () => void; onUp: () => void }) {
  return (
    <View style={s.stepper} accessibilityLabel={`${label} ${value}`}>
      <Pressable onPress={onDown} hitSlop={6} style={s.stepBtn} accessibilityRole="button" accessibilityLabel={`Previous ${label.toLowerCase()}`}>
        <Ionicons name="remove" size={18} color={colors.text} />
      </Pressable>
      <View style={s.stepValue}>
        <Text style={s.stepLabel}>{label}</Text>
        <Text style={s.stepText}>{value}</Text>
      </View>
      <Pressable onPress={onUp} hitSlop={6} style={s.stepBtn} accessibilityRole="button" accessibilityLabel={`Next ${label.toLowerCase()}`}>
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  sheet: { backgroundColor: '#0E1712', borderColor: colors.surfaceBorder, paddingHorizontal: 18, paddingTop: 10 },
  sheetBottom: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: StyleSheet.hairlineWidth },
  sheetSide: { borderTopLeftRadius: 24, borderBottomLeftRadius: 24, borderLeftWidth: StyleSheet.hairlineWidth, paddingTop: 18 },
  // The full-screen portrait form: no handle (there is nothing to drag it
  // over), and comfortable top padding where the handle used to be.
  sheetFull: { paddingTop: 18 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: '#2E3D34', marginBottom: 12 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  // Full-screen mode: the body GROWS to eat the sheet's extra height, so the
  // tick/actions always sit pinned at the bottom of the screen and the form
  // content starts at the top — a real full-screen form, not a floating card.
  scrollFull: { flexGrow: 1 },
  scrollContent: { paddingBottom: 12 },
  // The product name is a real labelled field: a tall, generous input with the
  // category art inside it, sized so the typed text reads clearly while typing
  // (large type, bright focus treatment) and a phone keyboard never crowds it.
  nameBlock: { gap: 8 },
  nameLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  nameField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 70,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: 12,
  },
  nameFieldFocus: { borderColor: 'rgba(112,184,91,0.55)', backgroundColor: 'rgba(112,184,91,0.06)' },
  nameFieldWarn: { borderColor: 'rgba(245,184,61,0.65)' },
  nameArt: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.iconTile, alignItems: 'center', justifyContent: 'center' },
  nameInput: { flex: 1, color: colors.text, fontSize: 17.5, fontWeight: '600', paddingVertical: 0, paddingRight: 4 },
  nameError: { color: colors.amberText, fontSize: 12.5 },
  chips: { gap: 8, paddingTop: 14 },
  guessed: { color: colors.textMuted, fontSize: 12, paddingTop: 8 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.surfaceBorder, marginTop: 14 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  calendar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#093426', alignItems: 'center', justifyContent: 'center' },
  calendarWarn: { backgroundColor: '#3A2C14' },
  dateLabel: { color: colors.textMuted, fontSize: 13.5 },
  dateValue: { color: colors.text, fontSize: 21, fontWeight: '700', letterSpacing: -0.3, marginTop: 2 },
  block: { gap: 8, paddingBottom: 10 },
  question: { color: colors.text, fontSize: 14, fontWeight: '500' },
  choiceRow: { flexDirection: 'row', gap: 10 },
  choice: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1, borderColor: colors.surfaceBorder, alignItems: 'center', justifyContent: 'center' },
  choiceOn: { borderColor: colors.mint, backgroundColor: colors.mint },
  choiceText: { color: colors.text, fontSize: 15, fontWeight: '500' },
  choiceTextOn: { color: colors.scanInk, fontWeight: '700' },
  reason: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  reasonText: { color: colors.amberText, fontSize: 13, flex: 1, lineHeight: 18 },
  autoNote: { color: colors.textMuted, fontSize: 13, flex: 1, lineHeight: 18 },
  raw: { color: colors.textMuted, fontSize: 12.5 },
  tickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 2, paddingBottom: 10 },
  tickText: { color: colors.text, fontSize: 14.5, fontWeight: '500' },
  editor: { flexDirection: 'row', gap: 8, paddingTop: 4, paddingBottom: 6 },
  stepper: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface, height: 52 },
  stepBtn: { width: 30, height: '100%', alignItems: 'center', justifyContent: 'center' },
  stepValue: { flex: 1, alignItems: 'center' },
  stepLabel: { color: colors.textMuted, fontSize: 11 },
  stepText: { color: colors.text, fontSize: 15.5, fontWeight: '600' },
  error: { color: colors.red, fontSize: 13, textAlign: 'center', marginBottom: 6 },
  primary: { height: 52, borderRadius: radius.pill, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryText: { color: colors.scanInk, fontSize: 16.5, fontWeight: '700' },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  disabled: { opacity: 0.45 },
  secondary: { height: 50, borderRadius: radius.pill, borderWidth: 1, borderColor: '#26352C', alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryText: { color: colors.text, fontSize: 15.5, fontWeight: '500' },
  pressed: { opacity: 0.8 },
});
