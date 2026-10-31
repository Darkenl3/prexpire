// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOrderForRegion, formatDate, parseExpiry, type ParseOptions } from './dateParser.ts';

const today = new Date(2026, 9, 26); // 26 Oct 2026
const uk: ParseOptions = { today, preferredOrder: 'DMY' };
const us: ParseOptions = { today, preferredOrder: 'MDY' };

function found(lines: string[], opts = uk) {
  const r = parseExpiry(lines, opts);
  assert.equal(r.kind, 'found', `expected a date in ${JSON.stringify(lines)}, got ${JSON.stringify(r)}`);
  if (r.kind !== 'found') throw new Error('unreachable');
  return r;
}

test('reads the mockup label with high confidence', () => {
  const r = found(['BEST BEFORE:', '27 OCT 2026']);
  assert.equal(r.primary.iso, '2026-10-27');
  assert.equal(r.confidence, 'high');
  assert.deepEqual(r.reasons, []);
  assert.equal(r.label, 'expiry');
});

test('common labels on the same line', () => {
  for (const line of ['EXP 27 OCT 2026', 'EXP DATE: 27/10/2026', 'EXPIRY 2026-10-27', 'BB 27.10.26', 'USE BY 27 OCT 26', 'BEST BEFORE END 27OCT2026', 'Exp. 27-10-2026']) {
    const r = found([line]);
    assert.equal(r.primary.iso, '2026-10-27', line);
    assert.equal(r.label, 'expiry', line);
    assert.equal(r.confidence, 'high', line);
  }
});

test('month-name orders', () => {
  assert.equal(found(['EXP OCT 27, 2026']).primary.iso, '2026-10-27');
  assert.equal(found(['Best before 27th October 2026']).primary.iso, '2026-10-27');
  assert.equal(found(['EXP 27 OKT 2026']).primary.iso, '2026-10-27');
});

test('numeric order resolved when one reading is impossible', () => {
  const a = found(['EXP 10/27/2026'], uk);
  assert.equal(a.primary.iso, '2026-10-27');
  assert.deepEqual(a.alternatives, []);
  const b = found(['EXP 27/10/2026'], us);
  assert.equal(b.primary.iso, '2026-10-27');
  assert.deepEqual(b.alternatives, []);
});

test('ambiguous numeric date follows the device region and asks to confirm', () => {
  const a = found(['EXP 03/04/2027'], uk);
  assert.equal(a.primary.iso, '2027-04-03');
  assert.equal(a.alternatives[0].iso, '2027-03-04');
  assert.ok(a.reasons.includes('ambiguous-order'));
  assert.equal(a.confidence, 'medium');

  const b = found(['EXP 03/04/2027'], us);
  assert.equal(b.primary.iso, '2027-03-04');
  assert.equal(b.alternatives[0].iso, '2027-04-03');
});

test('same day and month is not ambiguous', () => {
  const r = found(['EXP 05/05/2027']);
  assert.deepEqual(r.alternatives, []);
  assert.equal(r.confidence, 'high');
});

test('ignores the manufacturing date', () => {
  const r = found(['MFG 01/03/2026 EXP 01/03/2028']);
  assert.equal(r.label, 'expiry');
  assert.equal(r.primary.iso.slice(0, 4), '2028');
  const s = found(['MFD: 12 JAN 2026', 'BEST BEFORE: 12 JAN 2027']);
  assert.equal(s.primary.iso, '2027-01-12');
});

test('manufacturing date alone is not an expiry date', () => {
  const r = parseExpiry(['MFG DATE 12/01/2026'], uk);
  assert.deepEqual(r, { kind: 'none', hint: 'manufacture-only' });
  assert.equal(parseExpiry(['PACKED ON 27 OCT 2026'], uk).kind, 'none');
});

test('stacked labels over dates are matched by position', () => {
  const r = found(['MFG     EXP', '01/2025  01/2027']);
  assert.equal(r.primary.iso, '2027-01-31');
  assert.equal(r.primary.precision, 'month');
  assert.equal(r.label, 'expiry');
});

test('lot numbers, barcodes and prices are not dates', () => {
  assert.equal(parseExpiry(['LOT 2610271', '5012345678900'], uk).kind, 'none');
  assert.equal(parseExpiry(['£2.50  500g'], uk).kind, 'none');
  const r = parseExpiry(['LOT 27/10/2026'], uk);
  assert.equal(r.kind, 'none');
});

test('lot code next to the expiry date', () => {
  const r = found(['L2629 10:42', 'EXP 27/10/2026']);
  assert.equal(r.primary.iso, '2026-10-27');
});

