import type { CategoryId } from '../items';

// Guesses a category from the words a scanner read off a label, so a scanned
// item lands in the right folder without the user picking one. Pure keyword
// scoring: every hit counts, the highest score wins, ties go to the category
// listed first (medicine beats skincare beats household beats pantry beats
// food, because the earlier lists are the more specific vocabularies).

const KEYWORDS: [CategoryId, string[]][] = [
  [
    'medicine',
    [
      'tablet', 'tablets', 'capsule', 'capsules', 'syrup', 'suppository', 'ibuprofen', 'paracetamol',
      'acetaminophen', 'aspirin', 'omeprazole', 'loratadine', 'amoxicillin', 'antibiotic', 'antiseptic',
      'ointment', 'dosage', 'pharma', 'mg', 'ml',
    ],
  ],
  [
    'skincare',
    [
      'cream', 'lotion', 'serum', 'shampoo', 'conditioner', 'deodorant', 'perfume', 'fragrance',
      'spf', 'sunscreen', 'cleanser', 'toner', 'moisturizer', 'moisturiser', 'soap', 'toothpaste',
      'skincare', 'balm', ' mascara', 'rouge', 'foundation',
    ],
  ],
  [
    'household',
    [
      'detergent', 'bleach', 'cleaner', 'disinfect', 'wipe', 'wipes', 'softener', 'dishwash',
      'laundry', 'garbage', 'freshener', 'polish', 'sponge', 'scourer', 'descale',
    ],
  ],
  [
    'pantry',
    ['flour', 'sugar', 'rice', 'pasta', 'beans', 'cereal', 'oats', 'olive oil', 'oil', 'vinegar', 'honey', 'jam', 'spice', 'coffee', 'tea', 'canned', 'tin'],
  ],
  [
    'food',
    [
      'milk', 'yogurt', 'yoghurt', 'cheese', 'bread', 'butter', 'juice', 'sauce', 'ketchup',
      'mayonnaise', 'mayo', 'soup', 'chocolate', 'cookie', 'biscuit', 'snack', 'drink',
      'beverage', 'best before', 'eat by', 'water',
    ],
  ],
];

export function guessCategory(text: string): CategoryId | null {
  if (!text) return null;
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  let best: CategoryId | null = null;
  let bestScore = 0;
  for (const [id, words] of KEYWORDS) {
    let score = 0;
    for (const w of words) if (t.includes(w)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}
