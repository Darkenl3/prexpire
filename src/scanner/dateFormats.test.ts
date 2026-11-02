// Run with: npm test
//
// The world's expiry-date formats, one table. Every row is a real way dates
// are printed on packaging somewhere (EU, US, UK, Romania, Bulgaria, Russia,
// Ukraine, Poland, Turkey, Israel, the Arab world, China, Japan, Korea), and
// the parser must offer the expected date — as the reading it picked, or as an
// alternative the save sheet asks about when the print is genuinely ambiguous.
// The second table is the other half of the job: text that must NOT become a
// date.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpiry, readShelfLife, type ParseOptions } from './dateParser.ts';

const today = new Date(2026, 10, 2); // 2 Nov 2026
const dmy: ParseOptions = { today, preferredOrder: 'DMY' };

function offers(lines: string[], iso: string, opts = dmy) {
  const r = parseExpiry(lines, opts);
  const got = r.kind === 'found' ? [r.primary, ...r.alternatives].map((i) => i.iso) : [];
  assert.ok(got.includes(iso), `${JSON.stringify(lines)} should offer ${iso}, got ${r.kind === 'found' ? got.join(' | ') : JSON.stringify(r)}`);
  if (r.kind !== 'found') throw new Error('unreachable');
  return r;
}

const FORMATS: [string, string[], string][] = [
  // Numeric, day first (EU, UK, Israel, Russia, Romania, Bulgaria...)
  ['EU dots', ['EXP 15.03.2027'], '2027-03-15'],
  ['EU slash', ['EXP 15/03/2027'], '2027-03-15'],
  ['EU dash', ['EXP 15-03-2027'], '2027-03-15'],
  ['EU two-digit year', ['EXP 15.03.27'], '2027-03-15'],
  ['EU bare', ['15.03.2027'], '2027-03-15'],
  ['EU with a time', ['15.03.2027 10:51'], '2027-03-15'],
  ['EU spaced separators', ['EXP 15 / 03 / 2027'], '2027-03-15'],
  // Numeric, month first (US)
  ['US slash', ['EXP 03/15/2027'], '2027-03-15'],
  ['US two-digit year', ['EXP 03/15/27'], '2027-03-15'],
  // Year first (ISO, China, Japan, Korea)
  ['ISO', ['EXP 2027-03-15'], '2027-03-15'],
  ['ISO slash', ['EXP 2027/03/15'], '2027-03-15'],
  ['year-first dots', ['2027.03.15'], '2027-03-15'],
  ['Japanese YY.MM.DD', ['EXP 27.03.15'], '2027-03-15'],
  ['Japanese YY.MM.DD with label', ['賞味期限 27.03.15'], '2027-03-15'],
  ['Chinese/Japanese YYMMDD', ['EXP 270315'], '2027-03-15'],
  ['Japanese era (Reiwa 9)', ['賞味期限 R9.3.15'], '2027-03-15'],
  ['Japanese era in kanji', ['賞味期限 令和9年3月15日'], '2027-03-15'],
  // Compact stamps
  ['YYYYMMDD after a label', ['EXP 20270315'], '2027-03-15'],
  ['YYYYMMDD bare', ['20270315'], '2027-03-15'],
  ['DDMMYYYY bare', ['15032027'], '2027-03-15'],
  ['DDMMYY after a label', ['EXP 150327'], '2027-03-15'],
  ['DMYY 5-digit after a label', ['EXP 15327'], '2027-03-15'],
  // Month and year
  ['MM/YYYY', ['EXP 03/2027'], '2027-03-31'],
  ['MM/YY', ['EXP 03/27'], '2027-03-31'],
  ['MMYY after a label', ['EXP 0327'], '2027-03-31'],
  ['YYYY/MM', ['EXP 2027/03'], '2027-03-31'],
  ['YYYY-MM', ['EXP 2027-03'], '2027-03-31'],
  ['MM.YYYY', ['EXP 03.2027'], '2027-03-31'],
  ['MM YYYY', ['03 2027'], '2027-03-31'],
  // English month names
  ['15 MAR 2027', ['EXP 15 MAR 2027'], '2027-03-15'],
  ['15MAR27', ['EXP 15MAR27'], '2027-03-15'],
  ['15-MAR-2027', ['EXP 15-MAR-2027'], '2027-03-15'],
  ['MAR 15 2027', ['EXP MAR 15 2027'], '2027-03-15'],
  ['MAR 15, 2027', ['BEST BY MAR 15, 2027'], '2027-03-15'],
  ['MAR 2027', ['EXP MAR 2027'], '2027-03-31'],
  ['MAR27', ['EXP MAR27'], '2027-03-31'],
  ["MAR '27", ["EXP MAR '27"], '2027-03-31'],
  ['MARCH 2027', ['BEST BEFORE END MARCH 2027'], '2027-03-31'],
  ['15 MAR, no year', ['BEST BEFORE 15 MAR'], '2027-03-15'],
  // Month names in other languages
  ['French', ['A CONSOMMER AVANT LE 15 MARS 2027'], '2027-03-15'],
  ['German', ['MINDESTENS HALTBAR BIS 15. März 2027'], '2027-03-15'],
  ['Spanish', ['CONSUMIR ANTES DEL 15 ABR 2027'], '2027-04-15'],
  ['Italian', ['DA CONSUMARSI ENTRO 15 MARZO 2027'], '2027-03-15'],
  ['Portuguese', ['EXP 15 MAIO 2027'], '2027-05-15'],
  ['Dutch', ['TEN MINSTE HOUDBAAR TOT 15 MRT 2027'], '2027-03-15'],
  ['Polish', ['NALEZY SPOZYC DO 15 MAR 2027'], '2027-03-15'],
  ['Polish genitive', ['Należy spożyć do 15 października 2027'], '2027-10-15'],
  ['Turkish', ['SKT 15 MART 2027'], '2027-03-15'],
  ['Turkish Şubat', ['SKT 15 Şubat 2027'], '2027-02-15'],
  ['Russian genitive', ['ГОДЕН ДО 15 марта 2027'], '2027-03-15'],
  ['Russian abbreviation', ['ГОДЕН ДО 15 МАР 2027'], '2027-03-15'],
  ['Russian май', ['Годен до 15 мая 2027 г.'], '2027-05-15'],
  ['Ukrainian', ['Вжити до 15 березня 2027'], '2027-03-15'],
  // Romanian
  ['Romanian EXPIRA LA', ['EXPIRA LA 15 MARTIE 2027'], '2027-03-15'],
  ['Romanian diacritics', ['Expiră la: 15.03.2027'], '2027-03-15'],
  ['Romanian best before end', ['A se consuma de preferință înainte de sfârșitul: 03.2027'], '2027-03-31'],
  ['Romanian use-by date', ['Data limită de consum: 15.03.2027'], '2027-03-15'],
  ['Romanian validity term', ['Termen de valabilitate: 15.03.2027'], '2027-03-15'],
  ['Romanian abbreviation', ['A se consuma înainte de: 15 IUN 2027'], '2027-06-15'],
  // Bulgarian
  ['Bulgarian best before', ['Най-добър до: 15.03.2027'], '2027-03-15'],
  ['Bulgarian month name', ['Най-добър до 15 март 2027'], '2027-03-15'],
  ['Bulgarian use by', ['Използвай до 15.03.2027'], '2027-03-15'],
  ['Bulgarian consume by', ['Да се консумира до: 15.03.2027'], '2027-03-15'],
  ['Bulgarian shelf-life label', ['Срок на годност: 15.03.2027'], '2027-03-15'],
  ['Bulgarian юни', ['Годно до 15 юни 2027'], '2027-06-15'],
  // Hebrew
  ['Hebrew expiry date', ['תאריך תפוגה 15/03/2027'], '2027-03-15'],
  ['Hebrew use by', ['לשימוש עד 15/03/27'], '2027-03-15'],
  ['Hebrew valid until', ['בתוקף עד 15.03.2027'], '2027-03-15'],
  ['Hebrew consume by', ['יש לצרוך עד 15.03.2027'], '2027-03-15'],
  ['Hebrew best before', ['עדיף לצרוך עד 15.03.2027'], '2027-03-15'],
  ['Hebrew month name', ['תפוגה 15 מרץ 2027'], '2027-03-15'],
  // Roman-numeral months (Poland, Russia, Bulgaria, Czechia)
  ['Roman 15.III.2027', ['15.III.2027'], '2027-03-15'],
  ['Roman 15 III 27', ['ГОДЕН ДО 15 III 27'], '2027-03-15'],
  ['Roman XII', ['EXP 01.XII.2027'], '2027-12-01'],
  ['Roman III.2027', ['EXP III.2027'], '2027-03-31'],
  // East Asian markers
  ['Chinese 年月日', ['保质期至2027年3月15日'], '2027-03-15'],
  ['Japanese 年月日', ['賞味期限 2027年3月15日'], '2027-03-15'],
  ['Korean 년월일', ['유통기한 2027년 03월 15일'], '2027-03-15'],
  // Arabic-Indic and Persian digits
  ['Arabic-Indic digits', ['تاريخ انتهاء الصلاحية ١٥/٠٣/٢٠٢٧'], '2027-03-15'],
  ['Persian digits', ['انقضا ۱۵/۰۳/۲۰۲۷'], '2027-03-15'],
  // US Julian (year + day of the year) codes
  ['Julian YYDDD', ['EXP 27074'], '2027-03-15'],
  ['Julian YYYYDDD', ['EXP 2027074'], '2027-03-15'],
  ['Julian YDDD', ['EXP 7074'], '2027-03-15'],
  // Dot-matrix misreads
  ['O read for 0', ['EXP 15.O3.2O27'], '2027-03-15'],
  ['Z read for 2', ['EXP 15.03.Z027'], '2027-03-15'],
  ['G read for 6', ['EXP 1G.03.2027'], '2027-03-16'],
  // Layout
  ['label on the line above', ['BEST BEFORE', '15.03.2027'], '2027-03-15'],
  ['label after the date', ['15.03.2027 EXP'], '2027-03-15'],
  ['production + expiry pair', ['MFG 15.03.2026 EXP 15.03.2028'], '2028-03-15'],
  ['Turkish production + expiry pair', ['ÜT 15.03.2026 SKT 15.03.2028'], '2028-03-15'],
  // Production date + printed shelf life, no expiry date printed
  ['Chinese shelf life in months', ['生产日期 2026.03.15 保质期 24个月'], '2028-03-15'],
  ['Russian shelf life in months', ['Дата изготовления 15.03.2026', 'Срок годности 24 месяца'], '2028-03-15'],
  ['Bulgarian shelf life in months', ['Дата на производство: 15.03.2026', 'Срок на годност: 18 месеца'], '2027-09-15'],
  ['Romanian shelf life in months', ['Data fabricației: 15.03.2026', 'Termen de valabilitate: 12 luni'], '2027-03-15'],
  ['English shelf life in days', ['MFG 01.11.2026', 'SHELF LIFE: 90 DAYS'], '2027-01-30'],
];

