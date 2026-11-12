import { Children, isValidElement, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useLayout } from '../layout';

// On a wide landscape screen (an iPad on its side) lists of cards and rows
// go two to a line, like Home's two columns and the Items grid; everywhere
// else they stay one column.
export function useTwoUp(): boolean {
  const layout = useLayout();
  return layout.mode === 'split' && layout.width >= 960;
}

// A list that becomes a two-column grid when useTwoUp() is true. `gap` is
// the space between rows, `columnGap` between the two columns (default: the same).
export function TwoUpList({ gap = 12, columnGap, style, children }: { gap?: number; columnGap?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const col = columnGap ?? gap;
  const twoUp = useTwoUp();
  if (!twoUp) return <View style={[{ gap }, style]}>{children}</View>;
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', rowGap: gap, columnGap: col }, style]}>
      {Children.toArray(children).map((child, i) => (
        // Each cell keeps its row's own key, so rows that animate in and out
        // (Shopping List) aren't remounted when a neighbour leaves.
        <View key={isValidElement(child) && child.key != null ? child.key : i} style={{ width: `calc(50% - ${col / 2}px)` as unknown as number }}>
          {child}
        </View>
      ))}
    </View>
  );
}

// Two side-by-side columns of sections (Settings, Waste stats) on a wide
// landscape screen; one column, left then right, everywhere else.
export function TwoColumns({ left, right, gap = 24 }: { left: ReactNode; right: ReactNode; gap?: number }) {
  const twoUp = useTwoUp();
  if (!twoUp) return <>{left}{right}</>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', columnGap: gap }}>
      <View style={{ flex: 1, minWidth: 0 }}>{left}</View>
      <View style={{ flex: 1, minWidth: 0 }}>{right}</View>
    </View>
  );
}
