import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatProductName, looksLikeTechnicalTitle, guessProduct } from './productGuess.ts';

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
