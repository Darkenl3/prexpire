// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmsDate, looksDateShaped, missHint, settleHint, yearHint, dayMonthHint, fuseDate, type MissObservation } from './scanFeedback.ts';

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

test('a date in view that reads as scattered digits is "hard to read", not "not in view"', () => {
  // A dot-matrix stamp read as fragments: digits, but no date shape.
  assert.equal(missHint({ ...base, lines: ['Ons', '2 S 11 2O26'], parseHint: 'no-date' }), 'unclear');
  assert.equal(missHint({ ...base, lines: ['126S571S195'], parseHint: 'no-date' }), 'unclear');
  // Two digits (a fat percentage) are not a date in view.
  assert.equal(missHint({ ...base, lines: ['3,4% grasime'], parseHint: 'no-date' }), 'text-found');
});

test('a date confirms on the date itself, not on identical reads', () => {
  // A clean labelled read confirms at once.
  assert.equal(confirmsDate(['2026-11-25'], '2026-11-25', 'high'), true);
  // An unlabelled read needs the same date twice, however the reads around it differ.
  assert.equal(confirmsDate(['2026-11-25'], '2026-11-25', 'medium'), false);
  assert.equal(confirmsDate(['2026-11-25', null, null, '2026-11-25'], '2026-11-25', 'medium'), true);
  // ...within the window.
  assert.equal(confirmsDate(['2026-11-25', null, null, null, null, '2026-11-25'], '2026-11-25', 'medium'), false);
  assert.equal(confirmsDate(['2026-11-24', '2026-11-25'], '2026-11-25', 'medium'), false);
});

test('an unreadable stamp still gives away its year', () => {
  const today = new Date(2026, 10, 3);
  assert.equal(yearHint(['202C'], today), 2026);
  assert.equal(yearHint(['25 1', '2O27'], today), 2027);
  assert.equal(yearHint(['9283', 'p92e'], today), null);
  // Not a past year, nor one far ahead, nor a longer number.
  assert.equal(yearHint(['2019'], today), null);
  assert.equal(yearHint(['2045'], today), null);
  assert.equal(yearHint(['120265'], today), null);
});

test('a date put together from several reads of the same stamp', () => {
  const today = new Date(2026, 10, 3);
  // The cottage cheese readout: "25.11" on its own, the year as "2926".
  assert.equal(dayMonthHint(['25.11', '288522210:5', 'sugest'], 'DMY'), '11-25');
  assert.equal(yearHint(['53:11:2926', 'suge'], today), 2026);
  assert.equal(fuseDate(['11-25', null, '11-25'], [null, 2026], today), '2026-11-25');
  // Seen once only, no year, or a past date: nothing.
  assert.equal(fuseDate(['11-25'], [2026], today), null);
  assert.equal(fuseDate(['11-25', '11-25'], [null], today), null);
  assert.equal(fuseDate(['10-01', '10-01'], [2026], today), null);
  // Clock times, codes and full dates are not a day and month.
  assert.equal(dayMonthHint(['10:51'], 'DMY'), null);
  assert.equal(dayMonthHint(['3,4% grasime'], 'DMY'), null);
  assert.equal(dayMonthHint(['12,99 LEI', '10,50%'], 'DMY'), null);
  assert.equal(dayMonthHint(['25.11.2026'], 'DMY'), null);
  assert.equal(dayMonthHint(['1209.375'], 'DMY'), null);
});