test('month-only medicine dates', () => {
  const a = found(['EXP 10/2027']);
  assert.equal(a.primary.iso, '2027-10-31');
  assert.equal(a.primary.precision, 'month');
  assert.ok(a.reasons.includes('month-only'));
  assert.equal(a.confidence, 'high');
  assert.equal(formatDate(a.primary), 'Oct 2027');

  assert.equal(found(['EXP 2027-02']).primary.iso, '2027-02-28');
  assert.equal(found(['EXP', '10/27']).primary.iso, '2027-10-31');
  assert.equal(found(['EXP: 10/27']).primary.iso, '2027-10-31');
});

test('short MM/YY without a label is ignored', () => {
  assert.equal(parseExpiry(['10/27'], uk).kind, 'none');
});

test('compact YYYYMMDD only after an expiry label', () => {
  assert.equal(found(['EXP 20261027']).primary.iso, '2026-10-27');
  assert.equal(parseExpiry(['20261027'], uk).kind, 'none');
});

test('unlabelled date needs confirmation', () => {
  const r = found(['27 OCT 2026']);
  assert.equal(r.primary.iso, '2026-10-27');
  assert.ok(r.reasons.includes('no-label'));
  assert.equal(r.confidence, 'medium');
});

test('two unlabelled dates: picks the later and asks', () => {
  const r = found(['12/01/2026', '12/01/2027']);
  assert.equal(r.primary.iso.slice(0, 4), '2027');
  assert.ok(r.reasons.includes('multiple-dates'));
  assert.equal(r.confidence, 'medium');
});

test('past dates are flagged', () => {
  const r = found(['EXP 01 JAN 2026']);
  assert.ok(r.reasons.includes('in-past'));
  assert.equal(r.confidence, 'medium');
});

test('sell-by is not treated as expiry', () => {
  const r = found(['SELL BY 27 OCT 2026']);
  assert.ok(r.reasons.includes('sell-by'));
  assert.equal(r.confidence, 'medium');
});

test('fixes common OCR misreads inside numbers', () => {
  assert.equal(found(['EXP 27/1O/2O26']).primary.iso, '2026-10-27');
  assert.equal(found(['BEST BEFORE 2l OCT 2026']).primary.iso, '2026-10-21');
});

test('invalid calendar dates are rejected', () => {
  assert.deepEqual(parseExpiry(['EXP 31/02/2027'], uk), { kind: 'none', hint: 'invalid-date' });
  assert.equal(parseExpiry(['EXP 27/10/2099'], uk).kind, 'none');
});

test('no text and no date hints', () => {
  assert.deepEqual(parseExpiry([], uk), { kind: 'none', hint: 'no-text' });
  assert.deepEqual(parseExpiry(['Greek Yogurt', 'Plain'], uk), { kind: 'none', hint: 'no-date' });
});

test('label words must stand alone', () => {
  // "EXPLORE" and "BBQ" are not labels, so the date is unlabelled.
  assert.ok(found(['EXPLORE BBQ 27 OCT 2026']).reasons.includes('no-label'));
});

test('agreement key is stable for the same reading', () => {
  assert.equal(found(['EXP 27/10/2026']).key, found(['Exp: 27.10.2026']).key);
});

test('region to day order', () => {
  assert.equal(dayOrderForRegion('US'), 'MDY');
  assert.equal(dayOrderForRegion('GB'), 'DMY');
  assert.equal(dayOrderForRegion(null), 'DMY');
});

test('spec formats: long month names, dashes, EXPIRES', () => {
  assert.equal(found(['EXPIRES 27 October 2026']).primary.iso, '2026-10-27');
  assert.equal(found(['EXP 27-10-2026']).primary.iso, '2026-10-27');
  assert.equal(found(['USE BY 10/27/2026']).primary.iso, '2026-10-27');
  assert.equal(found(['Expires: 2026-10-27']).label, 'expiry');
});

test('missing year is assumed and must be confirmed', () => {
  const a = found(['BEST BEFORE 27 OCT']);
  assert.equal(a.primary.iso, '2026-10-27');
  assert.ok(a.reasons.includes('no-year'));
  assert.equal(a.confidence, 'medium');
  // Already passed this year, so next year.
  assert.equal(found(['USE BY 3 MAR']).primary.iso, '2027-03-03');
  // Without a label a bare "27 OCT" is not read.
  assert.equal(parseExpiry(['27 OCT'], uk).kind, 'none');
  // A full date still wins over the yearless reading.
  assert.equal(found(['EXP 27 OCT 2027']).reasons.includes('no-year'), false);
});

test('nutrition and weights are not dates', () => {
  assert.equal(parseExpiry(['Energy 450kJ / 108kcal', 'Fat 3.5g  Protein 10g', 'NET WT 500g'], uk).kind, 'none');
});

test('leap years', () => {
  assert.equal(found(['EXP 29/02/2028']).primary.iso, '2028-02-29');
  assert.deepEqual(parseExpiry(['EXP 29/02/2027'], uk), { kind: 'none', hint: 'invalid-date' });
  assert.equal(found(['EXP 02/2028']).primary.iso, '2028-02-29');
});

