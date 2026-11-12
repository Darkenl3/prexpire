import { useLayout } from './layout';
import { useSettings } from './settings';
import type { PadLayout } from './preferences';

export type Density = {
  // An iPad-sized screen (shortest side 600 pt or more): the iPad layout setting applies.
  pad: boolean;
  // The iPad layout in effect ('compact' on phones, which keep their own toggle).
  layout: PadLayout;
  // Shorter rows and cards in lists.
  compactRows: boolean;
  // Lists of cards and rows go two (or three) to a line.
  twoUp: boolean;
  // Columns of the Items grid when twoUp is on.
  columns: number;
};

// How much the screens show at once. On iPad the user picks it in
// Settings > Appearance > iPad layout:
//   basic    - one column, only what's coming up, regular rows
//   compact  - the default: two columns in landscape
//   detailed - shorter rows with dates, two columns upright, three in a wide landscape
// Phones ignore it and keep the Compact rows toggle.
export function useDensity(): Density {
  const layout = useLayout();
  const { settings } = useSettings();
  const pad = Math.min(layout.width, layout.height) >= 600;
  if (!pad) return { pad, layout: 'compact', compactRows: settings.compact, twoUp: layout.mode === 'split' && layout.width >= 960, columns: 2 };
  const d = settings.padLayout;
  if (d === 'basic') return { pad, layout: d, compactRows: false, twoUp: false, columns: 1 };
  if (d === 'detailed') return { pad, layout: d, compactRows: true, twoUp: layout.width >= 760, columns: layout.mode === 'split' && layout.width >= 1180 ? 3 : 2 };
  return { pad, layout: d, compactRows: settings.compact, twoUp: layout.mode === 'split' && layout.width >= 960, columns: 2 };
}
