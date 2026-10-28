import type { Tint } from './theme';

// The five built-in categories shown as Home tiles (the user's own "category
// folders" are added on top of these from Settings). Counts and expiry status
// are always computed from the user's real items; there is no sample data.

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
