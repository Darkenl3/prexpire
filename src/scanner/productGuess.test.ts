import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeTechnicalTitle, guessProduct } from './productGuess.ts';

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