test('several dates: the labelled expiry wins over the earlier ones', () => {
  const r = found(['PROD 01/09/2026', 'LOT 2629 01/09/2026', 'BEST BEFORE 01/03/2027']);
  assert.equal(r.label, 'expiry');
  assert.equal(r.primary.iso.slice(0, 4), '2027');
});

// --- Printed-label photo regressions (the four reference photos) ---
// Photo 1/2: bett'r oats, date 06.03.2027 printed beside a lot prefix, an
// organic code, a version tag and the EAN digits. Photo 3: Nestlé cornflakes,
// month/year "05 2027" beside a lot number "L 61210968" and a production
// time "05:10 5 P4". Photo 4: barcode-only frame, no date at all.
test('photo: 06.03.2027 with lot prefix and barcode noise reads as 6 March 2027', () => {
  const a = found(['BG-BIO-22', 'EU AGRICULTURE', 'LDPE', '06.03.2027', 'NLAND', 'V4.2', '3 800233 686905']);
  assert.equal(a.primary.iso, '2027-03-06');
  assert.equal(a.primary.precision, 'day');
  assert.ok(a.reasons.includes('no-label'));

  // The lot prefix glued to the date through a slash (photo 2's line).
  const b = found(['26065/06.03.2027', 'FINLAND']);
  assert.equal(b.primary.iso, '2027-03-06');

  // Same line as one OCR read: still only the date, never the barcode.
  const c = found(['LDPE 06.03.2027 NLAND V4.2 3 800233 686905']);
  assert.equal(c.primary.iso, '2027-03-06');
});

test('photo: 05 2027 on cornflakes reads as May 2027, not the lot or time', () => {
  const r = found(['05 2027', 'L 61210968', '05:10 5 P4']);
  assert.equal(r.primary.iso, '2027-05-31');
  assert.equal(r.primary.precision, 'month');
  assert.ok(r.reasons.includes('month-only'));

  // Lot number and date on one OCR line: the date still reads.
  assert.equal(found(['L 61210968 05 2027']).primary.iso, '2027-05-31');

  // The Balkan expiry phrase above it upgrades the read to a labelled expiry.
  const labelled = found(['NAJBOLJE UPOTRJEBITI DO', '05 2027']);
  assert.equal(labelled.primary.iso, '2027-05-31');
  assert.equal(labelled.label, 'expiry');
  assert.equal(labelled.confidence, 'high');
});

test('photo: barcode-only frame finds no date', () => {
  assert.deepEqual(parseExpiry(['9 010437 034685'], uk), { kind: 'none', hint: 'no-date' });
  assert.equal(parseExpiry(['3 800233 686905'], uk).kind, 'none');
});

test('space-separated full dates: 06 03 2027', () => {
  assert.equal(found(['06 03 2027']).primary.iso, '2027-03-06');
  assert.equal(found(['06 03 2027'], us).primary.iso, '2027-06-03');
  assert.ok(found(['06 03 2027']).reasons.includes('ambiguous-order'));
  assert.equal(found(['BEST BEFORE', '06 03 2027']).label, 'expiry');
  assert.equal(found(['BEST BEFORE 06 03 2027']).primary.iso, '2027-03-06');
});

test('European label phrases in their languages', () => {
  assert.equal(found(['MINDESTENS HALTBAR BIS', '06.03.2027']).label, 'expiry');
  assert.equal(found(['A CONSOMMER AVANT LE', '06/03/2027']).label, 'expiry');
  assert.equal(found(['TEN MINSTE HOUD*BAAR TOT', '06 03 2027']).label, 'expiry');
  assert.equal(found(['SPOTRBUJTE DO', '2027-10-27']).label, 'expiry');
  assert.equal(found(['CONSUMIR PREFERENTEMENTE ANTES DEL', '10/2027']).label, 'expiry');
  assert.equal(found(['FELHASZNALHATO DO:', '2027.10.27.']).label, 'expiry');
});

test('versions, weights and decimals before a year do not become dates', () => {
  // "V4.2" then a month/year pair: the 2 must not be read as a DAY (which
  // would turn the version into "2 May 2027"); the pair itself still reads.
  const v = found(['V4.2 05 2027']);
  assert.equal(v.primary.iso, '2027-05-31');
  assert.equal(v.primary.precision, 'month');
  // Quantities and counts are not dates.
  assert.equal(parseExpiry(['300 GE 14.9 G 6 X 90'], uk).kind, 'none');
  assert.equal(parseExpiry(['05:10 5 P4'], uk).kind, 'none');
  assert.equal(parseExpiry(['L 61210968'], uk).kind, 'none');
});
