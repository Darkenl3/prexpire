import type { CategoryId } from '../items';

// Guesses a category from the words a scanner read off a label (or a barcode
// database returned), so a scanned item lands in the right folder without the
// user picking one. Keyword scoring with two tiers:
//
//   strong words  — name the product class outright ("cpr", "sciroppo",
//                   "yogurt", "detergent"): each hit scores 1.
//   unit words    — dosage/size suffixes ("mg", "ml", "mcg", "iu"): they only
//                   ever REINFORCE a category that already has a strong hit,
//                   never win one alone. A "330ml" on a soda can must not turn
//                   the drink into medicine — which the old flat keyword list
//                   let happen, since "ml" scored for medicine all by itself.
//
// Substring matching throughout (it sees through the punctuation OCR leaves
// behind, "45,Cpr", "500mg,"). Ties go to the category listed first — the more
// specific vocabulary (medicine beats skincare beats household beats pantry
// beats food).

type CategoryWords = [id: CategoryId, strong: string[], units?: string[]];

const KEYWORDS: CategoryWords[] = [
  [
    'medicine',
    [
      // English
      'tablet', 'tablets', 'capsule', 'capsules', 'syrup', 'suppository', 'suppositories',
      'ibuprofen', 'paracetamol', 'acetaminophen', 'aspirin', 'omeprazole', 'loratadine',
      'amoxicillin', 'antibiotic', 'antiseptic', 'ointment', 'dosage', 'pharma', 'medicine',
      'medicinal', 'supplement', 'vitamin', 'vitamins', 'probiotic', 'effervescent',
      'pain relief', 'cold and flu', 'cough', 'nasal spray', 'eye drops', 'ear drops',
      // Italian/Spanish pharmaceutical vocabulary (Aboca-style packaging:
      // "45 Cpr", "compresse", "sciroppo"…)
      'cpr', 'cprs', 'cps', 'compresse', 'compressa', 'opercoli', 'capsule rigide',
      'sciroppo', 'gocce', 'gtt', 'supposte', 'ovuli', 'bustine', 'sachet', 'unguento',
      'pomata', 'integratore', 'integratori', 'farmaco', 'uso orale',
      // German (Saft deliberately omitted: it is German for JUICE, so an
      // "Apfelsaft" would land in medicine)
      'tabletten', 'kapseln', 'zäpfchen', 'zapfchen', 'salbe', 'brausetabletten',
      // French
      'comprimes', 'comprimés', 'gelules', 'sirop', 'suppositoires', 'pommade', 'comprime',
      // Common brand roots of OTC medicines that reach barcode databases as
      // generic-looking descriptions.
      'novalgin', 'nurofen', 'panadol', 'eferalgan', 'voltaren', 'diclofenac', 'ketanov',
      'suprastin', 'loratadina', 'omeprazolo', 'amoxicillina', 'augmentin', 'aspirina',
      'paracetamolo', 'ibuprofene',
      // Cyrillic pharmaceutical vocabulary (Bulgarian/Russian/Ukrainian
      // packaging: "СИРОП", "ТАБЛЕТКИ", "КАПСУЛИ"). Substring roots cover
      // the inflections ("таблетк" sees таблетка/таблетки), the same way the
      // Latin roots above do. Shorter roots (маз/гел) are deliberately left
      // out: they also live inside non-medicine words ("смазка" = lubricant).
      'сироп', 'таблетк', 'капсул',
    ],
    ['mg', 'ml', 'mcg', 'iu', 'gtt'],
  ],
  [
    'skincare',
    [
      'cream', 'lotion', 'serum', 'shampoo', 'conditioner', 'deodorant', 'perfume', 'fragrance',
      'spf', 'sunscreen', 'cleanser', 'toner', 'moisturizer', 'moisturiser', 'soap', 'toothpaste',
      'skincare', 'balm', 'mascara', 'rouge', 'foundation', 'shower gel', 'body lotion',
      'hand cream', 'face', 'hair', 'lip balm', 'aftershave', 'dentifricio', 'shampooing',
    ],
  ],
  [
    'household',
    [
      'detergent', 'bleach', 'cleaner', 'disinfect', 'wipe', 'wipes', 'softener', 'dishwash',
      'laundry', 'garbage', 'freshener', 'polish', 'sponge', 'scourer', 'descale', 'kitchen roll',
      'toilet paper', 'tissues', 'foil', 'cling film', 'trash bag', 'detersivo', 'wc', 'straws',
    ],
  ],
  [
    'pantry',
    ['flour', 'sugar', 'rice', 'pasta', 'beans', 'cereal', 'oats', 'olive oil', 'oil', 'vinegar', 'honey', 'jam', 'spice', 'coffee', 'tea', 'canned', 'tin', 'muesli', 'granola', 'quinoa', 'couscous', 'lentils', 'chickpeas', 'barilla', 'spaghetti', 'penne', 'fusilli', 'farfalle'],
  ],
  [
    'food',
    [
      'milk', 'yogurt', 'yoghurt', 'cheese', 'bread', 'butter', 'juice', 'sauce', 'ketchup',
      'mayonnaise', 'mayo', 'soup', 'chocolate', 'cookie', 'biscuit', 'snack', 'drink',
      'beverage', 'best before', 'eat by', 'water', 'soya', 'soja', 'soy', 'oat drink',
      'almond', 'plant based', 'kefir', 'skyr', 'quark', 'feta', 'mozzarella', 'cheddar',
      'salami', 'ham', 'chicken', 'beef', 'pork', 'salmon', 'tuna',
    ],
  ],
];

export function guessCategory(text: string): CategoryId | null {
  if (!text) return null;
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;
  let best: CategoryId | null = null;
  let bestScore = 0;
  for (const [id, strong, units] of KEYWORDS) {
    // Substring matching, exactly like the original keyword scorer (it sees
    // through the punctuation OCR leaves behind, "45,Cpr", "500mg,").
    let strongHits = 0;
    for (const w of strong) if (t.includes(w)) strongHits += 1;
    // Units only reinforce an already-strong category: "45 Cpr" counts
    // medicine + dosage, while a soda's "330ml" counts neither (no strong
    // medicine word on the can, so its "ml" is just the can size).
    let score = strongHits;
    if (strongHits > 0 && units) {
      for (const u of units) if (t.includes(u)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}
