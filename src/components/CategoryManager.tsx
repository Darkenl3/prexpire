import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, ScrollView, StyleSheet, Text, TextInput, View, type PanResponderInstance } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useTheme, LIGHT, type Tint } from '../theme';
import { CATEGORY_ICONS, CATEGORY_ICON_LABELS, CUSTOM_TINTS, DEFAULT_CATEGORY_ICON, presetIcon, presetTint, useCategories } from '../categories';
import { IconArt } from './IconArt';
import { useItems } from '../items';
import { useSettings } from '../settings';
import { categories } from '../data';
import { Note, SmallButton } from './SettingsRows';
import { PressScale } from './Press';
import { CategoryTile, GlassIconButton } from './HomeComponents';
import { categoryArt } from './ResultSheet';
import { ChoicePill, type PillColors } from './ChoicePill';
import { OPEN_DAY_CHOICES, OPEN_DAYS_DEFAULT, OPEN_DAYS_FALLBACK, WARNING_DAYS, type WarningDays } from '../preferences';
import { usePro, useProLimits } from '../pro';

// Managing the user's categories: the unified list (the built-ins they keep
// plus the folders they added, in the user's order, all removable), a
// restore section for the built-ins they removed, and the full-screen page
// that creates a category or edits one (tap a row).

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
  sky: '#2A86C9',
  mint: '#1C9A7C',
  lime: '#6E9A1F',
  sunflower: '#B58A0A',
  cherry: '#C8323F',
  plum: '#8E3E9C',
  indigo: '#4352C2',
  graphite: '#56606B',
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
  const { all, custom, removed, add, edit, move, moveTo, remove, restore, saveError, lookOf } = useCategories();
  const { openPaywall } = usePro();
  const { categoriesLocked } = useProLimits(0, custom.length);
  const { saved, moveCategory } = useItems();
  const { settings, update } = useSettings();
  const [adding, setAdding] = useState(false);
  // The category being edited (its page is open), or null.
  const [editing, setEditing] = useState<string | null>(null);
  // A category with items the user is removing: asked where its items go.
  const [moving, setMoving] = useState<string | null>(null);
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

  // ── Drag to reorder ──
  // Hold the grip on a row and drag: the row follows the finger, lifted, and
  // the rows it passes slide out of its way (one row's height each, with a
  // light tick); letting go drops it there. The responders are made once per
  // row and read everything through refs, so re-renders mid-drag never drop
  // the gesture.
  const allRef = useRef(all);
  allRef.current = all;
  const moveToRef = useRef(moveTo);
  moveToRef.current = moveTo;
  // One row's height plus the list's gap, measured from the first row.
  const pitch = useRef(64);
  const dragY = useRef(new Animated.Value(0)).current;
  const shifts = useRef(new Map<string, Animated.Value>()).current;
  const shiftOf = (id: string) => {
    let v = shifts.get(id);
    if (!v) {
      v = new Animated.Value(0);
      shifts.set(id, v);
    }
    return v;
  };
  const [dragging, setDragging] = useState<string | null>(null);
  const resetPending = useRef(false);
  useLayoutEffect(() => {
    if (!resetPending.current) return;
    resetPending.current = false;
    dragY.setValue(0);
    shifts.forEach((v) => v.setValue(0));
    settling.current = false;
  }, [all, dragging, dragY, shifts]);
  const drag = useRef<{ id: string; from: number; to: number } | null>(null);
  // True from a drop until the new order is in place. A second drag started
  // in that window began from the old positions: rows landed on top of each
  // other, then jumped when the first move finished. It waits instead.
  const settling = useRef(false);
  const responders = useRef(new Map<string, PanResponderInstance>()).current;
  const responderFor = (id: string) => {
    let r = responders.get(id);
    if (r) return r;
    const settleOthers = (from: number, to: number) => {
      allRef.current.forEach((cat, i) => {
        if (cat.id === id) return;
        const shift = from < i && i <= to ? -pitch.current : to <= i && i < from ? pitch.current : 0;
        Animated.spring(shiftOf(cat.id), { toValue: shift, damping: 24, stiffness: 320, useNativeDriver: true }).start();
      });
    };
    const drop = () => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      settling.current = true;
      Animated.spring(dragY, { toValue: (d.to - d.from) * pitch.current, damping: 26, stiffness: 340, useNativeDriver: true }).start(() => {
        // The new order and the cleared offsets must land in the SAME frame:
        // the offsets are cleared by the layout effect below, after the list
        // has rendered in its new order and before it is painted. (Clearing
        // them a frame early or late made the rows jump.)
        resetPending.current = true;
        if (d.to !== d.from) moveToRef.current(d.id, d.to);
        setDragging(null);
      });
    };
    r = PanResponder.create({
      onStartShouldSetPanResponder: () => !settling.current && !drag.current,
      onMoveShouldSetPanResponder: () => !settling.current && !drag.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        if (settling.current || drag.current) return;
        const from = allRef.current.findIndex((x) => x.id === id);
        if (from < 0) return;
        drag.current = { id, from, to: from };
        dragY.setValue(0);
        setConfirming(null);
        setDragging(id);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      },
      onPanResponderMove: (_e, g) => {
        const d = drag.current;
        if (!d) return;
        const last = allRef.current.length - 1;
        // The row cannot be dragged past the ends of the list.
        const dy = Math.max(-d.from * pitch.current, Math.min((last - d.from) * pitch.current, g.dy));
        dragY.setValue(dy);
        const to = Math.max(0, Math.min(last, d.from + Math.round(dy / pitch.current)));
        if (to !== d.to) {
          d.to = to;
          Haptics.selectionAsync().catch(() => {});
          settleOthers(d.from, to);
        }
      },
      onPanResponderRelease: drop,
      onPanResponderTerminate: drop,
    });
    responders.set(id, r);
    return r;
  };

  // One row shape for every category the user keeps, built-in or their own:
  // tap it to edit, drag its grip to move it (the Home grid and every list
  // follow this order), the bin removes it.
  const renderRow = (id: string, name: string, isCustom: boolean, index: number) => {
    const folder = custom.find((x) => x.id === id);
    const def = BUILTINS.find((x) => x.id === id);
    const tint: Tint = isCustom && folder ? folder.tint : def ? (lookOf(id).tint ?? def.tint) : 'add';
    const g = c.tints[tint];
    const iconBg = c === LIGHT ? g.top : `${g.top}33`;
    const iconBorder = c === LIGHT ? g.border : `${g.top}66`;
    const confirmingThis = confirming === id;
    const lifted = dragging === id;
    return (
      <Animated.View
        key={id}
        onLayout={index === 0 ? (e) => (pitch.current = e.nativeEvent.layout.height + 8) : undefined}
        style={[
          s.row,
          { transform: [{ translateY: lifted ? dragY : shiftOf(id) }, { scale: lifted ? 1.02 : 1 }] },
          lifted && s.rowLifted,
        ]}
      >
        <PressScale
          onPress={() => {
            setConfirming(null);
            setEditing(id);
          }}
          scaleTo={0.99}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${name}`}
          style={s.rowMain}
        >
          <View style={[s.rowIcon, { backgroundColor: iconBg, borderColor: iconBorder }]}>
            {def ? categoryArt(id, 24) : <IconArt icon={folder?.icon ?? DEFAULT_CATEGORY_ICON} size={24} />}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.rowName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={s.rowSub} numberOfLines={1}>
              {countFor(id) === 1 ? '1 item' : `${countFor(id)} items`}
            </Text>
          </View>
        </PressScale>
        {/* The grip: hold and drag to reorder. Screen readers move the row
            one place with the adjust actions instead. */}
        <View
          {...responderFor(id).panHandlers}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Reorder ${name}`}
          accessibilityActions={[
            { name: 'increment', label: 'Move down' },
            { name: 'decrement', label: 'Move up' },
          ]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment' && index < all.length - 1) move(id, 1);
            if (e.nativeEvent.actionName === 'decrement' && index > 0) move(id, -1);
          }}
          {...({ style: [s.grip, Platform.OS === 'web' ? ({ cursor: lifted ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none' } as object) : null] } as object)}
        >
          <Ionicons name="reorder-three" size={22} color={lifted ? c.green : c.textMuted} />
        </View>
        <PressScale
          onPress={() => {
            if (confirmingThis) {
              Haptics.selectionAsync().catch(() => {});
              setConfirming(null);
              // Items in it: ask where they go first.
              if (countFor(id) > 0) setMoving(id);
              else doRemove(id);
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
      </Animated.View>
    );
  };

  return (
    <View style={s.wrap}>
      {all.map((cat, i) => renderRow(cat.id, cat.name, cat.custom, i))}
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
      <SmallButton label="Add category" icon="add-circle-outline" tone="mint" onPress={() => (categoriesLocked ? openPaywall('categories') : setAdding(true))} />
      {(() => {
        const from = all.find((x) => x.id === moving);
        if (!from) return null;
        const n = countFor(from.id);
        const close = () => setMoving(null);
        const finish = async (to: string | null) => {
          close();
          Haptics.selectionAsync().catch(() => {});
          if (to) await moveCategory(from.id, to).catch(() => {});
          doRemove(from.id);
        };
        return (
          <Modal visible transparent animationType="fade" onRequestClose={close}>
            <PressScale onPress={close} scaleTo={1} style={s.scrim} accessibilityLabel="Close">
              <View />
            </PressScale>
            <View style={s.dialogWrap} pointerEvents="box-none">
              <View style={s.dialog} accessibilityRole={'dialog' as never}>
                <Text style={s.dialogTitle}>Remove {from.name}?</Text>
                <Text style={s.dialogText}>
                  {n === 1 ? 'It has 1 item.' : `It has ${n} items.`} Move {n === 1 ? 'it' : 'them'} to:
                </Text>
                <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: 6 }}>
                  {all
                    .filter((x) => x.id !== from.id)
                    .map((x) => (
                      <PressScale key={x.id} onPress={() => void finish(x.id)} scaleTo={0.98} style={s.dialogRow} accessibilityRole="button" accessibilityLabel={`Move to ${x.name}`}>
                        <Ionicons name="folder-open-outline" size={18} color={c.green} />
                        <Text style={s.dialogRowText} numberOfLines={1}>
                          {x.name}
                        </Text>
                      </PressScale>
                    ))}
                </ScrollView>
                <PressScale onPress={() => void finish(null)} scaleTo={0.98} style={s.dialogRow} accessibilityRole="button">
                  <Ionicons name="trash-outline" size={18} color={c.red} />
                  <Text style={[s.dialogRowText, { color: c.red }]} numberOfLines={2}>
                    {from.custom ? 'Remove anyway (items show as "Other")' : 'Remove, keep items filed (restore later)'}
                  </Text>
                </PressScale>
                <View style={{ alignItems: 'flex-end', marginTop: 4 }}>
                  <SmallButton label="Cancel" onPress={close} />
                </View>
              </View>
            </View>
          </Modal>
        );
      })()}
      {saveError && <Note tone="warn">The last change couldn't be saved in this browser's storage. It applies until you close the page.</Note>}
      <CategoryPage visible={adding} onClose={() => setAdding(false)} onSave={(name, icon, tint) => add(name, icon, tint)?.id ?? null} />
      {(() => {
        const cat = all.find((x) => x.id === editing);
        const folder = custom.find((x) => x.id === editing);
        return (
          <CategoryPage
            visible={!!cat}
            editing={
              cat
                ? folder
                  ? { id: cat.id, name: cat.name, icon: folder.icon, tint: folder.tint, builtin: false }
                  : { id: cat.id, name: cat.name, icon: lookOf(cat.id).icon ?? presetIcon(cat.id), tint: lookOf(cat.id).tint ?? presetTint(cat.id), builtin: true }
                : undefined
            }
            onClose={() => setEditing(null)}
            onSave={(name, icon, tint) => (editing && edit(editing, { name, icon, tint }) ? editing : null)}
          />
        );
      })()}
    </View>
  );
}

// The full-screen category page, "New category" or "Edit category": a name,
// an icon and a tile colour get room to breathe (the compact dialog these
// used to squeeze into is gone). A built-in being edited shows only its name:
// its artwork and colour are part of it.
// It slides up over the app, keeps its own back button and primary action,
// and pads its bottom for the shell's floating glass bar. The keyboard stays
// closed until the user actually taps the name field - no autofocus, no
// programmatic focus, no flicker - and the layout keeps its place when the
// keyboard opens (iOS padding) so the actions are never covered.
type Editing = { id: string; name: string; icon?: string; tint?: Tint; builtin: boolean };

// How the category's tile will look on Home, live: the chosen colour, the
// chosen icon's picture and the name as it's typed. Changing the colour or
// icon gives the tile a soft settle so the change is easy to see.
function TilePreview({ tint, icon, name, art }: { tint: Tint; icon: string; name: string; art?: ReactNode }) {
  const s = useStyles();
  const { motion } = useSettings();
  const bump = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!motion) return;
    bump.setValue(0.95);
    Animated.spring(bump, { toValue: 1, damping: 14, stiffness: 260, mass: 0.7, useNativeDriver: true }).start();
  }, [tint, icon, motion, bump]);
  return (
    <View style={s.previewWrap} accessible accessibilityLabel={`Preview of the ${name} tile on Home`}>
      <Animated.View style={{ transform: [{ scale: bump }] }} pointerEvents="none">
        <CategoryTile tint={tint} art={art ?? <IconArt icon={icon || DEFAULT_CATEGORY_ICON} size={64} />} name={name} sub="0 items" status={{ label: 'All good', tone: 'green' }} width={150} onPress={() => {}} />
      </Animated.View>
      <Text style={s.previewCaption}>How it looks on Home</Text>
    </View>
  );
}

// The page's choice pills: the app's own (the Items filters, the save sheet).
function pagePills(c: ReturnType<typeof useTheme>): PillColors {
  return { offBg: c.cardAlt, offBorder: c.surfaceBorder, offText: c.textMuted, onBg: c.mint, onBorder: c.mint, onText: c.scanInk };
}

function CategoryPage({
  visible,
  editing,
  onClose,
  onSave,
}: {
  visible: boolean;
  editing?: Editing;
  onClose: () => void;
  // Saves the category and returns its id (null when refused).
  onSave: (name: string, icon: string, tint: Tint) => string | null;
}) {
  const c = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [nameFocused, setNameFocused] = useState(false);
  const [icon, setIcon] = useState<string>(DEFAULT_CATEGORY_ICON);
  const [tint, setTint] = useState<Tint>(CUSTOM_TINTS[0]);
  const [rejected, setRejected] = useState(false);
  const { settings, update } = useSettings();
  // This category's own warning period ('general' follows Settings), and how
  // long an opened product of it stays good.
  const [warn, setWarn] = useState<WarningDays | 'general'>('general');
  const [open, setOpen] = useState(OPEN_DAYS_FALLBACK);

  // Filled once each time the page opens (later re-renders never reset what
  // the user is typing).
  useEffect(() => {
    if (visible) {
      setName(editing?.name ?? '');
      setIcon(editing?.icon ?? DEFAULT_CATEGORY_ICON);
      setTint(editing?.tint ?? CUSTOM_TINTS[0]);
      setRejected(false);
      setWarn((editing && settings.categoryWarning[editing.id]) ?? 'general');
      setOpen((editing && (settings.openDays[editing.id] ?? OPEN_DAYS_DEFAULT[editing.id])) ?? OPEN_DAYS_FALLBACK);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const builtin = !!editing?.builtin;

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed) {
      setRejected(true);
      return;
    }
    const id = onSave(trimmed, icon, tint);
    if (id) {
      const categoryWarning = { ...settings.categoryWarning };
      if (warn === 'general') delete categoryWarning[id];
      else categoryWarning[id] = warn;
      update({ categoryWarning, openDays: { ...settings.openDays, [id]: open } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onClose();
    } else {
      setRejected(true);
    }
  };

  return (
    // Fades in like Settings' own pages: a slide made the back button (drawn
    // natively in the iPhone app, at the page's position) travel up with it.
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={[s.page, { paddingTop: Math.max(insets.top, 10) }]}>
          <View style={s.pageHeader}>
            {/* A proper 42pt glass circle (the old width-override left it a
                touch oval); the spacer opposite keeps the title centred. */}
            <GlassIconButton icon="chevron-back" iconSize={22} size={42} label="Cancel" onPress={onClose} />
            <Text style={s.pageTitle} accessibilityRole="header">
              {editing ? 'Edit category' : 'New category'}
            </Text>
            <View style={s.backBtn} />
          </View>
          <ScrollView
            style={s.pageScroll}
            contentContainerStyle={[s.pageBody, { paddingBottom: Math.max(insets.bottom, 20) + (SHELL ? 96 : 16) }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Text style={s.pageIntro}>
              {!editing
                ? 'A folder for a group of items you track. Its tile appears on Home, right after the ones you already keep.'
                : builtin
                  ? 'Choose a different icon or colour for this category. Its name stays the same, and every item in it keeps its place.'
                  : 'Change the name, icon or colour. Every item in this folder stays in it.'}
            </Text>
            <TilePreview tint={tint} icon={icon} name={trimmed || 'New category'} />
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
              // The box itself shows it is active (lime edge), not a ring inside it.
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              style={[s.input, nameFocused && { borderColor: c.chipOnBorder }, rejected && !trimmed && s.inputWarn, builtin && s.inputLocked]}
              // A preset's name is fixed.
              editable={!builtin}
              maxLength={24}
              returnKeyType="done"
              accessibilityLabel="Category name"
            />
            {rejected && !trimmed && <Text style={s.warn}>Give the category a name first.</Text>}
            {builtin && <Text style={s.hint}>Preset categories keep their name.</Text>}
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
                    accessibilityLabel={`Icon: ${CATEGORY_ICON_LABELS[ic]}`}
                    style={[s.iconCell, on && { borderColor: c.tints[tint].border, backgroundColor: c === LIGHT ? c.tints[tint].top : `${c.tints[tint].top}55` }]}
                  >
                    <View style={{ opacity: on ? 1 : 0.78 }}>
                      <IconArt icon={ic} size={30} />
                    </View>
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
            <Text style={s.label}>Warning period</Text>
            <Text style={s.hint}>How early items here show as expiring, get their first reminder, and join your Shopping List.</Text>
            <View style={s.pillRow}>
              {(['general', ...WARNING_DAYS] as const).map((w) => (
                <ChoicePill
                  key={String(w)}
                  label={w === 'general' ? `Same as app (${settings.warningDays} days)` : `${w} days`}
                  selected={warn === w}
                  onPress={() => setWarn(w)}
                  colors={pagePills(c)}
                  size="small"
                />
              ))}
            </View>
            <Text style={s.label}>Once opened, use within</Text>
            <Text style={s.hint}>When you mark an item here as opened, its date moves to this many days from that day (never later than the printed date).</Text>
            <View style={s.pillRow}>
              {OPEN_DAY_CHOICES.map((d) => (
                <ChoicePill
                  key={d}
                  label={d === 1 ? '1 day' : `${d} days`}
                  selected={open === d}
                  onPress={() => setOpen(d)}
                  colors={pagePills(c)}
                  size="small"
                />
              ))}
            </View>
            <View style={s.pageActions}>
              <SmallButton label="Cancel" onPress={onClose} />
              {editing ? (
                <SmallButton label="Save changes" icon="checkmark-circle-outline" tone="mint" onPress={submit} />
              ) : (
                <SmallButton label="Add category" icon="add-circle-outline" tone="mint" onPress={submit} />
              )}
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
    gap: 4,
    padding: 12,
    paddingRight: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c.surface,
    ...(c === LIGHT ? { shadowColor: '#64748B', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } } : null),
  },
  // The "where do its items go" dialog.
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  dialogWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 380, borderRadius: 20, padding: 18, gap: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.surfaceBorder },
  dialogTitle: { color: c.text, fontSize: 17, fontWeight: '700' },
  dialogText: { color: c.textMuted, fontSize: 13.5, lineHeight: 18 },
  dialogRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.cardAlt },
  dialogRowText: { color: c.text, fontSize: 15, fontWeight: '600', flex: 1 },
  // The tappable part of a row (icon and text) opens the edit page.
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  grip: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
  // The row being dragged floats above the others.
  rowLifted: {
    zIndex: 10,
    borderColor: c.chipOnBorder,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
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
  pageIntro: { color: c.textBody, fontSize: 13.5, lineHeight: 18, marginBottom: 6 },
  inputLocked: { opacity: 0.6 },
  previewWrap: { alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 4 },
  previewCaption: { color: c.textMuted, fontSize: 12.5, fontWeight: '600' },
  input: {
    color: c.text,
    fontSize: 17,
    fontWeight: '600',
    borderRadius: 16,
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
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tintRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hint: { color: c.textMuted, fontSize: 12.5, lineHeight: 17, marginTop: -4 },
  tintDot: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  tintDotOn: { borderColor: c.mint },
  // The swatch centres its checkmark (it used to sit in the top-left corner).
  tintFill: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  pageActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
}));
