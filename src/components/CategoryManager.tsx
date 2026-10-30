import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useTheme, LIGHT, type Tint } from '../theme';
import { CATEGORY_ICONS, CUSTOM_TINTS, DEFAULT_CATEGORY_ICON, safeCategoryIcon, useCategories } from '../categories';
import { useItems } from '../items';
import { useSettings } from '../settings';
import { categories } from '../data';
import { Note, SmallButton } from './SettingsRows';
import { PressScale } from './Press';
import { GlassIconButton } from './HomeComponents';
import { categoryArt } from './ResultSheet';

// Managing the user's categories: the unified list (the built-ins they keep
// plus the folders they added, all removable), a restore section for the
// built-ins they removed, and the full-screen "New category" page.

// Folder icon ink on the light theme's pastel chips (one per tile tint), so
// each folder keeps its colour language; the dark theme uses plain text ink.
const TINT_ICON: Record<Tint, string> = {
  food: '#0E8F6B',
  medicine: '#3B7BD4',
  household: '#8B5CF6',
  skincare: '#E255A0',
  pantry: '#C77E1E',
  forest: '#17805A',
  ocean: '#2D6FA3',
  teal: '#2E8A8F',
  lavender: '#6D5BC4',
  rose: '#C2447A',
  coral: '#C05E2D',
  sand: '#96803F',
  slate: '#5B6B77',
  add: '#5C6E6A',
};

// The built-in category definitions (id, tile tint, artwork), for the rows.
const BUILTINS = categories.filter((x) => x.tint !== 'add');

// True while running inside the native Expo shell: its floating glass tab bar
// sits over the page, so the full-screen page keeps extra room at the bottom.
const SHELL = Platform.OS === 'web' && typeof window !== 'undefined' && !!(window as { ReactNativeWebView?: unknown }).ReactNativeWebView;

export function CategoryManager() {
  const c = useTheme();
  const s = useStyles();
  const { all, custom, removed, add, remove, restore, saveError } = useCategories();
  const { saved } = useItems();
  const { settings, update } = useSettings();
  const [adding, setAdding] = useState(false);
  // Two-tap delete: the button flips to "Remove?" and confirms on the second tap.
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!adding) setConfirming(null);
  }, [adding]);

  const doRemove = (id: string) => {
    remove(id);
    // A default that pointed at the removed category falls back to "last used".
    if (settings.defaultCategory === id) update({ defaultCategory: 'last' });
  };

  const countFor = (id: string) => saved.filter((i) => i.category === id).length;

  // One row shape for every category the user keeps, built-in or their own.
  const renderRow = (id: string, name: string, isCustom: boolean) => {
    const folder = custom.find((x) => x.id === id);
    const def = BUILTINS.find((x) => x.id === id);
    const tint: Tint = isCustom && folder ? folder.tint : def ? def.tint : 'add';
    const g = c.tints[tint];
    const iconBg = c === LIGHT ? g.top : `${g.top}33`;
    const iconBorder = c === LIGHT ? g.border : `${g.top}66`;
    const confirmingThis = confirming === id;
    return (
      <View key={id} style={s.row}>
        <View style={[s.rowIcon, { backgroundColor: iconBg, borderColor: iconBorder }]}>
          {def ? categoryArt(id, 24) : (
            <Ionicons name={safeCategoryIcon(folder?.icon ?? DEFAULT_CATEGORY_ICON) as keyof typeof Ionicons.glyphMap} size={19} color={c === LIGHT ? TINT_ICON[tint] : c.text} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.rowName} numberOfLines={1}>
            {name}
          </Text>
          <Text style={s.rowSub}>
            {def ? 'Default category' : 'Your folder'} · {countFor(id) === 1 ? '1 item' : `${countFor(id)} items`}
          </Text>
        </View>
        <PressScale
          onPress={() => {
            if (confirmingThis) {
              Haptics.selectionAsync().catch(() => {});
              doRemove(id);
              setConfirming(null);
            } else {
              Haptics.selectionAsync().catch(() => {});
              setConfirming(id);
            }
          }}
          hitSlop={8}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel={confirmingThis ? `Confirm removing ${name}` : `Remove ${name}`}
          style={[s.remove, confirmingThis && s.removeConfirm]}
        >
          <Ionicons name={confirmingThis ? 'trash' : 'trash-outline'} size={17} color={confirmingThis ? c.red : c.textMuted} />
        </PressScale>
      </View>
    );
  };

  return (
    <View style={s.wrap}>
      {all.map((cat) => renderRow(cat.id, cat.name, cat.custom))}
      {removed.length > 0 && (
        <View style={s.removedWrap}>
          <Text style={s.removedTitle}>Removed</Text>
          {removed.map((id) => {
            const def = BUILTINS.find((x) => x.id === id);
            if (!def) return null;
            const count = countFor(id);
            return (
              <View key={id} style={s.rowRemoved}>
                <View style={[s.rowIcon, { backgroundColor: c === LIGHT ? c.cardAlt : `${c.surfaceBorder}55`, borderColor: c.surfaceBorder }]}>
                  {categoryArt(id, 22)}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowNameRemoved} numberOfLines={1}>
                    {def.name}
                  </Text>
                  <Text style={s.rowSub}>{count === 1 ? '1 item still filed here' : `${count} items still filed here`}</Text>
                </View>
                <SmallButton
                  label="Restore"
                  icon="return-up-back-outline"
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    restore(id);
                  }}
                />
              </View>
            );
          })}
        </View>
      )}
      <SmallButton label="Add category" icon="add-circle-outline" tone="mint" onPress={() => setAdding(true)} />
      {saveError && <Note tone="warn">The last change couldn't be saved in this browser's storage. It applies until you close the page.</Note>}
      <NewCategoryPage visible={adding} onClose={() => setAdding(false)} onAdd={(name, icon, tint) => !!add(name, icon, tint)} />
    </View>
  );
}