for (const [name, lines, iso] of FORMATS) {
  test(`format: ${name}`, () => {
    offers(lines, iso);
  });
}

test('ambiguous prints are offered both ways, never silently decided', () => {
  // A European-looking 26.03.27 next to a Japanese label: year-first leads,
  // day-first stays as the alternative.
  const jp = offers(['賞味期限 26.03.27'], '2026-03-27');
  assert.equal(jp.primary.iso, '2026-03-27');
  assert.ok(jp.alternatives.some((a) => a.iso === '2027-03-26'));
  // Without an East-Asian label the same print reads day-first (Europe).
  assert.equal(offers(['EXP 26.03.27'], '2027-03-26').primary.iso, '2027-03-26');
  // A computed expiry always asks.
  const life = offers(['生产日期 2026.03.15 保质期 24个月'], '2028-03-15');
  assert.equal(life.confidence, 'medium');
  assert.ok(life.reasons.includes('shelf-life'));
  // A Julian code always asks.
  assert.ok(offers(['EXP 7074'], '2027-03-15').reasons.includes('coded-date'));
});

test('text that must never become a date', () => {
  const none = (lines: string[]) => assert.equal(parseExpiry(lines, dmy).kind, 'none', JSON.stringify(lines));
  none(['EXP 2027']); // a bare year is not a date
  none(['МАЙОНЕЗА 2027']); // a month inside a word ("mayonnaise")
  none(['MARTIENS 2027']);
  none(['V 2027', 'X 15']); // a lone Roman letter is not a month
  none(['LOT 1687054']);
  none(['3 838989 614249']);
  none(['3,4% grasime']);
  none(['Срок на годност 24 месеца']); // a shelf life alone, with no production date
  none(['5G 2027']); // a network label, not a misread date
});

