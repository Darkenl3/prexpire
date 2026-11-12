import { useLayout } from './layout';
import { useSettings } from './settings';
import type { PadLayout } from './preferences';

export type Density = {
  // An iPad-sized screen (shortest side 600 pt or more).
  pad: boolean;
  // The layout chosen in Settings > Appearance.
  layout: PadLayout;
  // Shorter rows and cards in lists.
  compactRows: boolean;
  // Lists of cards and rows go two (or three) to a line.
  twoUp: boolean;
  // Columns of the Items grid when twoUp is on.
  columns: number;
};

// How much the screens show at once, picked in Settings > Appearance > Layout:
//   basic    - one column, only what's coming up, regular rows
//   compact  - the default: two columns in landscape
//   detailed - shorter rows with dates, two columns upright, three in a wide landscape
// On a phone everything stays one column.
export function useDensity(): Density {
  const layout = useLayout();
  const { settings } = useSettings();
  const pad = Math.min(layout.width, layout.height) >= 600;
  const d = settings.padLayout;
  // Phones: one column whatever the choice; Basic drops the category tiles,
  // Detailed uses shorter rows with dates.
  if (!pad) return { pad, layout: d, compactRows: d === 'detailed', twoUp: false, columns: 1 };
  if (d === 'basic') return { pad, layout: d, compactRows: false, twoUp: false, columns: 1 };
  if (d === 'detailed') return { pad, layout: d, compactRows: true, twoUp: layout.width >= 760, columns: layout.mode === 'split' && layout.width >= 1180 ? 3 : 2 };
  return { pad, layout: d, compactRows: false, twoUp: layout.mode === 'split' && layout.width >= 960, columns: 2 };
}