// The full-screen "New category" page: a name, an icon and a tile colour get
// room to breathe (the compact dialog these used to squeeze into is gone).
// It slides up over the app, keeps its own back button and primary action,
// and pads its bottom for the shell's floating glass bar. The keyboard stays
// closed until the user actually taps the name field - no autofocus, no
// programmatic focus, no flicker - and the layout keeps its place when the
// keyboard opens (iOS padding) so the actions are never covered.
function NewCategoryPage({ visible, onClose, onAdd }: { visible: boolean; onClose: () => void; onAdd: (name: string, icon: string, tint: Tint) => boolean }) {
  const c = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string>(DEFAULT_CATEGORY_ICON);
  const [tint, setTint] = useState<Tint>(CUSTOM_TINTS[0]);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setIcon(DEFAULT_CATEGORY_ICON);
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
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={[s.page, { paddingTop: Math.max(insets.top, 10) }]}>
          <View style={s.pageHeader}>
            {/* A proper 42pt glass circle (the old width-override left it a
                touch oval); the spacer opposite keeps the title centred. */}
            <GlassIconButton icon="chevron-back" iconSize={22} size={42} label="Cancel" onPress={onClose} />
            <Text style={s.pageTitle} accessibilityRole="header">
              New category
            </Text>
            <View style={s.backBtn} />
          </View>
          <ScrollView
            style={s.pageScroll}
            contentContainerStyle={[s.pageBody, { paddingBottom: Math.max(insets.bottom, 20) + (SHELL ? 96 : 16) }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={s.pageIntro}>A folder for a group of items you track. Its tile appears on Home, right after the ones you already keep.</Text>
            <Text style={s.label}>Name</Text>
            {/* Deliberately NOT autofocused: the keyboard opens only when the
                user taps this field. Typed text survives keyboard dismissals
                (and rerenders) untouched, because the value lives here. */}
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
            />
            {rejected && !trimmed && <Text style={s.warn}>Give the category a name first.</Text>}
            <Text style={s.label}>Icon</Text>
            <View style={s.iconGrid}>
              {CATEGORY_ICONS.map((ic) => {
                const on = ic === icon;
                return (
                  <PressScale
                    key={ic}
                    onPress={() => setIcon(ic)}
                    scaleTo={0.97}
                    accessibilityRole="radio"
                    aria-checked={on}
                    accessibilityLabel={`Icon ${ic}`}
                    style={[s.iconCell, on && { borderColor: c.chipOnBorder, backgroundColor: c.chipOnBg }]}
                  >
                    <Ionicons name={ic as keyof typeof Ionicons.glyphMap} size={22} color={on ? c.mint : c.textMuted} />
                  </PressScale>
                );
              })}
            </View>
            <Text style={s.label}>Colour</Text>
            <View style={s.tintRow}>
              {CUSTOM_TINTS.map((t) => {
                const on = t === tint;
                const g = c.tints[t];
                return (
                  <PressScale
                    key={t}
                    onPress={() => setTint(t)}
                    scaleTo={0.97}
                    accessibilityRole="radio"
                    aria-checked={on}
                    accessibilityLabel={`Colour ${t}`}
                    style={[s.tintDot, on && s.tintDotOn]}
                  >
                    <View style={[s.tintFill, { backgroundColor: g.top, borderColor: g.border }]}>
                      {on && <Ionicons name="checkmark" size={17} color={c === LIGHT ? TINT_ICON[t] : c.text} />}
                    </View>
                  </PressScale>
                );
              })}
            </View>
            <View style={s.pageActions}>
              <SmallButton label="Cancel" onPress={onClose} />
              <SmallButton label="Add category" icon="add-circle-outline" tone="mint" onPress={submit} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { gap: 8, marginTop: 4 },
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
    borderWidth: 1,
  },
  rowName: { color: c.text, fontSize: 15.5, fontWeight: '600' },
  rowSub: { color: c.textMuted, fontSize: 12.5, marginTop: 1 },
  remove: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  removeConfirm: { backgroundColor: c.btnDangerBg, borderWidth: 1, borderColor: c.btnDangerBorder },
  // Removed built-ins: still listed (their items keep their label), restorable
  // in one tap. No delete button; restoring is the only action.
  removedWrap: { marginTop: 8, gap: 8 },
  removedTitle: { color: c.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: 2 },
  rowRemoved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c === LIGHT ? c.cardAlt : 'transparent',
    opacity: 0.85,
  },
  rowNameRemoved: { color: c.textMuted, fontSize: 15.5, fontWeight: '600' },
  // The full-screen page.
  page: { flex: 1, backgroundColor: c.bg },
  pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, height: 52 },
  // A spacer the width of the glass back button, balancing the title.
  backBtn: { width: 42 },
  pageTitle: { color: c.text, fontSize: 17, fontWeight: '700' },
  pageScroll: { flex: 1 },
  pageBody: { paddingHorizontal: 20, gap: 10, paddingTop: 4 },
  pageIntro: { color: c.textMuted, fontSize: 13.5, lineHeight: 18, marginBottom: 6 },
  input: {
    color: c.text,
    fontSize: 17,
    fontWeight: '600',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c.cardAlt,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputWarn: { borderColor: c.amberText },
  warn: { color: c.amberText, fontSize: 12.5 },
  label: { color: c.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  iconCell: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tintRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  tintDot: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  tintDotOn: { borderColor: c.mint },
  tintFill: { width: 30, height: 30, borderRadius: 15, borderWidth: 1 },
  pageActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
}));
