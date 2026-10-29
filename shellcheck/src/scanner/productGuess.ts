import { normalizeLine } from './dateParser.ts';

// Pulls a likely product name out of the lines an OCR read off a package label,
// for the shell scanner's result panel - entirely offline, deterministic
// (no network, no AI). Labels are not product databases, so this stays
// deliberately conservative: a line only counts when it clearly looks like a
// brand or product line - no dates, no expiry labels, no weights, no
// ingredients, no addresses. Nothing is invented: a null result means "not
// identified", the panel either fills from the local barcode catalog (which
// knows real products) or asks the user to type the name.

export type ProductGuess = { name: string } | null;

// Line-level furniture that never names the product, matched against the
// normalized (upper-cased) line. Nutrition words only count in nutrition
// context (a following number, or OF/PER/CONTAINS before them), so real names
// like "MONSTER ENERGY" or "VITAMIN WATER" survive.
const NOISE_RE = new RegExp(
  [
    '\\b(EXP|EXPIRY|EXPIRATION|EXPIRES|EXPIRED|EXPD|BBE|BEST\\s*BEFORE|BEST\\s*BY|BEST\\s*IF\\s*USED\\s*BY|USE\\s*BY|USE\\s*BEFORE|SELL\\s*BY|DISPLAY\\s*UNTIL|LOT|BATCH|MFG|MFD|MFR|PROD|PACKED|PKD|NET\\s*WT|NET\\s*WEIGHT|DR\\s*WT|INGREDIENTS?|NUTRITION|NUTRITIONAL|DIETARY|SODIUM|CALCIUM|IRON|ALLERGENS?|MAY\\s*CONTAIN|CONTAINS|DISTRIBUTED|DISTRIBUTOR|IMPORTERS?|EXPORTERS?|IMPORTED|MADE\\s*IN|MADE\\s*WITH|PRODUCT\\s*OF|COUNTRY\\s*OF\\s*ORIGIN|REFRIGERATE|REFRIGERATED|KEEP\\s*FROZEN|STORAGE|STORED|ONCE\\s*OPENED|WWW\\.|HTTPS?:|\\.COM|\\.CO\\.|\\.NET\\b|LTD|LLC|INC|CORP|GMBH|PLC)\\b',
    '\\b(?:OF|PER|CONTAINS|WITH)\\s+(ENERGY|VITAMINS?|MINERALS?|PROTEINS?|CARBOHYDRATES?|SUGARS?|FIBER|FIBRE)\\b',
    '\\b(ENERGY|VITAMINS?|MINERALS?|PROTEINS?|CARBOHYDRATES?|SUGARS?|FIBER|FIBRE)\\s*[:\\d]',
  ].join('|'),
);

// Words that make a line look MORE like a product name (brand vocabulary).
const PRODUCT_RE =
  /\b(YOGURT|YOGHURT|MILK|CHEESE|BUTTER|CREAM|BREAD|BAGUETTE|TOAST|JUICE|NECTAR|SAUCE|KETCHUP|MAYONNAISE|MAYO|SOUP|BROTH|OIL|WATER|SPARKLING|STILL|COLA|LEMONADE|TEA|COFFEE|ESPRESSO|CHOCOLATE|COOKIE|BISCUIT|CAKE|SNACK|CHIPS|CRISPS|DRINK|BEVERAGE|SHAKE|SMOOTHIE|SHAMPOO|CONDITIONER|SOAP|DEODORANT|TOOTHPASTE|DETERGENT|SOFTENER|CLEANER|DISINFECTANT|VITAMIN\W|SUPPLEMENT|CAPSULES?|TABLETS?|SYRUP|OINTMENT|HONEY|JAM|MARMALADE|FLOUR|SUGAR|RICE|PASTA|NOODLES|CEREAL|OATS|MUESLI|GRANOLA|SPREAD|ALOE|GREEK|ORGANIC|NATURAL|FRESH|VEGAN|VEGETARIAN|GLUTEN\s*FREE|LACTOSE\s*FREE|PROBIOTIC\w*|KEFIR|SKYR|QUARK|KOMBUCHA)\b/;

