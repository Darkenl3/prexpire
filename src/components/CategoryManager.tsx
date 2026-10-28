import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { makeStyles, useTheme, LIGHT, CARD_SHADOW_LIFTED, type Tint } from '../theme';
import { CATEGORY_ICONS, CUSTOM_TINTS, useCategories } from '../categories';
import { useItems } from '../items';
import { Note, SmallButton } from './SettingsRows';

// Managing the user's custom categories ("category folders"): the list with
// delete buttons, and the "Add category" dialog with a name, an icon and a
// tile colour. Rendered inside the Settings page.

// Folder icon ink on the light theme's pastel chips (one per tile tint), so
// each folder keeps its colour language; the dark theme uses plain text ink.
const TINT_ICON: Record<Tint, string> = {
  food: '#0E8F6B',
  medicine: '#3B7BD4',
  household: '#8B5CF6',
  skincare: '#E255A0',
  pantry: '#C77E1E',
  add: '#5C6E6A',
};

export function CategoryManager() {
  const c = useTheme();
  const s = useStyles();
  const { custom, add, remove, saveError } = useCategories();
  const { saved } = useItems();
  const [adding, setAdding] = useState(false);
  // Two-tap delete: the button flips to "Remove?" and confirms on the second tap.
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!adding) setConfirming(null);
  }, [adding]);

  return (
    <View style={s.wrap}>
      {custom.map((cat) => {
        const count = saved.filter((i) => i.category === cat.id).length;
        // The folder's colour language, from the theme's tile tints: a soft
        // pastel chip on light, a whisper of the gradient on dark.
        const tint = c.tints[cat.tint as Tint];
        const iconBg = c === LIGHT ? tint.top : `${tint.top}33`;
        const iconBorder = c === LIGHT ? tint.border : `${tint.top}66`;
        const confirmingThis = confirming === cat.id;
        return (
          <View key={cat.id} style={s.row}>
            <View style={[s.rowIcon, { backgroundColor: iconBg, borderColor: iconBorder }]}>
              <Ionicons name={cat.icon as keyof typeof Ionicons.glyphMap} size={19} color={c === LIGHT ? TINT_ICON[cat.tint as Tint] : c.text} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.rowName} numberOfLines={1}>
                {cat.name}
              </Text>
              <Text style={s.rowSub}>{count === 1 ? '1 item' : `${count} items`}</Text>
            </View>
            <Pressable
              onPress={() => {
                if (confirmingThis) {
                  Haptics.selectionAsync().catch(() => {});
                  remove(cat.id);
                  setConfirming(null);
                } else {
                  Haptics.selectionAsync().catch(() => {});
                  setConfirming(cat.id);
                }
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={confirmingThis ? `Confirm removing ${cat.name}` : `Remove ${cat.name}`}
              style={({ pressed }) => [s.remove, confirmingThis && s.removeConfirm, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name={confirmingThis ? 'trash' : 'trash-outline'} size={17} color={confirmingThis ? c.red : c.textMuted} />
            </Pressable>
          </View>
        );
      })}
      <SmallButton label={custom.length ? 'Add another category' : 'Add category'} icon="add-circle-outline" tone="mint" onPress={() => setAdding(true)} />
      {saveError && <Note tone="warn">The last change couldn't be saved in this browser's storage. It applies until you close the page.</Note>}
      <AddCategoryDialog visible={adding} onClose={() => setAdding(false)} onAdd={(name, icon, tint) => !!add(name, icon, tint)} />
    </View>
  );
}

function AddCategoryDialog({ visible, onClose, onAdd }: { visible: boolean; onClose: () => void; onAdd: (name: string, icon: string, tint: Tint) => boolean }) {
  const c = useTheme();
  const s = useStyles();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(CATEGORY_ICONS[0]);
  const [tint, setTint] = useState<Tint>(CUSTOM_TINTS[0]);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setIcon(CATEGORY_ICONS[0]);
      setTint(CUSTOM_TINTS[0]);
      setRejected(false);
    }
  }, [visible]);

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed) {
      setRejected(true);
      return;
    }
    if (onAdd(trimmed, icon, tint)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onClose();
    } else {
      setRejected(true);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" importantForAccessibility="no" />
        <View style={s.dialog} accessibilityRole={'dialog' as never} accessibilityLabel="Add category" {...({ 'aria-modal': true } as object)}>
          <Text style={s.dialogTitle} accessibilityRole="header">
            New category
          </Text>
          <Text style={s.dialogText}>A folder for a group of items you track — its tile appears on Home.</Text>
          <TextInput
            value={name}
            onChangeText={(t) => {
              setName(t);
              setRejected(false);
            }}
            placeholder="Name, e.g. Pet food"
            placeholderTextColor={c.textMuted}
            style={[s.input, rejected && !trimmed && s.inputWarn]}
            maxLength={24}
            returnKeyType="done"
            accessibilityLabel="Category name"
            autoFocus
          />
          {rejected && !trimmed && <Text style={s.warn}>Give the category a name first.</Text>}
          <Text style={s.label}>Icon</Text>
          <View style={s.iconGrid}>
            {CATEGORY_ICONS.map((ic) => {
              const on = ic === icon;
              return (
                <Pressable
                  key={ic}
                  onPress={() => setIcon(ic)}
                  accessibilityRole="radio"
                  aria-checked={on}
                  accessibilityLabel={`Icon ${ic}`}
                  style={({ pressed }) => [s.iconCell, on && { borderColor: c.chipOnBorder, backgroundColor: c.chipOnBg }, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name={ic as keyof typeof Ionicons.glyphMap} size={20} color={on ? c.mint : c.textMuted} />
                </Pressable>
              );
            })}
          </View>
          <Text style={s.label}>Colour</Text>
          <View style={s.tintRow}>
            {CUSTOM_TINTS.map((t) => {
              const on = t === tint;
              const g = c.tints[t];
              return (
                <Pressable
                  key={t}
                  onPress={() => setTint(t)}
                  accessibilityRole="radio"
                  aria-checked={on}
                  accessibilityLabel={`Colour ${t}`}
                  style={({ pressed }) => [s.tintDot, on && s.tintDotOn, pressed && { opacity: 0.7 }]}
                >
                  <View style={[s.tintFill, { backgroundColor: g.top, borderColor: g.border }]} />
                </Pressable>
              );
            })}
          </View>
          <View style={s.dialogButtons}>
            <SmallButton label="Cancel" onPress={onClose} />
            <SmallButton label="Add category" icon="add-circle-outline" tone="mint" onPress={submit} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c.surface,
    ...(c === LIGHT ? { shadowColor: '#64748B', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } } : null),
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: { color: c.text, fontSize: 15.5, fontWeight: '600' },
  rowSub: { color: c.textMuted, fontSize: 12.5, marginTop: 1 },
  remove: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  removeConfirm: { backgroundColor: c.btnDangerBg, borderWidth: 1, borderColor: c.btnDangerBorder },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: c.dialogBg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    padding: 20,
    gap: 10,
    ...(c === LIGHT ? CARD_SHADOW_LIFTED : null),
  },
  dialogTitle: { color: c.text, fontSize: 20, fontWeight: '700', marginTop: 4 },
  dialogText: { color: c.textMuted, fontSize: 13.5, lineHeight: 18 },
  input: {
    color: c.text,
    fontSize: 16,
    fontWeight: '600',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c.cardAlt,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  inputWarn: { borderColor: c.amberText },
  warn: { color: c.amberText, fontSize: 12.5 },
  label: { color: c.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconCell: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tintRow: { flexDirection: 'row', gap: 10 },
  tintDot: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  tintDotOn: { borderColor: c.mint },
  tintFill: { width: 26, height: 26, borderRadius: 13, borderWidth: 1 },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 8 },
}));
