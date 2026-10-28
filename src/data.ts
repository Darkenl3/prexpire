import type { Tint } from './theme';

// The five built-in category tiles. They are ordinary members of "Your
// categories": the user can remove any of them in Settings and bring it back
// later, and the folders they add sit after them in the grid (the Add-category
// tile is always last). Counts and expiry status are always computed from the
// user's real items; there is no sample data.

export type ArtKey = 'apple' | 'capsule' | 'house' | 'pump' | 'jar' | 'add';

export type Category = {
  id: string;
  tint: Tint;
  name: string;
  art: ArtKey;
};

export const categories: Category[] = [
  { id: 'food', tint: 'food', name: 'Food', art: 'apple' },
  { id: 'medicine', tint: 'medicine', name: 'Medicine', art: 'capsule' },
  { id: 'household', tint: 'household', name: 'Household', art: 'house' },
  { id: 'skincare', tint: 'skincare', name: 'Skincare', art: 'pump' },
  { id: 'pantry', tint: 'pantry', name: 'Pantry', art: 'jar' },
  { id: 'add', tint: 'add', name: 'Add category', art: 'add' },
];