test('shelf life is read in many languages and units', () => {
  assert.deepEqual(readShelfLife(['保质期 24个月']), { n: 24, unit: 'month' });
  assert.deepEqual(readShelfLife(['Срок годности: 6 месяцев']), { n: 6, unit: 'month' });
  assert.deepEqual(readShelfLife(['Срок годности 30 суток']), { n: 30, unit: 'day' });
  assert.deepEqual(readShelfLife(['Срок на годност: 2 години']), { n: 2, unit: 'year' });
  assert.deepEqual(readShelfLife(['Termen de valabilitate: 12 luni']), { n: 12, unit: 'month' });
  assert.deepEqual(readShelfLife(['SHELF LIFE 18 MONTHS']), { n: 18, unit: 'month' });
  assert.deepEqual(readShelfLife(['賞味期限 1年']), { n: 1, unit: 'year' });
  assert.equal(readShelfLife(['24 months warranty']), null); // no shelf-life label
});

test('Cyrillic lookalike letters inside numbers read as digits', () => {
  // О (Cyrillic O) for 0, З for 3, Б for 6, І for 1 — what the reader returns
  // for digits when Cyrillic recognition is on.
  offers(['EXP 1З.О6.2О28'], '2028-06-13');
  offers(['ГОДЕН ДО 1Б.11.2027'], '2027-11-16');
  offers(['EXP І5.03.2027'], '2027-03-15');
  // Cyrillic words with no digit stay words.
  assert.equal(parseExpiry(['ЗОО'], dmy).kind, 'none');
});

test('photo: chocolate "012028L813" is January 2028 with lot L813 glued on', () => {
  const r = offers(['012028L813'], '2028-01-31');
  assert.equal(r.primary.precision, 'month');
  assert.equal(r.primary.iso, '2028-01-31');
  offers(['012028'], '2028-01-31');
  offers(['EXP 012028'], '2028-01-31');
  offers(['122027 L5521'], '2027-12-31');
  // The lot number itself is never a date.
  assert.equal(parseExpiry(['L813'], dmy).kind, 'none');
  // A past month/year without a label is a code, not an expiry.
  assert.equal(parseExpiry(['012024'], dmy).kind, 'none');
  // 6-digit day/month/year stamps keep reading as before.
  assert.equal(offers(['EXP 200627'], '2027-06-20').primary.iso, '2027-06-20');
});
