import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatProductName, shortProductName, looksLikeTechnicalTitle, guessProduct, guessProductFromBlocks, type TextBlock } from './productGuess.ts';

// Furniture guard for product names: internal lookup/search labels ("Search
// Barcodestock", "Lookup & ISBN Search") must NEVER become product names on
// any identification path, while genuine names (brands, special characters)
// always survive. Regression suite for the compound-token fix. The lookup
// pipeline's own guards (cleanWebCandidate / mineProductName) are the same
// logic and are covered by the shellcheck suite against the ported copies.

test('looksLikeTechnicalTitle rejects split-word lookup furniture', () => {
  assert.ok(looksLikeTechnicalTitle('Lookup & ISBN Search'));
  assert.ok(looksLikeTechnicalTitle('ISBN Search'));
  assert.ok(looksLikeTechnicalTitle('UPC Item Database'));
  assert.ok(looksLikeTechnicalTitle('Barcode Lookup'));
});

test('looksLikeTechnicalTitle rejects one-word jargon compounds', () => {
  // The "Search Barcodestock" regression: a directory-site brand squeezed
  // into a single token dodged the split-word filter.
  assert.ok(looksLikeTechnicalTitle('Search Barcodestock'));
  assert.ok(looksLikeTechnicalTitle('Barcodestock'));
  assert.ok(looksLikeTechnicalTitle('SearchUPC'));
  assert.ok(looksLikeTechnicalTitle('UPCIndex'));
  assert.ok(looksLikeTechnicalTitle('Go UPC'));
});

test('looksLikeTechnicalTitle keeps genuine product names', () => {
  assert.ok(!looksLikeTechnicalTitle('Nestle Corn Flakes'));
  assert.ok(!looksLikeTechnicalTitle('bett\u2019r Gluten Free Oats'));
  assert.ok(!looksLikeTechnicalTitle('Chobani Greek Yogurt'));
  // A real word alongside jargon keeps the name a name.
  assert.ok(!looksLikeTechnicalTitle('Searchlight Organic Candle'));
});

test('guessProduct never names a lookup page', () => {
  // A label whose OCR lines are pure barcode-directory furniture.
  assert.equal(guessProduct(['Search Barcodestock', 'UPC 9010437034689', 'Lookup & ISBN Search']), null);
});

test('guessProduct still finds the printed brand line', () => {
  const guess = guessProduct(['BEST BEFORE 06.03.2027', 'bett\u2019r', 'GLUTEN FREE OATS', '800233 686905']);
  assert.ok(guess);
  assert.match(guess.name.toLowerCase(), /oats/);
});

test('looksLikeTechnicalTitle rejects count-token furniture ("Report & Lookup 500m+ Products")', () => {
  // The regression from the user's screenshots: a barcode-directory tagline
  // with a magnitude count ("500m+") slipped past the split-word filter.
  assert.ok(looksLikeTechnicalTitle('Report & Lookup 500m+ Products'));
  assert.ok(looksLikeTechnicalTitle('Report and Lookup 300k+ Barcodes'));
  assert.ok(looksLikeTechnicalTitle('Lookup 2bn Products'));
  // A dose next to a real word is NOT furniture ("45 Cpr" names a medicine).
  assert.ok(!looksLikeTechnicalTitle('Aboca Neo Bianacid 45 Cpr'));
  assert.ok(!looksLikeTechnicalTitle('Nurofen 200mg'));
});

test('formatProductName trims dangling marketing tails and duplicate brands', () => {
  // The Aboca regression: a snippet cut mid-clause left "Against" dangling.
  assert.equal(formatProductName('Aboca Neo Bianacid 45 Cpr Against'), 'Aboca Neo Bianacid 45 Cpr');
  assert.equal(formatProductName('Neo Bianacid 45 Cpr contro'), 'Neo Bianacid 45 Cpr');
  // Repeated brand collapses.
  assert.equal(formatProductName('Alpro Alpro Soya Drink'), 'Alpro Soya Drink');
  // Long names cap at a word boundary without ellipsis, keeping dosage.
  const long = 'Aboca Neo Bianacid Compresse Gastroprotezione Compresse Rivestite con Estratti Vegetali per il Bruciore di Stomaco';
  const cut = formatProductName(long, 64);
  assert.ok(cut.length <= 64 && !cut.endsWith(' ') && !cut.includes('\u2026'));
  // A tail trimmed by the length cut is not left dangling either.
  assert.ok(!['for', 'with', 'against', 'per'].includes(cut.split(' ').pop() ?? ''));
});

test('looksLikeTechnicalTitle rejects ISBN-service furniture ("Isbn Lookup Find Any Book By Isbn")', () => {
  // The KRKA medicine box's real lookup result: the isbn-search site's own
  // service description, every word of which is now furniture.
  assert.equal(looksLikeTechnicalTitle('Isbn Lookup Find Any Book By Isbn'), true);
  assert.equal(looksLikeTechnicalTitle('ISBN Search'), true);
  assert.equal(looksLikeTechnicalTitle('Find Any Book'), true);
  assert.equal(looksLikeTechnicalTitle('Search Barcodestock'), true);
  assert.equal(looksLikeTechnicalTitle('Lookup & ISBN Search'), true);
  // A real book keeps its title: genuine words survive.
  assert.equal(looksLikeTechnicalTitle('Harry Potter and the Prisoner of Azkaban'), false);
  assert.equal(looksLikeTechnicalTitle('The Little Prince'), false);
});

