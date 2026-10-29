import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, useTheme } from '../theme';
import { PressScale } from './Press';

// The reference's search field: a wide, quietly rounded field with a magnifier
// on the left, soft placeholder text, and a clear button that appears only
// while there is something to clear. The border breathes towards the mint
// accent while focused, so it reads as a live input the moment it is tapped.

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  accessibilityLabel?: string;
};

export function SearchField({ value, onChange, placeholder = 'Search items…', accessibilityLabel }: Props) {
  const c = useTheme();
  const s = useStyles();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[s.field, focused && { borderColor: c.chipOnBorder }]} accessibilityRole="search">
      <Ionicons name="search" size={17} color={focused ? c.mint : c.textMuted} />
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.textMuted}
        returnKeyType="search"
        autoCorrect={false}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {!!value && (
        <PressScale onPress={() => onChange('')} scaleTo={0.88} hitSlop={8} style={s.clear} accessibilityRole="button" accessibilityLabel="Clear search">
          <Ionicons name="close" size={15} color={c.textMuted} />
        </PressScale>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: c.surfaceBorder,
    backgroundColor: c.surface,
    paddingHorizontal: 14,
  },
  input: { flex: 1, color: c.text, fontSize: 15.5, paddingVertical: 0 },
  clear: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: c.cardAlt },
}));
