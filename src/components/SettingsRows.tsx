import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { accents, makeStyles, useTheme, LIGHT, CARD_SHADOW, type Accent } from '../theme';

// Building blocks of the Settings page, styled after the reference's grouped
// card design: white cards on a cool-white page, fine #E5EDF3 hairlines, soft
// pastel icon tiles, crisp SF-style typography and gentle press feedback.

export type { Accent };

type IconName = keyof typeof Ionicons.glyphMap;

// Each accent's soft pastel tile (light theme). Dark keeps a whisper of the
// accent colour on its own surfaces.
const TILE_BG: Record<Accent, string> = {
  amber: '#FEF3D9',
  purple: '#EFEAFB',
  mint: '#D9FBF0',
  blue: '#E3EEFB',
  teal: '#E0F5F4',
  pink: '#FDEAF3',
  red: '#FDE8EA',
};

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

// Groups rows in one card with fine separators between them (aligned with the
// text column, never under the icons, and none after the last row).
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

// A crisp outline icon in its softly coloured rounded-square tile.
export function IconTile({ icon, accent, size = 52 }: { icon: IconName; accent: Accent; size?: number }) {
  const c = useTheme();
  const s = useStyles();
  const hex = accents[accent];
  const bg = c === LIGHT ? TILE_BG[accent] : `${hex}26`;
  return (
    <View style={[s.icon, { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: bg }]}>
      <Ionicons name={icon} size={Math.round(size * 0.5)} color={hex} />
    </View>
  );
}

type RowProps = {
  icon: IconName;
  accent: Accent;
  title: string;
  description?: string;
  // A short value shown before the chevron, e.g. "3 days".
  value?: string;
  // Control on the right: a toggle, a badge, a button.
  right?: ReactNode;
  // Content under the row (detail pages), e.g. a set of options or a note.
  below?: ReactNode;
  // Makes the whole row a button with a chevron.
  onPress?: () => void;
  titleColor?: string;
};

export function SettingRow({ icon, accent, title, description, value, right, below, onPress, titleColor }: RowProps) {
  const c = useTheme();
  const s = useStyles();
  const body = (
    <View style={s.row}>
      <IconTile icon={icon} accent={accent} />
      <View style={s.rowText}>
        <Text style={[s.rowTitle, titleColor ? { color: titleColor } : null]} numberOfLines={1}>
          {title}
        </Text>
        {!!description && <Text style={s.rowDesc} numberOfLines={2}>
          {description}
        </Text>}
      </View>
      {!!value && !right && <Text style={s.rowValue} numberOfLines={1}>
        {value}
      </Text>}
      {right}
      {onPress && <Ionicons name="chevron-forward" size={18} color={c.textMuted} style={s.chevron} />}
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
          style={({ pressed }) => [s.pressable, pressed && s.rowPressed]}
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

// A compact rounded status badge, e.g. "Off" or "Up to date".
export function StatusBadge({ label, tone = 'muted', check = false }: { label: string; tone?: 'green' | 'amber' | 'muted'; check?: boolean }) {
  const s = useStyles();
  return (
    <View style={[s.badge, tone === 'green' && s.badgeGreen, tone === 'amber' && s.badgeAmber]} accessibilityRole="text" accessibilityLabel={label}>
      {check && tone === 'green' && <Ionicons name="checkmark" size={13} color="#00A86B" />}
      <Text style={[s.badgeText, tone === 'green' && s.badgeTextGreen, tone === 'amber' && s.badgeTextAmber]}>{label}</Text>
    </View>
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

// A list of choices as full-width rows with a green checkmark on the selected
// one — the iOS-style picker used inside Settings detail pages.
export function OptionList<T extends string | number>({ label, options, value, onChange }: { label: string; options: Option<T>[]; value: T; onChange: (v: T) => void }) {
  const c = useTheme();
  const s = useStyles();
  return (
    <View style={s.optionList} accessibilityRole="radiogroup" accessibilityLabel={label}>
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
            style={({ pressed }) => [s.optionRow, o.disabled && s.chipDisabled, pressed && s.rowPressed]}
          >
            <Text style={[s.optionText, o.disabled && s.chipTextDisabled]}>{o.label}</Text>
            {on && <Ionicons name="checkmark" size={19} color={c.mint} />}
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
  const color = tone === 'mint' ? accents.mint : tone === 'danger' ? accents.red : c.text;
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
  section: { marginBottom: 24 },
  // Section headings sit just above their card, slightly inset from its edge.
  sectionTitle: { color: c.textMuted, fontSize: 16, fontWeight: '600', letterSpacing: 0.1, marginBottom: 8, marginLeft: 6 },
  // White cards with a fine hairline and the reference's soft floating shadow
  // (light); dark keeps its flat surface + hairline.
  card: {
    backgroundColor: c.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    overflow: 'hidden',
    ...(c === LIGHT ? CARD_SHADOW : null),
  },
  // Separators start after the icon tile, aligned with the title text.
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: c.separator, marginLeft: 82 },
  rowWrap: { paddingHorizontal: 16, paddingVertical: 12 },
  pressable: { borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 52 },
  icon: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: c.text, fontSize: 16.5, fontWeight: '600' },
  rowDesc: { color: c.textMuted, fontSize: 14, marginTop: 2, lineHeight: 19 },
  rowValue: { color: c.textMuted, fontSize: 15, fontWeight: '500', marginLeft: 8 },
  chevron: { marginLeft: 2, opacity: 0.75 },
  // Gentle press feedback: a whisper of tint behind the row.
  rowPressed: { backgroundColor: c === LIGHT ? 'rgba(100,116,139,0.07)' : 'rgba(255,255,255,0.05)' },
  below: { marginTop: 12, marginLeft: 66, gap: 10 },
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
  optionList: { borderRadius: 14, borderWidth: 1, borderColor: c.surfaceBorder, backgroundColor: c.surface, overflow: 'hidden' },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52, paddingHorizontal: 16, gap: 12 },
  optionText: { color: c.text, fontSize: 15.5, fontWeight: '500', flex: 1 },
  badge: { paddingHorizontal: 11, height: 27, borderRadius: 999, borderWidth: 1, borderColor: c.surfaceBorder, backgroundColor: c.cardAlt, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  badgeGreen: { borderColor: 'rgba(0,168,107,0.35)', backgroundColor: '#D9FBF0' },
  badgeAmber: { borderColor: 'rgba(217,155,43,0.4)', backgroundColor: '#FEF3D9' },
  badgeText: { color: c.textMuted, fontSize: 12.5, fontWeight: '700' },
  badgeTextGreen: { color: '#00A86B' },
  badgeTextAmber: { color: '#966E12' },
  note: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  noteText: { flex: 1, fontSize: 13, lineHeight: 18 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c.surface,
    ...(c === LIGHT ? { shadowColor: '#64748B', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } } : null),
  },
  buttonText: { fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.7, transform: [{ scale: 0.98 }] },
}));
