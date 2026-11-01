import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory } from './categoryGuess.ts';

// Regression suite for the two-tier keyword scorer: strong words win a
// category, unit suffixes ("mg", "ml") only reinforce one that already won —
// and the medicine vocabulary covers the continental dosage abbreviations
// ("45 Cpr", "sciroppo", "compresse") that used to fall through to Food.

test('medicine: continental dosage abbreviations', () => {
  assert.equal(guessCategory('Aboca Neo Bianacid 45 Cpr Against'), 'medicine');
  assert.equal(guessCategory('Neo Bianacid 45 cpr'), 'medicine');
  assert.equal(guessCategory('Moment 20 compresse rivestite'), 'medicine');
  assert.equal(guessCategory('Sciroppo per la tosse 200ml'), 'medicine');
  assert.equal(guessCategory('Voltaren Emulgel 1% gel'), 'medicine');
  assert.equal(guessCategory('Ibuprofene 400 mg compresse'), 'medicine');
  assert.equal(guessCategory('Nurofen 200mg'), 'medicine');
});

test('units alone never classify a product as medicine', () => {
  // The old bug: "330ml" scored medicine via the flat "ml" keyword.
  assert.equal(guessCategory('Coca Cola 330ml'), null);
  // A strong FOOD word beside the unit still wins - the unit does not steal it for medicine.
  assert.equal(guessCategory('Sparkling Water 500ml'), 'food');
  assert.equal(guessCategory('Aqua Panna 1.5L'), null);
});

test('food vocabulary still wins for foods', () => {
  assert.equal(guessCategory('Alpro Soya Drink Vanilla 1L'), 'food');
  assert.equal(guessCategory('Chobani Greek Yogurt Blueberry'), 'food');
  assert.equal(guessCategory('bett\u2019r Gluten Free Oats Fine Flakes'), 'pantry');
});

test('household and skincare', () => {
  assert.equal(guessCategory('Ajax Bleach Powder Classic'), 'household');
  assert.equal(guessCategory('YAY! Paper Straws Vanilla'), 'household');
  assert.equal(guessCategory('Nivea Soft Cream 200ml'), 'skincare');
});
