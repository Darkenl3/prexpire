import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { accents, makeStyles, useTheme, type Accent } from '../theme';

// Building blocks of the Settings page: a section heading, a card that groups rows,
// and rows with a tinted icon, a title, a short description and a control.

export type { Accent };

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

// Groups rows in one card with hairline separators between them.
export function SettingsCard({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  const c = useTheme();
  const s = useStyles();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={[s.card, danger && { borderColor: c.dangerBorder, backgroundColor: c.dangerBg }]}>
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 && <View style={s.separator} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

type IconName = keyof typeof Ionicons.glyphMap;

export function IconTile({ icon, accent, size = 36 }: { icon: IconName; accent: Accent; size?: number }) {
  const s = useStyles();
  const hex = accents[accent];
  return (
    <View style={[s.icon, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: `${hex}1F`, borderColor: `${hex}3D` }]}>
      <Ionicons name={icon} size={size * 0.52} color={hex} />
    </View>
  );
}

type RowProps = {
  icon: IconName;
  accent: Accent;
  title: string;
  description?: string;
  // Control on the right: a toggle, a value, a button.
  right?: ReactNode;
  // Content under the title, e.g. a set of options or a status note.
  below?: ReactNode;
  // Makes the whole row a button with a chevron.
  onPress?: () => void;
  titleColor?: string;
};

export function SettingRow({ icon, accent, title, description, right, below, onPress, titleColor }: RowProps) {
  const c = useTheme();
  const s = useStyles();
  const body = (
    <View style={s.row}>
      <IconTile icon={icon} accent={accent} />
      <View style={s.rowText}>
        <Text style={[s.rowTitle, titleColor ? { color: titleColor } : null]}>{title}</Text>
        {!!description && <Text style={s.rowDesc}>{description}</Text>}
      </View>
      {right}
      {onPress && <Ionicons name="chevron-forward" size={18} color={c.textMuted} />}
    </View>
  );
  return (
    <View style={s.rowWrap}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityHint={description}
          style={({ pressed }) => [s.pressable, pressed && s.pressed]}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
      {below && <View style={s.below}>{below}</View>}
    </View>
  );
}

export function Toggle({ value, onChange, label, disabled = false }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const c = useTheme();
  const sw = c.switchColors;
  return (
    <Switch
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      accessibilityLabel={label}
      trackColor={{ false: sw.track, true: sw.trackOn }}
      thumbColor={value ? sw.thumbOn : sw.thumb}
      {...({ activeThumbColor: sw.thumbOn } as object)}
    />
  );
}

type Option<T> = { value: T; label: string; disabled?: boolean };

// A set of choices shown as chips: one is selected, like radio buttons.
export function Options<T extends string | number>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  const c = useTheme();
  const s = useStyles();
  return (
    <View style={s.options} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => !o.disabled && onChange(o.value)}
            disabled={o.disabled}
            accessibilityRole="radio"
            aria-checked={on}
            aria-disabled={!!o.disabled}
            accessibilityLabel={o.label}
            style={({ pressed }) => [s.chip, on && { borderColor: c.chipOnBorder, backgroundColor: c.chipOnBg }, o.disabled && s.chipDisabled, pressed && s.pressed]}
          >
            {on && <Ionicons name="checkmark" size={14} color={c.mint} />}
            <Text style={[s.chipText, on && s.chipTextOn, o.disabled && s.chipTextDisabled]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// A short status line under a row: neutral, positive or a warning.
export function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'ok' | 'warn' }) {
  const c = useTheme();
  const s = useStyles();
  const color = tone === 'ok' ? c.mint : tone === 'warn' ? c.amberText : c.textMuted;
  const icon: IconName = tone === 'ok' ? 'checkmark-circle' : tone === 'warn' ? 'alert-circle' : 'information-circle-outline';
  return (
    <View style={s.note}>
      <Ionicons name={icon} size={15} color={color} style={{ marginTop: 1 }} />
      <Text style={[s.noteText, { color: tone === 'muted' ? c.textMuted : color }]}>{children}</Text>
    </View>
  );
}

export function SmallButton({ label, onPress, icon, tone = 'neutral', disabled = false, accessibilityLabel }: { label: string; onPress: () => void; icon?: IconName; tone?: 'neutral' | 'mint' | 'danger'; disabled?: boolean; accessibilityLabel?: string }) {
  const c = useTheme();
  const s = useStyles();
  const color = tone === 'mint' ? c.mint : tone === 'danger' ? accents.red : c.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      aria-disabled={disabled}
      style={({ pressed }) => [
        s.button,
        tone === 'mint' && { borderColor: c.btnMintBorder, backgroundColor: c.btnMintBg },
        tone === 'danger' && { borderColor: c.btnDangerBorder, backgroundColor: c.btnDangerBg },
        disabled && s.chipDisabled,
        pressed && s.pressed,
      ]}
    >
      {icon && <Ionicons name={icon} size={16} color={color} />}
      <Text style={[s.buttonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  section: { marginBottom: 22 },
  sectionTitle: { color: c.textMuted, fontSize: 13, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.surfaceBorder, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: c.separator, marginLeft: 64 },
  rowWrap: { paddingVertical: 12, paddingHorizontal: 14 },
  pressable: { borderRadius: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 40 },
  icon: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: c.text, fontSize: 15.5, fontWeight: '600' },
  rowDesc: { color: c.textMuted, fontSize: 13, marginTop: 2, lineHeight: 18 },
  below: { marginTop: 10, marginLeft: 50, gap: 8 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c.cardAlt,
  },
  chipDisabled: { opacity: 0.45 },
  chipText: { color: c.textMuted, fontSize: 13.5, fontWeight: '500' },
  chipTextOn: { color: c.text, fontWeight: '600' },
  chipTextDisabled: { color: c.textMuted },
  note: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  noteText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c.cardAlt,
  },
  buttonText: { fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7 },
}));
