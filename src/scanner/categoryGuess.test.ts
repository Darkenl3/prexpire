import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conflictsWithLabel, guessCategory } from './categoryGuess.ts';

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

test('medicine: Cyrillic pharmaceutical vocabulary', () => {
  // The Bulgarian cough syrup label (its name honestly unavailable from the
  // databases): the label's own words still file the item as medicine.
  assert.equal(guessCategory('Сироп за деца 200 мл'), 'medicine');
  assert.equal(guessCategory('Бронхо сироп'), 'medicine');
  assert.equal(guessCategory('Ампицилин таблетки 500 mg'), 'medicine');
  assert.equal(guessCategory('Витамин C капсули'), 'medicine');
});

test('medicine: leaflet words on the Bulgarian bottle and box in the scan photos', () => {
  // The bottle that was once named "Quaker Chewy Granola Bars".
  assert.equal(guessCategory('Начин на употреба Противопоказания Предупреждения Предозиране Срок на годност'), 'medicine');
  // The Krka box once named "ISBN Lookup Find Any Book By ISBN".
  assert.equal(guessCategory('Всяка филмирана таблетка съдържа аторвастатин По лекарско предписание'), 'medicine');
});

test('a lookup that contradicts a medicine label is not trusted', () => {
  const label = 'Начин на употреба Противопоказания Предозиране';
  assert.equal(conflictsWithLabel(guessCategory('Quaker Chewy Granola Bars'), label), true);
  assert.equal(conflictsWithLabel('medicine', label), false);
  // A label that does not name a medicine never overrides a lookup.
  assert.equal(conflictsWithLabel('food', 'Cottage 3,4% grasime'), false);
  // An uncategorised lookup is not a contradiction.
  assert.equal(conflictsWithLabel(null, label), false);
});