// Tokens that make a whole line a date fragment ("OCT", "BEST OCT", "USE BY").
const CALENDARISH = new Set([
  'JAN', 'JANUARY', 'FEB', 'FEBRUARY', 'MAR', 'MARCH', 'APR', 'APRIL', 'MAY', 'JUN', 'JUNE',
  'JUL', 'JULY', 'AUG', 'AUGUST', 'SEP', 'SEPT', 'SEPTEMBER', 'OCT', 'OCTOBER', 'NOV', 'NOVEMBER',
  'DEC', 'DECEMBER', 'BEST', 'DATE', 'END', 'ON', 'BY', 'USE', 'SELL', 'DISPLAY', 'UNTIL', 'PRINTED', 'LOT', 'BATCH', 'NO',
]);

// A token that is a number, a date fragment, or a number with a UNIT suffix
// ("27", "10/26", "1L", "500ML", "32OZ", "4X", "0%") - quantities and dates,
// never names. Mixed letter-digit BRAND tokens (7UP, A1, V8, B12) deliberately
// survive: no known unit suffix matches them.
const NUMBER_TOKEN_RE = /^\d+(?:[.,]\d+)?(?:%|ML|CL|DL|L|G|KG|OZ|LB|CT|PC|PX|X)?$/i;
const DATE_TOKEN_RE = /^\d+(?:[.,/-]\d+)+$/;

type Scored = { i: number; score: number; raw: string; words: number };

function scoreLine(raw: string, index: number): Scored | null {
  const n = normalizeLine(raw);
  if (n.length < 3 || n.length > 42) return null;
  const words = n.split(' ').filter(Boolean);
  if (words.length < 1 || words.length > 5) return null;
  // Numbers, dates and quantities disqualify a name line (mixed letter-digit
  // brand tokens like 7UP survive).
  if (words.some((w) => NUMBER_TOKEN_RE.test(w) || DATE_TOKEN_RE.test(w))) return null;
  // Letters have to dominate; otherwise this is symbols/noise.
  const letters = n.replace(/[^A-Z]/g, '').length;
  const solid = n.replace(/\s/g, '').length;
  if (!solid || letters / solid < 0.55) return null;
  if (NOISE_RE.test(n)) return null;
  if (words.every((w) => CALENDARISH.has(w))) return null;

  let score = index <= 1 ? 3 : index <= 3 ? 1.5 : 0;
  if (PRODUCT_RE.test(n)) score += 2.5;
  if (words.length >= 2 && words.length <= 4) score += 1;
  // Mixed case (as printed) reads like a name rather than a shouted label.
  if (/[a-z]/.test(raw) && /[A-Z]/.test(raw)) score += 0.5;
  return { i: index, score, raw: raw.trim(), words: words.length };
}

const SMALL_WORDS = new Set(['of', 'and', 'the', 'with', 'in', 'for', 'de', 'di', 'a', 'la']);

function titleCase(text: string): string {
  return text
    .replace(/[®™©]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (SMALL_WORDS.has(w.toLowerCase()) && i > 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

export function guessProduct(lines: string[]): ProductGuess {
  const clean = lines.flatMap((l) => l.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  const scored: Scored[] = [];
  clean.forEach((raw, i) => {
    const s = scoreLine(raw, i);
    if (s) scored.push(s);
  });
  if (!scored.length) return null;

  let best = scored[0];
  for (const c of scored) if (c.score > best.score) best = c;

  // A short line right above the winning line is usually the brand
  // ("CHOBANI" over "GREEK YOGURT"); joining them names the product properly.
  let combined = best.raw;
  if (best.i > 0) {
    const above = scored.find((c) => c.i === best.i - 1);
    if (above && above.words <= 2 && above.raw !== best.raw && above.words + best.words <= 6) {
      combined = `${above.raw} ${best.raw}`;
    }
  }

  const name = titleCase(combined);
  if (!name) return null;
  if (name.length > 48) {
    const words = name.split(' ');
    let out = '';
    for (const w of words) {
      if ((out + ' ' + w).trim().length > 45) break;
      out = (out + ' ' + w).trim();
    }
    return out ? { name: `${out}…` } : null;
  }
  return { name };
}