// ─── 2 Nov 2026 scan report ──────────────────────────────────────────────────

test('serving-suggestion print never becomes a product name ("Sugest")', () => {
  assert.equal(guessProduct(['sugestie de p']), null);
  assert.equal(guessProduct(['sugestie de prezentare']), null);
  assert.equal(guessProduct(['Serving suggestion']), null);
  assert.equal(guessProduct(['BOGAT IN PROTEINE', 'FARA GLUTEN']), null);
  // A stray fragment at the frame's edge is not a name either.
  assert.equal(guessProduct(['de p']), null);
});

test('Cyrillic product names are names', () => {
  assert.equal(guessProduct(['Бронхолитин'])?.name, 'Бронхолитин');
  // ...but Cyrillic leaflet furniture is not.
  assert.equal(guessProduct(['Състав: вода, захар']), null);
});

test('with text sizes, the biggest name-like text names the product', () => {
  const blocks: TextBlock[] = [
    { text: '3,4% grasime', top: 0.05, left: 0.1, width: 0.3, height: 0.08 },
    { text: 'Delaco', top: 0.2, left: 0.1, width: 0.4, height: 0.14 },
    { text: 'Cottage', top: 0.36, left: 0.1, width: 0.5, height: 0.2 },
    { text: 'BOGAT IN PROTEINE', top: 0.62, left: 0.4, width: 0.3, height: 0.06 },
    { text: 'sugestie de prezentare', top: 0.9, left: 0.6, width: 0.3, height: 0.04 },
  ];
  assert.equal(guessProductFromBlocks(blocks)?.name, 'Delaco Cottage');
  // Only fine print in view: no name.
  assert.equal(
    guessProductFromBlocks([{ text: 'Ingredients: milk, cream', top: 0.5, left: 0, width: 0.6, height: 0.03 }]),
    null,
  );
  // A lone big line that is furniture names nothing.
  assert.equal(guessProductFromBlocks([{ text: 'sugestie de prezentare', top: 0.4, left: 0, width: 0.9, height: 0.2 }]), null);
});

test('short or uncertain fragments never become names ("Ons")', () => {
  assert.equal(guessProduct(['Ons']), null);
  assert.equal(guessProduct(['Cu Ons']), null);
  const ons: TextBlock[] = [{ text: 'Ons', top: 0.4, left: 0.3, width: 0.2, height: 0.15, confidence: 1 }];
  assert.equal(guessProductFromBlocks(ons), null);
  // A real name read only as a guess (Vision confidence 0.5) is not shown.
  const guessed: TextBlock[] = [{ text: 'Cottage', top: 0.4, left: 0.1, width: 0.6, height: 0.2, confidence: 0.5 }];
  assert.equal(guessProductFromBlocks(guessed), null);
  // The same name read cleanly is.
  assert.equal(guessProductFromBlocks([{ ...guessed[0], confidence: 1 }])?.name, 'Cottage');
});

test('shortProductName keeps what people call the product', () => {
  const cases: [string, string][] = [
    ['Coca-Cola Original Taste Soft Drink 330ml Can', 'Coca-Cola'],
    ['Coca-Cola', 'Coca-Cola'],
    ['Coca-Cola Zero Sugar 1.5 L', 'Coca-Cola Zero Sugar'],
    ['Nutella - Hazelnut spread with cocoa, 750g', 'Nutella'],
    ['Heinz Tomato Ketchup Squeezy Bottle 460g', 'Heinz Tomato Ketchup'],
    ['Fage Total Greek Yoghurt 0% Fat 500g', 'Fage Total Greek Yoghurt'],
    ['Ibuprofen 200mg Tablets 16 pack', 'Ibuprofen 200mg Tablets'],
    ['Alpro Soya Drink Original 1L', 'Alpro Soya Drink'],
    ['Pepsi Max Cherry 6 x 330ml Cans', 'Pepsi Max Cherry'],
    ['Barilla Spaghetti n.5 500 g', 'Barilla Spaghetti n.5'],
    ['Vitamin D3 1000 IU Softgels (90 count)', 'Vitamin D3 1000IU Softgels'],
    ['Dove Original Beauty Cream Bar Soap 2 x 90g', 'Dove Beauty Cream Bar'],
    ['Lindt Excellence 70% Cocoa Dark Chocolate 100g', 'Lindt Excellence Cocoa Dark'],
  ];
  for (const [raw, want] of cases) assert.equal(shortProductName(raw), want, raw);
});

test('shortProductName never empties a name', () => {
  assert.equal(shortProductName('Original'), 'Original');
  assert.equal(shortProductName('330ml'), '330ml');
});
