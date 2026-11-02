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

test('compact YYYYMMDD: confident after an expiry label, confirmed when bare', () => {
  assert.equal(found(['EXP 20261027']).primary.iso, '2026-10-27');
  assert.equal(found(['EXP 20261027']).confidence, 'high');
  // Bare: read (it stands alone in its line and is not past), but unlabelled.
  const bare = found(['20261027']);
  assert.equal(bare.primary.iso, '2026-10-27');
  assert.equal(bare.confidence, 'medium');
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

test('photo: Turkish PD/ED pair — ED is the expiry, PD the production date', () => {
  // The Turkish dot-matrix print style: production date, expiry date and lot
  // on adjacent short lines. ED (and its dotted/spaced forms) is an expiry
  // label; PD stays a production label, so its earlier date never wins.
  const r = found(['PD: 08.23', 'ED: 08.26', 'P.NO: 49.2']);
  assert.equal(r.primary.iso, '2026-08-31');
  assert.equal(r.primary.precision, 'month');
  assert.equal(r.label, 'expiry');
  // The production date alone reads as exactly that — a production month
  // (short MM/YY forms read after a production label too) — never an expiry.
  assert.deepEqual(parseExpiry(['PD: 08.23'], uk), { kind: 'none', hint: 'manufacture-only' });
  // A full production date IS a date candidate, just manufacture-labelled:
  // "manufacture-only", never an expiry.
  assert.deepEqual(parseExpiry(['URETIM TARIHI 24.03.21'], uk), { kind: 'none', hint: 'manufacture-only' });
  // The Turkish expiry phrase upgrades a bare date to a labelled expiry.
  const skt = found(['SON KULLANMA TARIHI', '08.26']);
  assert.equal(skt.primary.iso, '2026-08-31');
  assert.equal(skt.label, 'expiry');
});

test('photo: B.B.T FEB24 dot-matrix seal reads as February 2024', () => {
  // The compressed dotted label form ("B.B.T"/"B.B.E") plus a month + 2-digit
  // year, as dot-matrix seals print them.
  const r = found(['B.B.T', 'FEB24']);
  assert.equal(r.primary.iso, '2024-02-29');
  assert.equal(r.primary.precision, 'month');
  assert.equal(r.label, 'expiry');
  // Same on one line.
  assert.equal(found(['B.B.T FEB24']).primary.iso, '2024-02-29');
});

test('Bulgarian ГОДЕН ДО is an expiry label', () => {
  const r = found(['ГОДЕН ДО', '05 2027']);
  assert.equal(r.primary.iso, '2027-05-31');
  assert.equal(r.label, 'expiry');
  assert.equal(r.confidence, 'high');
});

test('ED-style label needs to be standalone, not inside a word', () => {
  // "RED" is not an expiry label; a date near it stays unlabelled.
  const r = found(['RED 10/2026']);
  assert.ok(r.reasons.includes('no-label'));
});

// ── International formats ──────────────────────────────────────────────────
// The regression suite for multi-market packaging: CJK marker dates,
// full-width digits, the 8-digit stamped forms, space-separated year-first
// dates, and label-language evidence resolving ambiguous day/month order.

test('CJK marker dates: YYYY年MM月DD日 and month-only YYYY年MM月', () => {
  // Chinese/Japanese full form with the markers; Korean form with spaces.
  assert.equal(found(['2027年03月15日']).primary.iso, '2027-03-15');
  assert.equal(found(['2027年3月5日']).primary.iso, '2027-03-05');
  assert.equal(found(['2027년 03월 15일']).primary.iso, '2027-03-15');
  // Month-only: the standard Chinese "best before month" print.
  assert.equal(found(['2027年03月']).primary.iso, '2027-03-31');
  assert.equal(found(['2027年03月']).primary.precision, 'month');
  // The expiry label in CJK upgrades the read to a labelled expiry.
  const labelled = found(['賞味期限', '2027年03月15日']);
  assert.equal(labelled.primary.iso, '2027-03-15');
  assert.equal(labelled.label, 'expiry');
});

test('full-width digits (Japanese print) read as their ASCII twins', () => {
  assert.equal(found(['２０２７．０３．１５']).primary.iso, '2027-03-15');
  assert.equal(found(['２０２７／０３／１５']).primary.iso, '2027-03-15');
});

test('year-first with spaces: the OCR form of CJK dates when markers are unreadable', () => {
  assert.equal(found(['2027 03 15']).primary.iso, '2027-03-15');
  assert.equal(found(['2027 3 5']).primary.iso, '2027-03-05');
  // No ambiguity flag: the position of the year settles the order.
  assert.ok(!found(['2027 03 15']).reasons.includes('ambiguous-order'));
});

test('8-digit stamped dates: EXP 03062027 follows the preferred order', () => {
  // Day-first user: 03 06 2027 = 3 June 2027.
  assert.equal(found(['EXP 03062027'], uk).primary.iso, '2027-06-03');
  assert.equal(found(['EXP 03062027'], uk).reasons.includes('ambiguous-order'), true);
  // Month-first user: March 6 2027.
  assert.equal(found(['EXP 03062027'], us).primary.iso, '2027-03-06');
  // The year-first 8-digit stamp stays unambiguous and wins first.
  assert.equal(found(['EXP 20260315']).primary.iso, '2026-03-15');
  assert.ok(!found(['EXP 20260315']).reasons.includes('ambiguous-order'));
  // Unlabelled 8-digit numbers read only as unlabelled dates to confirm.
  assert.ok(found(['03062027'], uk).reasons.includes('no-label'));
});

test('EU-language expiry label resolves an ambiguous date day-first', () => {
  // A month-first USER scanning German packaging: the continental phrase is
  // origin evidence, so 03/04/2027 reads as 3 April (day-first) regardless.
  const r = found(['MINDESTENS HALTBAR BIS', '03/04/2027'], us);
  assert.equal(r.primary.iso, '2027-04-03');
  assert.equal(r.label, 'expiry');
  // English labels keep the user's own preference (both markets use them).
  assert.equal(found(['BEST BEFORE 03/04/2027'], us).primary.iso, '2027-03-04');
  assert.equal(found(['BEST BEFORE 03/04/2027'], uk).primary.iso, '2027-04-03');
});

test('CJK production dates are manufacture, never expiry', () => {
  // Both printed: the 賞味期限 (best before) date wins, the 製造 (production)
  // date never becomes the expiry.
  const both = found(['製造年月日 2026.03.15', '賞味期限 2027.03.15'], uk);
  assert.equal(both.primary.iso, '2027-03-15');
  assert.equal(both.label, 'expiry');
  // A lone production date (any of the CJK forms) is honest manufacture-only.
  assert.deepEqual(parseExpiry(['生産年月日 2026.03.15'], uk), { kind: 'none', hint: 'manufacture-only' });
  assert.deepEqual(parseExpiry(['生产日期 2026.03.15'], uk), { kind: 'none', hint: 'manufacture-only' });
  assert.deepEqual(parseExpiry(['제조일자 2026.03.15'], uk), { kind: 'none', hint: 'manufacture-only' });
});

test('Korean expiry label reads the date as labelled expiry', () => {
  const r = found(['유통기한', '2027.03.15']);
  assert.equal(r.primary.iso, '2027-03-15');
  assert.equal(r.label, 'expiry');
});

// ── Russia, Ukraine, Israel, Romania ────────────────────────────────────────
// The four markets added for international coverage: their expiry labels
// (Cyrillic, Hebrew, Arabic, Romanian-with-diacritics), their manufacturing
// dates (which must never become the expiry), and their day-first evidence.

test('Russian labels: Срок годности and Годен до are expiry labels', () => {
  const a = found(['СРОК ГОДНОСТИ', '05.2027']);
  assert.equal(a.primary.iso, '2027-05-31');
  assert.equal(a.primary.precision, 'month');
  assert.equal(a.label, 'expiry');
  assert.equal(a.confidence, 'high');

  const b = found(['ГОДЕН ДО 04.12.27']);
  assert.equal(b.primary.iso, '2027-12-04');
  assert.equal(b.label, 'expiry');

  // A shelf-life DURATION after the label is not a date: only a year-bearing
  // shape is ever read, so "12 мес" (12 months) finds nothing date-like.
  assert.equal(parseExpiry(['СРОК ГОДНОСТИ 12 МЕС'], uk).kind, 'none');
  assert.equal(parseExpiry(['СРОК ГОДНОСТИ 2 ГОДА'], uk).kind, 'none');
});

test('Russian manufacturing date never becomes the expiry', () => {
  // Дата изготовления alone: honest manufacture-only.
  assert.deepEqual(parseExpiry(['ДАТА ИЗГОТОВЛЕНИЯ 04.12.23'], uk), { kind: 'none', hint: 'manufacture-only' });
  assert.deepEqual(parseExpiry(['ИЗГОТОВЛЕНО 04.12.23'], uk), { kind: 'none', hint: 'manufacture-only' });
  // Both printed: the Годен до date wins.
  const r = found(['ИЗГОТОВЛЕНО 04.12.23', 'ГОДЕН ДО 04.12.25']);
  assert.equal(r.primary.iso, '2025-12-04');
  assert.equal(r.label, 'expiry');
});

test('Ukrainian labels: Термін придатності and Вжити до', () => {
  // The photo regression: Ukrainian pouch, dot-matrix date under the barcode.
  const a = found(['ТЕРМІН ПРИДАТНОСТІ', '04.12.27']);
  assert.equal(a.primary.iso, '2027-12-04');
  assert.equal(a.label, 'expiry');

  const b = found(['ВЖИТИ ДО 15.06.2027']);
  assert.equal(b.primary.iso, '2027-06-15');
  assert.equal(b.label, 'expiry');

  // The production-date synonym Виготовлено is manufacture, never expiry.
  assert.deepEqual(parseExpiry(['ВИГОТОВЛЕНО 04.12.23'], uk), { kind: 'none', hint: 'manufacture-only' });
  assert.deepEqual(parseExpiry(['ВИРОБЛЕНО 04.12.23'], uk), { kind: 'none', hint: 'manufacture-only' });
});

test('Hebrew labels: תאריך תפוגה and לשימוש עד', () => {
  const a = found(['תאריך תפוגה', '03/2027']);
  assert.equal(a.primary.iso, '2027-03-31');
  assert.equal(a.primary.precision, 'month');
  assert.equal(a.label, 'expiry');

  const b = found(['לשימוש עד 15.06.2027']);
  assert.equal(b.primary.iso, '2027-06-15');
  assert.equal(b.label, 'expiry');

  // תאריך ייצור (production date) is manufacture, never expiry.
  assert.deepEqual(parseExpiry(['תאריך ייצור 15.06.2025'], uk), { kind: 'none', hint: 'manufacture-only' });
});

test('Arabic label: تاريخ انتهاء الصلاحية', () => {
  const r = found(['تاريخ انتهاء الصلاحية', '15.06.2027']);
  assert.equal(r.primary.iso, '2027-06-15');
  assert.equal(r.label, 'expiry');
  // Production date تاريخ الإنتاج is manufacture, never expiry.
  assert.deepEqual(parseExpiry(['تاريخ الإنتاج 15.06.2025'], uk), { kind: 'none', hint: 'manufacture-only' });
});

test('Romanian labels read through their diacritics', () => {
  // EXPIRĂ, A se consuma până la, Data expirării — as printed WITH diacritics;
  // normalizeLine strips them, the label patterns see the plain forms.
  assert.equal(found(['EXPIRĂ 15.06.2027']).label, 'expiry');
  assert.equal(found(['A se consuma până la 15.06.2027']).label, 'expiry');
  assert.equal(found(['A se consuma de preferință înainte de 15.06.2027']).label, 'expiry');
  const d = found(['DATA EXPIRĂRII', '15.06.2027']);
  assert.equal(d.primary.iso, '2027-06-15');
  assert.equal(d.label, 'expiry');
  // The same labels on packaging WITHOUT diacritics (common on laser print).
  assert.equal(found(['A SE CONSUMA PANA LA 15.06.2027']).label, 'expiry');
  // Data fabricației is the manufacturing date, never the expiry.
  assert.deepEqual(parseExpiry(['DATA FABRICAȚIEI 15.06.2025'], uk), { kind: 'none', hint: 'manufacture-only' });
  assert.deepEqual(parseExpiry(['DATA FABRICATIEI 15.06.2025'], uk), { kind: 'none', hint: 'manufacture-only' });
});

test('Russian/Ukrainian/Hebrew/Arabic/Romanian expiry labels are day-first evidence', () => {
  // A month-first USER scanning Russian packaging: 03/04/2027 reads day-first.
  const ru = found(['СРОК ГОДНОСТИ', '03/04/2027'], us);
  assert.equal(ru.primary.iso, '2027-04-03');
  assert.equal(ru.alternatives[0].iso, '2027-03-04');
  const ua = found(['ТЕРМІН ПРИДАТНОСТІ 03/04/2027'], us);
  assert.equal(ua.primary.iso, '2027-04-03');
  const he = found(['לשימוש עד 03/04/2027'], us);
  assert.equal(he.primary.iso, '2027-04-03');
  const ro = found(['A SE CONSUMA PANA LA 03/04/2027'], us);
  assert.equal(ro.primary.iso, '2027-04-03');
});

test('month/year forms with every separator: 03 2027, 03.2027, 03/2027, 03-2027', () => {
  // The user's clarification: the month/year print appears with spaces, dots,
  // slashes and dashes — all must read the same month-only date.
  assert.equal(found(['03 2027']).primary.iso, '2027-03-31');
  assert.equal(found(['03.2027']).primary.iso, '2027-03-31');
  assert.equal(found(['03/2027']).primary.iso, '2027-03-31');
  assert.equal(found(['03-2027']).primary.iso, '2027-03-31');
  for (const line of ['03 2027', '03.2027', '03/2027', '03-2027']) {
    assert.equal(found([line]).primary.precision, 'month', line);
    assert.ok(found([line]).reasons.includes('month-only'), line);
  }
  // The 8-digit stamped form from the same clarification (03 06 2027).
  assert.equal(found(['EXP 03062027'], uk).primary.iso, '2027-06-03');
});

// ─── Regression batch: the four real-device screenshots ──────────────────────

test('photo: 2028/05 beside LOT never flips to a production date', () => {
  // The Italian medicine bottle: the hourglass-marked "2028/05" and a LOT
  // code, read in either line order. A FUTURE date can never be a production
  // date, so whichever way OCR splits the lines the date is offered as an
  // (unlabelled) expiry — deterministically, frame after frame.
  for (const lines of [
    ['LOT 25F0684', '2028/05'],
    ['2028/05 LOT 25F0684'],
    ['2028/05', 'LOT 25F0684'],
    ['LOT', '2028/05'],
  ]) {
    const r = found(lines);
    assert.equal(r.primary.iso, '2028-05-31', JSON.stringify(lines));
    assert.equal(r.primary.precision, 'month', JSON.stringify(lines));
    assert.equal(r.label, null, JSON.stringify(lines));
    assert.ok(r.reasons.includes('no-label'), JSON.stringify(lines));
  }
  // A single-line read with the label AFTER the date behaves the same.
  assert.equal(found(['25F0684 LOT 2028/05']).primary.iso, '2028-05-31');
});

test('photo: SCAD (Italian scadenza) labels the date as expiry', () => {
  assert.equal(found(['SCAD. 05/2028']).primary.iso, '2028-05-31');
  assert.equal(found(['SCAD.: 2028/05']).label, 'expiry');
  assert.equal(found(['SCADENZA 27 OT 2027']).primary.iso, '2027-10-27');
  assert.equal(found(['SCAD 03/2027']).confidence, 'high');
});

test('photo: 20627 dot-matrix stamp reads as 20 June 2027', () => {
  // The glossy package print with no separators: day, single-digit month,
  // two-digit year. Day-first preferred; the month-first split survives as
  // the alternative the save sheet can offer.
  const r = found(['20627']);
  assert.equal(r.primary.iso, '2027-06-20');
  assert.equal(r.alternatives[0]?.iso, '2027-02-06');
  assert.ok(r.reasons.includes('ambiguous-order'));
  assert.ok(r.reasons.includes('no-label'));
  // With an expiry label the same digits read the same way — the label
  // vouches for the DATE, not the day/month order, so the ambiguity stays a
  // doubt and the save sheet asks (the "never accept an uncertain date" rule).
  assert.equal(found(['EXP 20627']).primary.iso, '2027-06-20');
  assert.equal(found(['BEST BEFORE 20627']).confidence, 'medium');
  assert.ok(found(['BEST BEFORE 20627']).reasons.includes('ambiguous-order'));
  assert.equal(found(['BEST BEFORE 20627']).alternatives[0]?.iso, '2027-02-06');
  // MDY preference flips the primary reading.
  assert.equal(found(['20627'], us).primary.iso, '2027-02-06');
});

test('photo: 6-digit no-separator stamp 200627 reads as 20.06.2027', () => {
  assert.equal(found(['200627']).primary.iso, '2027-06-20');
  // Only one calendar-valid split of these six digits (month "20" is not a
  // month), so there is no alternative to offer — unlike the 5-digit stamp.
  assert.equal(found(['200627']).alternatives.length, 0);
  assert.equal(found(['EXP 200627']).primary.iso, '2027-06-20');
});

test('past unlabelled compact stamps stay lot codes, not expiry dates', () => {
  // 26065 (the Finnish bag's lot): month 0 is not a calendar month.
  assert.equal(parseExpiry(['26065'], uk).kind, 'none');
  // 31125 parses day-first as 31 Jan 2025 — in the PAST, so bare it is a lot
  // code, not an expiry worth saving.
  assert.equal(parseExpiry(['31125'], uk).kind, 'none');
  assert.equal(parseExpiry(['200621'], uk).kind, 'none'); // 20.06.2021, past
  // Labelled past dates still read (flagged for the user to check).
  const r = found(['EXP 31125']);
  assert.equal(r.primary.iso, '2025-01-31');
  assert.ok(r.reasons.includes('in-past'));
});

test('long digit runs never partially match the compact stamps', () => {
  // A barcode or an 8-digit date inside one token: no 5/6-digit window reads.
  assert.equal(parseExpiry(['3800223071163'], uk).kind, 'none');
  // A bare 8-digit stamp alone in its line is now read (future dates only),
  // always as an unlabelled date the user must confirm; a past one is a code.
  const bare = found(['20261101']);
  assert.equal(bare.primary.iso, '2026-11-01');
  assert.ok(bare.reasons.includes('no-label'));
  assert.equal(parseExpiry(['20240101'], uk).kind, 'none');
  assert.equal(found(['EXP 03062027']).primary.iso, '2027-06-03');
});

// ─── Real-photo regressions (Nov 2026 scanner report) ───────────────────────

test('photo: ZUZU yogurt "Expiră la data de: 14/11" reads 14 Nov with the year to check', () => {
  // As printed: the label over two lines, the date with a time and lot beside it.
  for (const lines of [
    ['Expiră la', 'data de:', '14/11 16:38 B', 'L10 J'],
    ['Expiră la data de:', '14/11 16:38 B'],
    ['EXPIRĂ LA DATA DE: 14/11 16:38 B'],
  ]) {
    const r = found(lines);
    assert.equal(r.primary.iso, '2026-11-14', JSON.stringify(lines));
    assert.equal(r.label, 'expiry', JSON.stringify(lines));
    assert.ok(r.reasons.includes('no-year'), JSON.stringify(lines));
    assert.equal(r.confidence, 'medium', JSON.stringify(lines));
  }
  // Without any expiry label a bare "14/11" is not a date (it could be anything).
  assert.equal(parseExpiry(['14/11 16:38 B'], uk).kind, 'none');
  // A day/month already passed this year rolls to next year.
  assert.equal(found(['EXP 03/02']).primary.iso, '2027-02-03');
  // "EXP 10/27" stays month/year (October 2027), never 10 Jan... of a guessed year.
  assert.equal(found(['EXP 10/27']).primary.iso, '2027-10-31');
});

test('photo: cottage cheese dot-matrix 25.11.2026, including comma-read dots', () => {
  assert.equal(found(['25.11.2026']).primary.iso, '2026-11-25');
  assert.equal(found(['25,11.2026']).primary.iso, '2026-11-25');
  assert.equal(found(['25.11,2026', '26061 10:51']).primary.iso, '2026-11-25');
  // Decimal commas on the same pack are never dates.
  assert.equal(parseExpiry(['3,4% grasime', 'Cottage'], uk).kind, 'none');
});

test('photo: almond drink 07/08/27 with lot and time line', () => {
  const r = found(['07/08/27', 'L2196 07:55 N.34 A']);
  assert.equal(r.primary.iso, '2027-08-07');
  assert.ok(r.alternatives.some((a) => a.iso === '2027-07-08'));
  assert.ok(r.reasons.includes('ambiguous-order'));
  assert.equal(found(['07/08/27', 'L2196 07:55 N.34 A'], us).primary.iso, '2027-07-08');
});

test('photo: 2028/05 read in the same line as the LOT label is still an expiry candidate', () => {
  const r = found(['LOT 2028/05', '25F0684']);
  assert.equal(r.primary.iso, '2028-05-31');
  assert.equal(r.label, null); // unlabelled: reaches the save sheet, which asks to check it
  assert.equal(parseExpiry(['LOT 25F0684'], uk).kind, 'none');
  // A real production label still governs a month/year at the start of its line.
  assert.deepEqual(parseExpiry(['MFG 2025/05'], uk), { kind: 'none', hint: 'manufacture-only' });
});

test('photo: barcode-only images never produce a date', () => {
  assert.equal(parseExpiry(['3 838989 614249'], uk).kind, 'none');
  assert.equal(parseExpiry(['3838989614249'], uk).kind, 'none');
  assert.equal(parseExpiry(['3 800223 071163', 'PET'], uk).kind, 'none');
});

test('several dates on one package: every one is offered, nothing is silently chosen', () => {
  const r = found(['10.01.2026', '10.01.2027']);
  assert.ok(r.reasons.includes('multiple-dates'));
  assert.equal(r.confidence, 'medium');
  assert.equal(r.primary.iso, '2027-01-10');
  assert.ok(r.alternatives.some((a) => a.iso === '2026-01-10'));
  // A labelled expiry still wins over an unlabelled neighbour.
  const s = found(['EXP 10.01.2027', '10.01.2026']);
  assert.ok(!s.reasons.includes('multiple-dates'));
  assert.equal(s.primary.iso, '2027-01-10');
});

test('international expiry and production labels', () => {
  // Bulgarian
  assert.equal(found(['Срок на годност: 05.2027']).label, 'expiry');
  assert.equal(found(['Срок на годност', '31.12.2027']).primary.iso, '2027-12-31');
  const bg = found(['Дата на производство: 01.02.2026', 'Годно до: 01.02.2027']);
  assert.equal(bg.primary.iso, '2027-02-01');
  assert.equal(bg.label, 'expiry');
  assert.equal(parseExpiry(['Дата на производство: 01.02.2026'], uk).kind, 'none');
  // Russian, Polish, German, Romanian
  assert.equal(found(['Употребить до 15.03.2027']).label, 'expiry');
  assert.equal(found(['Należy spożyć do: 15.03.2027']).label, 'expiry');
  assert.equal(found(['MHD 06.03.2027']).label, 'expiry');
  assert.equal(found(['A se consuma inainte de: 06.03.2027']).label, 'expiry');
  assert.equal(parseExpiry(['Data fabricatiei: 06.03.2026'], uk).kind, 'none');
  // Hebrew and Chinese
  assert.equal(found(['בתוקף עד 15/03/2027']).primary.iso, '2027-03-15');
  const zh = found(['有效期至2027年3月15日']);
  assert.equal(zh.primary.iso, '2027-03-15');
  assert.equal(zh.label, 'expiry');
  // A continental label reads an ambiguous date day-first even for a US user.
  assert.equal(found(['Годно до: 03.04.2027'], us).primary.iso, '2027-04-03');
  // US month-first dates.
  assert.equal(found(['EXP 03/15/2027'], uk).primary.iso, '2027-03-15');
  assert.equal(found(['BEST BY 03/04/2027'], us).primary.iso, '2027-03-04');
  // Year-first and month/year forms.
  assert.equal(found(['EXP 2027/03/15']).primary.iso, '2027-03-15');
  assert.equal(found(['EXP 03.2027']).primary.iso, '2027-03-31');
});

// ─── Real-photo regressions (2 Nov 2026 scanner report) ─────────────────────

test('photo: bread bag 17112026 under its lot code L42A17 reads 17 Nov 2026', () => {
  const r = found(['L42A17', '17112026']);
  assert.equal(r.primary.iso, '2026-11-17');
  assert.equal(r.label, null);
  assert.equal(r.confidence, 'medium');
  // Labelled, the same stamp is high confidence.
  assert.equal(found(['EXP 17112026']).confidence, 'high');
  // An 8-digit run next to other long numbers is a barcode, not a date.
  assert.equal(parseExpiry(['17112026 5901234'], uk).kind, 'none');
  // US order for a US user when both orders are dates.
  const us8 = found(['03042027'], us);
  assert.equal(us8.primary.iso, '2027-03-04');
  assert.ok(us8.alternatives.some((a) => a.iso === '2027-04-03'));
});

test('photo: "EXPIRATION: 27280" is the US Julian code for 7 Oct 2027', () => {
  const r = found(['LOT: 1687054', 'EXPIRATION: 27280']);
  assert.equal(r.primary.iso, '2027-10-07');
  assert.equal(r.label, 'expiry');
  assert.ok(r.reasons.includes('coded-date'));
  assert.equal(r.confidence, 'medium');
  // Four-digit-year form.
  assert.equal(found(['EXP 2027280']).primary.iso, '2027-10-07');
  // Day 366 only exists in leap years.
  assert.equal(found(['EXP 28366']).primary.iso, '2028-12-31');
  assert.equal(parseExpiry(['EXP 27366'], uk).kind, 'none');
  // Without a label a 5-digit code is never read as Julian, and the LOT
  // number is never a date.
  assert.equal(parseExpiry(['27280'], uk).kind, 'none');
  assert.equal(parseExpiry(['LOT: 1687054'], uk).kind, 'none');
  // A 5-digit stamp that IS a day/month/year keeps that reading.
  assert.equal(found(['EXP 20627']).primary.iso, '2027-06-20');
});
