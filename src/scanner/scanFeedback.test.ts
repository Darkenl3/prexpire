// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksDateShaped, missHint, settleHint, type MissObservation } from './scanFeedback.ts';

const base: MissObservation = {
  misses: 5,
  stuckAfter: 14,
  failed: false,
  lines: [],
  hadText: false,
  noTextStreak: 0,
  parseHint: undefined,
  recentDate: false,
};

test('the hint names the real problem, not always "move closer"', () => {
  assert.equal(missHint({ ...base, dark: true, lines: ['ABC'] }), 'low-light');
  assert.equal(missHint({ ...base, lines: [], noTextStreak: 4, parseHint: 'no-text' }), 'closer');
  assert.equal(missHint({ ...base, failed: true }), 'ocr-error');
  assert.equal(missHint({ ...base, lines: [], hadText: true, parseHint: 'no-text' }), 'ocr-error');
  assert.equal(missHint({ ...base, lines: ['MFG 01/2025'], parseHint: 'manufacture-only' }), 'manufacture');
  assert.equal(missHint({ ...base, lines: ['31/02/2027'], parseHint: 'invalid-date' }), 'unclear');
  // Date-shaped digits that did not parse: glare, curvature, dot-matrix gaps.
  assert.equal(missHint({ ...base, lines: ['2 5.1 1'], parseHint: 'no-date' }), 'unclear');
  // Label text with nothing date-shaped: point the frame at the date.
  assert.equal(missHint({ ...base, lines: ['Начин на употреба', 'Предозиране'], parseHint: 'no-date' }), 'text-found');
});

test('feedback continues after a product was recognised (barcode digits are not a date)', () => {
  // The camera still on the barcode the product came from: no "hard to read" claim.
  assert.equal(missHint({ ...base, lines: ['3 838989 614249'], parseHint: 'no-date' }), 'text-found');
  assert.equal(looksDateShaped(['3 838989 614249']), false);
  assert.equal(looksDateShaped(['3,4% grasime', '69,8 g']), false);
  assert.equal(looksDateShaped(['2028/0']), true);
  assert.equal(looksDateShaped(['E 20627']), true);
});

test('early passes stay neutral; after ~20 s the verdict offers manual entry', () => {
  assert.equal(missHint({ ...base, misses: 1 }), 'aim');
  assert.equal(missHint({ ...base, misses: 1, lines: ['TEXT'], parseHint: 'no-date' }), 'text-found');
  assert.equal(missHint({ ...base, misses: 2, recentDate: true }), 'hold-steady');
  assert.equal(missHint({ ...base, misses: 14 }), 'manual');
  assert.equal(missHint({ ...base, misses: 30, dark: true }), 'manual');
});

test('a new hint has to repeat before it replaces the one on screen', () => {
  assert.equal(settleHint('closer', 'unclear', 'closer'), 'closer');
  assert.equal(settleHint('closer', 'unclear', 'unclear'), 'unclear');
  assert.equal(settleHint('aim', 'closer', null), 'closer');
  assert.equal(settleHint('unclear', 'manual', 'unclear'), 'manual');
  assert.equal(settleHint('unclear', 'hold-steady', 'unclear'), 'hold-steady');
});
