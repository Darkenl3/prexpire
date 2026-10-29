// Run with: node --test --experimental-strip-types --no-warnings shellcheck/tests/productGuess.test.ts
// (from the prexpire repo root). Verifies the shell's product-name heuristics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessProduct } from '../src/scanner/productGuess.ts';

test('brand above the product line is joined into the name', () => {
  const r = guessProduct(['CHOBANI', 'GREEK YOGURT', 'BEST BEFORE', '27 OCT 2026']);
  assert.equal(r?.name, 'Chobani Greek Yogurt');
});

test('a single product line stands alone', () => {
  const r = guessProduct(['Organic Whole Milk', 'EXP 10/2026']);
  assert.equal(r?.name, 'Organic Whole Milk');
});

test('dates and expiry labels never become the name', () => {
  assert.equal(guessProduct(['EXP 10/2026']), null);
  assert.equal(guessProduct(['BEST BEFORE:', '27 OCT 2026']), null);
  assert.equal(guessProduct(['LOT 2847162']), null);
  assert.equal(guessProduct(['27.10.2026']), null);
});

test('weights, nutrition and addresses are noise, not names', () => {
  assert.equal(guessProduct(['NET WT 32 OZ', 'BEST BEFORE 27 OCT 2026']), null);
  assert.equal(guessProduct(['INGREDIENTS: CULTURED PASTEURIZED MILK']), null);
  assert.equal(guessProduct(['WWW.CHOBANI.COM']), null);
});

test('product words outrank position, so the product line wins over the brand', () => {
  const r = guessProduct(['DANONE', 'STRAWBERRY YOGURT DRINK', 'USE BY 27 OCT 2026']);
  assert.equal(r?.name, 'Danone Strawberry Yogurt Drink');
});

test('long ingredient-style lines are ignored in favour of a real name line', () => {
  const r = guessProduct(['ALOE VERA DRINK', 'INGREDIENTS: ALOE VERA PULP WATER SUGAR CITRIC ACID', 'BEST BEFORE 2026-10-27']);
  assert.equal(r?.name, 'Aloe Vera Drink');
});

test('no text means no product (nothing is invented)', () => {
  assert.equal(guessProduct([]), null);
  assert.equal(guessProduct(['   ']), null);
});

test('month-only fragments are not names', () => {
  assert.equal(guessProduct(['OCT', '2026']), null);
});

test('mixed-case printed names keep their shape, caps are title-cased', () => {
  assert.equal(guessProduct(['Activia probiotic yogurt', 'EXP 27 OCT 26'])?.name, 'Activia Probiotic Yogurt');
});

test('digits disqualify a line; the clean line wins', () => {
  const r = guessProduct(['8 52204 10023 4', 'GREEK YOGURT', 'EXP 10/26']);
  assert.equal(r?.name, 'Greek Yogurt');
});

test('very long lines are skipped entirely', () => {
  assert.equal(guessProduct(['THIS IS A REALLY LONG MARKETING LINE ABOUT THE PRODUCT THAT GOES ON AND ON']), null);
});

// Offline-heuristic refinements (no network, no AI — deterministic only).
test('brand names that collide with nutrition words survive in name context', () => {
  assert.equal(guessProduct(['MONSTER ENERGY', 'EXP 2026'])?.name, 'Monster Energy');
  assert.equal(guessProduct(['VITAMIN WATER', 'EXP 10/26'])?.name, 'Vitamin Water');
});

test('nutrition facts with numbers are still noise', () => {
  assert.equal(guessProduct(['ENERGY 450KJ', 'VITAMIN WATER 500ML', 'EXP 2026']), null);
  assert.equal(guessProduct(['OF ENERGY 450 KJ', 'USE BY 27 OCT 2026']), null);
});

test('bare BEST fragments are calendar furniture, not names', () => {
  assert.equal(guessProduct(['BEST OCT']), null);
  assert.equal(guessProduct(['USE BY']), null);
  // ...while real brands containing such words survive.
  assert.equal(guessProduct(['BEST FOODS', 'MAYO', 'EXP 10/26'])?.name, 'Best Foods Mayo');
});

test('mixed letter-digit brand tokens are allowed, quantities are not', () => {
  assert.equal(guessProduct(['7UP', 'LEMON LIME DRINK', 'EXP 10/26'])?.name, '7up Lemon Lime Drink');
  assert.equal(guessProduct(['A1 STEAK SAUCE', 'BEST BEFORE 27 OCT 2026'])?.name, 'A1 Steak Sauce');
  // Volume/weight tokens never become the name.
  assert.equal(guessProduct(['MILK 1L', 'EXP 10/26']), null);
  assert.equal(guessProduct(['500ML', 'SHAMPOO', 'EXP 10/26'])?.name, 'Shampoo');
});

test('a six-word brand+product join is allowed', () => {
  const r = guessProduct(['HAAGEN DAZS', 'VANILLA CARAMEL ICE CREAM', 'BEST BEFORE 27 OCT 2026']);
  assert.equal(r?.name, 'Haagen Dazs Vanilla Caramel Ice Cream');
});

test('over-long names are truncated on a word boundary with an ellipsis', () => {
  const r = guessProduct(['SOME EXTREMELY LONG IMAGINARY PRODUCT LINE NAME', 'EXP 10/26']);
  assert.ok(r === null || (r.name.endsWith('…') && r.name.length <= 48));
});
