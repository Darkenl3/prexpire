// Run with: npm test
//
// Expiry dates country by country, as their packaging prints them (labels in
// the local language, the local date order, the local abbreviations), each
// run through the variations a camera read really produces:
//   as printed · upper case · lower case · the label on the line above ·
//   no space after the label · a lot code and a barcode on lines around it ·
//   letter O read for digit 0.
// Every variation must offer the expected date (as the reading the scanner
// picked, or an alternative the save sheet asks about), and none may report a
// production date or lot number as the expiry.
//
// Sources for the less familiar formats: Health Canada / CFIA date markings
// (year-month-day with bilingual month codes JA FE MR AL MA JN JL AU SE OC NO
// DE), Vietnam Decree 43/2017 (NSX / HSD, dd-mm-yy(yy)), Spanish-language
// labelling practice (CAD / VAL / Vto. / Vence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpiry, type ParseOptions } from './dateParser.ts';

const today = new Date(2026, 10, 2); // 2 Nov 2026
const dmy: ParseOptions = { today, preferredOrder: 'DMY' };
const mdy: ParseOptions = { today, preferredOrder: 'MDY' };

type Case = { label: string; date: string; iso: string; opts?: ParseOptions; extra?: string[] };

// [country, cases]: `label` is the expiry wording, `date` the printed date.
const COUNTRIES: [string, Case[]][] = [
  ['United Kingdom', [
    { label: 'BEST BEFORE', date: '15/03/27', iso: '2027-03-15' },
    { label: 'Best Before End', date: 'MAR 2027', iso: '2027-03-31' },
    { label: 'USE BY', date: '15 MAR 2027', iso: '2027-03-15' },
    { label: 'BBE', date: '03/2027', iso: '2027-03-31' },
  ]],
  ['United States', [
    { label: 'BEST BY', date: '03/15/2027', iso: '2027-03-15', opts: mdy },
    { label: 'BEST IF USED BY', date: 'MAR 15 2027', iso: '2027-03-15', opts: mdy },
    { label: 'EXP', date: '03/27', iso: '2027-03-31', opts: mdy },
    { label: 'USE BY', date: '03-15-27', iso: '2027-03-15', opts: mdy },
    { label: 'EXPIRATION', date: '27074', iso: '2027-03-15', opts: mdy },
  ]],
  ['Canada', [
    { label: 'BEST BEFORE / MEILLEUR AVANT', date: '27 MR 15', iso: '2027-03-15' },
    { label: 'BB/MA', date: '2027 AL 30', iso: '2027-04-30' },
    { label: 'MEILLEUR AVANT', date: '27 JN 15', iso: '2027-06-15' },
    { label: 'BEST BEFORE', date: '2027/03/15', iso: '2027-03-15' },
  ]],
  ['Mexico & Latin America', [
    { label: 'CAD', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'Cons. Pref.', date: '15 MAR 27', iso: '2027-03-15' },
    { label: 'Fecha de caducidad', date: '15.03.27', iso: '2027-03-15' },
    { label: 'Vto.', date: '03/2027', iso: '2027-03-31' },
    { label: 'Vence', date: '15/03/2027', iso: '2027-03-15' },
  ]],
  ['Brazil & Portugal', [
    { label: 'VAL', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'Validade', date: '15.03.27', iso: '2027-03-15' },
    { label: 'Consumir de preferência antes de', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'VAL.', date: 'MAR/2027', iso: '2027-03-31' },
  ]],
  ['Spain', [
    { label: 'Consumir preferentemente antes del', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'Consumir preferentemente antes del fin de', date: '03/2027', iso: '2027-03-31' },
    { label: 'Fecha de caducidad', date: '15-03-2027', iso: '2027-03-15' },
  ]],
  ['France & Belgium', [
    { label: 'A consommer de préférence avant le', date: '15/03/2027', iso: '2027-03-15' },
    { label: "A consommer jusqu'au", date: '15.03.27', iso: '2027-03-15' },
    { label: 'DDM', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'DLC', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'A consommer de préférence avant fin', date: 'MARS 2027', iso: '2027-03-31' },
  ]],
  ['Germany & Austria', [
    { label: 'Mindestens haltbar bis', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'MHD', date: '15.03.27', iso: '2027-03-15' },
    { label: 'zu verbrauchen bis', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Mindestens haltbar bis Ende', date: '03/2027', iso: '2027-03-31' },
  ]],
  ['Netherlands', [
    { label: 'Ten minste houdbaar tot', date: '15-03-2027', iso: '2027-03-15' },
    { label: 'THT', date: '15-03-27', iso: '2027-03-15' },
    { label: 'Te gebruiken tot', date: '15.03.2027', iso: '2027-03-15' },
  ]],
  ['Italy', [
    { label: 'Da consumarsi preferibilmente entro il', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'Da consumarsi entro il', date: '15.03.27', iso: '2027-03-15' },
    { label: 'Scad.', date: '03/2027', iso: '2027-03-31' },
    { label: 'Da consumarsi preferibilmente entro fine', date: 'MARZO 2027', iso: '2027-03-31' },
  ]],
  ['Poland', [
    { label: 'Najlepiej spożyć przed', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Należy spożyć do', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Data ważności', date: '15.03.2027', iso: '2027-03-15' },
  ]],
  ['Czechia & Slovakia', [
    { label: 'Minimální trvanlivost do', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Spotřebujte do', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Minimálna trvanlivosť do', date: '15.03.2027', iso: '2027-03-15' },
  ]],
  ['Hungary', [
    { label: 'Minőségét megőrzi', date: '2027.03.15.', iso: '2027-03-15' },
    { label: 'Fogyasztható', date: '2027.03.15.', iso: '2027-03-15' },
  ]],
  ['Romania', [
    { label: 'Expiră la', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'A se consuma de preferință înainte de', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Data limită de consum', date: '15.03.2027', iso: '2027-03-15' },
  ]],
  ['Bulgaria', [
    { label: 'Най-добър до', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Срок на годност', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Годен до', date: '15.03.2027', iso: '2027-03-15' },
  ]],
  ['Greece & Cyprus', [
    { label: 'Ανάλωση κατά προτίμηση πριν από', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'Ανάλωση έως', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Λήξη', date: '15/03/2027', iso: '2027-03-15' },
  ]],
  ['Turkey', [
    { label: 'SKT', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'TETT', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Son Tüketim Tarihi', date: '15.03.2027', iso: '2027-03-15' },
  ]],
  ['Nordics', [
    { label: 'Bäst före', date: '2027-03-15', iso: '2027-03-15' },
    { label: 'Best før', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Bedst før', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Parasta ennen', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Mindst holdbar til', date: '15.03.2027', iso: '2027-03-15' },
  ]],
  ['Russia & Ukraine', [
    { label: 'Годен до', date: '15.03.2027', iso: '2027-03-15' },
    { label: 'Срок годности до', date: '15.03.27', iso: '2027-03-15' },
    { label: 'Вжити до', date: '15.03.2027', iso: '2027-03-15' },
  ]],
  ['Israel', [
    { label: 'לשימוש עד', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'תאריך תפוגה', date: '15.03.27', iso: '2027-03-15' },
    { label: 'בתוקף עד', date: '15/03/27', iso: '2027-03-15' },
  ]],
  ['Arab countries', [
    { label: 'تاريخ الانتهاء', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'صالح حتى', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'EXP', date: '2027/03/15', iso: '2027-03-15' },
  ]],
  ['China & Taiwan', [
    { label: '保质期至', date: '2027.03.15', iso: '2027-03-15' },
    { label: '有效期至', date: '2027年03月15日', iso: '2027-03-15' },
    { label: '到期日', date: '2027/03/15', iso: '2027-03-15' },
    { label: '有效日期', date: '2027.03.15', iso: '2027-03-15' },
  ]],
  ['Japan', [
    { label: '賞味期限', date: '27.03.15', iso: '2027-03-15' },
    { label: '賞味期限', date: '2027.03.15', iso: '2027-03-15' },
    { label: '消費期限', date: '2027年3月15日', iso: '2027-03-15' },
    { label: '賞味期限', date: '2027.03', iso: '2027-03-31' },
  ]],
  ['Korea', [
    { label: '유통기한', date: '2027.03.15', iso: '2027-03-15' },
    { label: '소비기한', date: '2027.03.15까지', iso: '2027-03-15' },
    { label: '유통기한', date: '2027년 03월 15일까지', iso: '2027-03-15' },
  ]],
  ['Vietnam', [
    { label: 'HSD', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'HSD', date: '15032027', iso: '2027-03-15' },
    { label: 'Hạn sử dụng', date: '15.03.27', iso: '2027-03-15' },
  ]],
  ['Thailand', [
    { label: 'EXP', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'หมดอายุ', date: '15/03/2570', iso: '2027-03-15' },
    { label: 'ควรบริโภคก่อน', date: '15/03/27', iso: '2027-03-15' },
  ]],
  ['Indonesia & Malaysia', [
    { label: 'Baik digunakan sebelum', date: '15 03 2027', iso: '2027-03-15' },
    { label: 'ED', date: '15-03-27', iso: '2027-03-15' },
    { label: 'Tarikh luput', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'Kedaluwarsa', date: '15.03.2027', iso: '2027-03-15' },
  ]],
  ['India', [
    { label: 'BEST BEFORE', date: '03/2027', iso: '2027-03-31' },
    { label: 'EXP. DATE', date: '15/03/2027', iso: '2027-03-15' },
    { label: 'USE BEFORE', date: 'MAR 2027', iso: '2027-03-31' },
  ]],
  ['Australia & New Zealand', [
    { label: 'BB', date: '15 MAR 27', iso: '2027-03-15' },
    { label: 'Use By', date: '15MAR27', iso: '2027-03-15' },
    { label: 'Best Before', date: '15/03/27', iso: '2027-03-15' },
  ]],
  ['Medicine (worldwide)', [
    { label: 'EXP', date: '2027-03', iso: '2027-03-31' },
    { label: 'EXP', date: '03 2027', iso: '2027-03-31' },
    { label: 'Scad.', date: '03/2027', iso: '2027-03-31' },
    { label: 'EXP', date: '032027', iso: '2027-03-31' },
  ]],
];

// The variations a camera read produces, applied to one case.
function variations(c: Case): [string, string[]][] {
  const line = `${c.label} ${c.date}`;
  const o = (s: string) => s.replace(/0/g, 'O');
  return [
    ['as printed', [line]],
    ['with a colon', [`${c.label}: ${c.date}`]],
    ['upper case', [line.toUpperCase()]],
    ['lower case', [line.toLowerCase()]],
    ['label on the line above', [c.label, c.date]],
    ['no space after the label', [`${c.label}:${c.date}`]],
    ['lot code and barcode around it', ['LOT A2391', line, '5 901234 123457']],
    ['O read for 0', [`${c.label} ${o(c.date)}`]],
  ];
}

for (const [country, cases] of COUNTRIES) {
  test(`country formats: ${country}`, () => {
    const failures: string[] = [];
    for (const c of cases) {
      for (const [how, lines] of variations(c)) {
        const r = parseExpiry(lines, c.opts ?? dmy);
        const got = r.kind === 'found' ? [r.primary, ...r.alternatives].map((i) => i.iso) : [];
        if (!got.includes(c.iso)) failures.push(`${how}: ${JSON.stringify(lines)} -> ${r.kind === 'found' ? got.join(' | ') : r.hint}`);
        // The local expiry wording itself must be recognised as an expiry
        // label (not just the date found without it): that is what makes
        // the reading confident and wins over a production date nearby.
        else if (how === 'as printed' && r.kind === 'found' && r.label !== 'expiry') failures.push(`label not recognised: "${c.label}"`);
      }
    }
    assert.equal(failures.length, 0, `\n${failures.join('\n')}`);
  });
}

// Production dates printed beside the expiry, in the same languages: the
// expiry must win, never the production date.
const PAIRS: [string, string[], string][] = [
  ['Vietnam NSX/HSD', ['NSX: 15/03/2026', 'HSD: 15/03/2028'], '2028-03-15'],
  ['Brazil FAB/VAL', ['FAB: 15/03/2026 VAL: 15/03/2028'], '2028-03-15'],
  ['Egypt PRD/EXP', ['PRD: 15/03/2026 EXP: 15/03/2028'], '2028-03-15'],
  ['China 生产日期/保质期至', ['生产日期 2026.03.15', '保质期至 2028.03.15'], '2028-03-15'],
  ['Korea 제조일자/소비기한', ['제조일자 2026.03.15', '소비기한 2028.03.15까지'], '2028-03-15'],
  ['Russia изготовления/годен до', ['Дата изготовления 15.03.2026', 'Годен до 15.03.2028'], '2028-03-15'],
  ['India MFD/EXP', ['MFD: 03/2026', 'EXP: 03/2028'], '2028-03-31'],
  ['Turkey ÜT/SKT', ['ÜT: 15.03.2026', 'SKT: 15.03.2028'], '2028-03-15'],
  ['Romania fabricației/expiră', ['Data fabricației: 15.03.2026', 'Expiră la: 15.03.2028'], '2028-03-15'],
  ['Spain fabricación/caducidad', ['Fecha de fabricación 15/03/2026', 'Fecha de caducidad 15/03/2028'], '2028-03-15'],
];

for (const [name, lines, iso] of PAIRS) {
  test(`production + expiry pair: ${name}`, () => {
    const r = parseExpiry(lines, dmy);
    assert.equal(r.kind, 'found', JSON.stringify(r));
    if (r.kind !== 'found') return;
    assert.equal(r.primary.iso, iso, `${JSON.stringify(lines)} -> ${r.primary.iso}`);
  });
}

// A shelf life instead of an expiry date (India, China, Vietnam).
const SHELF: [string, string[], string][] = [
  ['India "best before 12 months from manufacture"', ['MFD: 15/03/2026', 'BEST BEFORE 12 MONTHS FROM MANUFACTURE'], '2027-03-15'],
  ['Vietnam NSX + 30 tháng', ['NSX: 15/03/2026', 'HSD: 30 tháng kể từ NSX'], '2028-09-15'],
  ['China 保质期 18个月', ['生产日期: 20260315', '保质期: 18个月'], '2027-09-15'],
];

for (const [name, lines, iso] of SHELF) {
  test(`shelf life: ${name}`, () => {
    const r = parseExpiry(lines, dmy);
    assert.equal(r.kind, 'found', JSON.stringify(r));
    if (r.kind !== 'found') return;
    assert.equal(r.primary.iso, iso);
  });
}
