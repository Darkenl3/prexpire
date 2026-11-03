// Finds the expiry date in text read off a package label.
//
// The parser only reads text; it never decides on its own that a date is safe to save.
// Every result says how sure it is, and `reasons` lists what the user has to check
// (an ambiguous day/month order, a date without an EXP or BEST BEFORE label, and so on).
// This file has no React Native imports so it can be tested with plain Node.

export type DayOrder = 'DMY' | 'MDY';

export type LabelKind = 'expiry' | 'manufacture' | 'lot' | 'sell';

export type Precision = 'day' | 'month';

export type Interpretation = {
  // ISO calendar date, YYYY-MM-DD. Month-only dates ("EXP 10/2026") use the last day of the month.
  iso: string;
  precision: Precision;
  // The label printed no year ("BEST BEFORE 27 OCT"); the next such date was assumed.
  yearGuessed?: boolean;
  // Printed as a code, not a calendar date: the US "Julian" form, year plus
  // day of the year ("27280" = day 280 of 2027 = 7 Oct 2027).
  coded?: boolean;
};

export type DateCandidate = {
  raw: string;
  line: number;
  interpretations: Interpretation[];
  label: LabelKind | null;
  labelText: string | null;
};

export type ConfirmReason =
  // 03/04/2026 could be 3 April or 4 March.
  | 'ambiguous-order'
  // No EXP / BEST BEFORE / USE BY label next to the date.
  | 'no-label'
  // Several different dates could be the expiry date.
  | 'multiple-dates'
  // Only a month and year were printed.
  | 'month-only'
  // The date has already passed.
  | 'in-past'
  // Labelled SELL BY / DISPLAY UNTIL, which is not the same as an expiry date.
  | 'sell-by'
  // No year was printed, so it was assumed.
  | 'no-year'
  // Printed as a year + day-of-year code ("27280"); worth a second look.
  | 'coded-date'
  // Calculated: the production date plus the printed shelf life.
  | 'shelf-life';

export type ScanParseResult =
  | {
      kind: 'found';
      // The most likely reading, then the other readings of the same printed date.
      primary: Interpretation;
      alternatives: Interpretation[];
      confidence: 'high' | 'medium';
      reasons: ConfirmReason[];
      label: LabelKind | null;
      labelText: string | null;
      raw: string;
      // Everything that was read, so callers can guess the product's category
      // from the words around the date (see scanner/categoryGuess.ts).
      text: string;
      // Stable across frames that read the same thing, for multi-frame agreement.
      key: string;
    }
  | {
      kind: 'none';
      // Why nothing usable was found, for the hint under the frame.
      hint: 'no-text' | 'no-date' | 'manufacture-only' | 'invalid-date';
    };

export type ParseOptions = {
  today: Date;
  // Order to prefer for numeric dates where both readings are valid. Comes from the device region.
  preferredOrder: DayOrder;
  // Set per line by the parser itself (callers leave it out): an East-Asian
  // expiry label on the line makes two-digit-year dates read year-first.
  yearFirst?: boolean;
};

// Regions that write numeric dates month first. Everyone else reads day first.
const MONTH_FIRST_REGIONS = new Set(['US', 'PH', 'FM', 'MH', 'PW', 'GU', 'AS', 'MP', 'UM', 'VI', 'PR', 'BZ', 'CA']);

export function dayOrderForRegion(region: string | null | undefined): DayOrder {
  return region && MONTH_FIRST_REGIONS.has(region.toUpperCase()) ? 'MDY' : 'DMY';
}

// Month names and their printed abbreviations, as they read AFTER
// normalizeLine (upper-cased, accents stripped: "März" → MARZ, "Şubat" →
// SUBAT, "март" → МАРТ, "май" → МАИ since the breve is stripped too). English
// first, then the languages of imported goods: French, German, Italian,
// Spanish, Portuguese, Dutch, Romanian, Polish, Turkish, Russian, Ukrainian,
// Bulgarian and Hebrew. A spelling shared by two languages always means the
// same month in both (MAR, MAI, OKT); the few that would collide are left out.
const MONTHS: Record<string, number> = {
  // English
  JAN: 1, JANUARY: 1, FEB: 2, FEBRUARY: 2, MAR: 3, MARCH: 3, APR: 4, APRIL: 4, MAY: 5, JUN: 6, JUNE: 6,
  JUL: 7, JULY: 7, AUG: 8, AUGUST: 8, SEP: 9, SEPT: 9, SEPTEMBER: 9, OCT: 10, OCTOBER: 10, NOV: 11, NOVEMBER: 11,
  DEC: 12, DECEMBER: 12,
  // French
  JANV: 1, JANVIER: 1, FEV: 2, FEVR: 2, FEVRIER: 2, MARS: 3, AVR: 4, AVRIL: 4, MAI: 5, JUIN: 6, JUIL: 7,
  JUILLET: 7, AOUT: 8, SEPTEMBRE: 9, OCTOBRE: 10, NOVEMBRE: 11, DECEMBRE: 12,
  // German
  JANUAR: 1, FEBR: 2, FEBRUAR: 2, MRZ: 3, MAERZ: 3, MARZ: 3, JUNI: 6, JULI: 7, OKT: 10, OKTOBER: 10, DEZ: 12, DEZEMBER: 12,
  // Italian
  GEN: 1, GENNAIO: 1, FEBBRAIO: 2, MARZO: 3, APRILE: 4, MAG: 5, MAGGIO: 5, GIU: 6, GIUGNO: 6, LUG: 7, LUGLIO: 7,
  AGO: 8, AGOSTO: 8, SET: 9, SETTEMBRE: 9, OTT: 10, OT: 10, OTTOBRE: 10, DIC: 12, DICEMBRE: 12,
  // Spanish
  ENE: 1, ENERO: 1, FEBRERO: 2, ABR: 4, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
  // Portuguese
  JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, MAIO: 5, JUNHO: 6, JULHO: 7, SETEMBRO: 9, OUT: 10, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12,
  // Dutch
  JANUARI: 1, FEBRUARI: 2, MRT: 3, MAART: 3, MEI: 5, AUGUSTUS: 8,
  // Romanian
  IAN: 1, IANUARIE: 1, FEBRUARIE: 2, MARTIE: 3, APRILIE: 4, IUN: 6, IUNIE: 6, IUL: 7, IULIE: 7,
  SEPTEMBRIE: 9, OCTOMBRIE: 10, NOI: 11, NOIEMBRIE: 11, DECEMBRIE: 12,
  // Polish
  STY: 1, STYCZEN: 1, STYCZNIA: 1, LUT: 2, LUTY: 2, LUTEGO: 2, MARZEC: 3, MARCA: 3, KWI: 4, KWIECIEN: 4, KWIETNIA: 4,
  MAJ: 5, MAJA: 5, CZE: 6, CZERWIEC: 6, CZERWCA: 6, LIP: 7, LIPIEC: 7, LIPCA: 7, SIE: 8, SIERPIEN: 8, SIERPNIA: 8,
  WRZ: 9, WRZESIEN: 9, WRZESNIA: 9, PAZ: 10, PAZDZIERNIK: 10, PAZDZIERNIKA: 10, LIS: 11, LISTOPAD: 11, LISTOPADA: 11,
  GRU: 12, GRUDZIEN: 12, GRUDNIA: 12,
  // Turkish
  OCA: 1, OCAK: 1, SUB: 2, SUBAT: 2, MART: 3, NIS: 4, NISAN: 4, MAYIS: 5, HAZ: 6, HAZIRAN: 6, TEM: 7, TEMMUZ: 7,
  AGU: 8, AGUSTOS: 8, EYL: 9, EYLUL: 9, EKI: 10, EKIM: 10, KAS: 11, KASIM: 11, ARA: 12, ARALIK: 12,
  // Russian (nominative, genitive "15 марта", and printed abbreviations)
  ЯНВ: 1, ЯНВАРЬ: 1, ЯНВАРЯ: 1, ФЕВ: 2, ФЕВР: 2, ФЕВРАЛЬ: 2, ФЕВРАЛЯ: 2, МАР: 3, МАРТ: 3, МАРТА: 3,
  АПР: 4, АПРЕЛЬ: 4, АПРЕЛЯ: 4, МАИ: 5, МАЯ: 5, ИЮН: 6, ИЮНЬ: 6, ИЮНЯ: 6, ИЮЛ: 7, ИЮЛЬ: 7, ИЮЛЯ: 7,
  АВГ: 8, АВГУСТ: 8, АВГУСТА: 8, СЕН: 9, СЕНТ: 9, СЕНТЯБРЬ: 9, СЕНТЯБРЯ: 9, ОКТ: 10, ОКТЯБРЬ: 10, ОКТЯБРЯ: 10,
  НОЯ: 11, НОЯБ: 11, НОЯБРЬ: 11, НОЯБРЯ: 11, ДЕК: 12, ДЕКАБРЬ: 12, ДЕКАБРЯ: 12,
  // Ukrainian (genitive, as dates print it)
  СІЧ: 1, СІЧНЯ: 1, ЛЮТ: 2, ЛЮТОГО: 2, БЕР: 3, БЕРЕЗНЯ: 3, КВІ: 4, КВІТНЯ: 4, ТРАВ: 5, ТРАВНЯ: 5,
  ЧЕРВ: 6, ЧЕРВНЯ: 6, ЛИП: 7, ЛИПНЯ: 7, СЕРП: 8, СЕРПНЯ: 8, ВЕР: 9, ВЕРЕСНЯ: 9, ЖОВТ: 10, ЖОВТНЯ: 10,
  ЛИСТ: 11, ЛИСТОПАДА: 11, ГРУД: 12, ГРУДНЯ: 12,
  // Bulgarian
  ЯНУ: 1, ЯНУАРИ: 1, ФЕВРУАРИ: 2, АПРИЛ: 4, ЮНИ: 6, ЮЛИ: 7, СЕП: 9, СЕПТЕМВРИ: 9, ОКТОМВРИ: 10, НОЕ: 11, НОЕМВРИ: 11,
  ДЕКЕМВРИ: 12,
  // Hebrew (Israeli packaging writes the civil months)
  ינואר: 1, פברואר: 2, מרץ: 3, מרס: 3, אפריל: 4, מאי: 5, יוני: 6, יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10,
  נובמבר: 11, דצמבר: 12,
};

const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');

// Month words stand alone: no letter of ANY script directly before or after
// (the Latin-only [A-Z] guard let Cyrillic and Hebrew months match inside words).
const ML = '(?<!\\p{L})';
const MR = '(?!\\p{L})';

// Canada's bilingual two-letter month codes (English/French compromise).
const CANADA_MONTHS: Record<string, number> = { JA: 1, FE: 2, MR: 3, AL: 4, MA: 5, JN: 6, JL: 7, AU: 8, SE: 9, OC: 10, NO: 11, DE: 12 };

// Roman-numeral months (Polish, Russian, Bulgarian and Czech packaging:
// "15.III.2027"), longest first so XII wins over XI and X.
const ROMAN: Record<string, number> = { XII: 12, XI: 11, X: 10, IX: 9, VIII: 8, VII: 7, VI: 6, V: 5, IV: 4, III: 3, II: 2, I: 1 };
const ROMAN_ALT = Object.keys(ROMAN).join('|');

// Labels, longest phrases first so "BEST BEFORE END" wins over "BEST BEFORE".
const LABELS: { kind: LabelKind; pattern: string }[] = [
  { kind: 'expiry', pattern: 'BEST\\s*BEFORE\\s*END|BEST\\s*BEFORE|BEST\\s*BY|BEST\\s*IF\\s*USED\\s*BY|USE\\s*BEFORE|USE\\s*BY' },
  { kind: 'expiry', pattern: 'EXPIRY\\s*DATE|EXPIRATION\\s*DATE|EXP\\.?\\s*DATE|EXP\\.?\\s*DT|EXPIRY|EXPIRATION|EXPIRES|EXPIRE|EXPD|EXP|BB\\s*/\\s*MA|BBE|B\\s*/\\s*B|BB|E\\s*/\\s*D|E\\.?\\s*D' },
  // The standard expiry phrases of the other EU packaging languages, as they
  // read after accent stripping (diacritics are removed in normalizeLine, so
  // these patterns stay plain ASCII). Imported goods carry these next to the
  // very dates this scanner is for, and their presence upgrades a bare number
  // to a labelled expiry. Multi-word phrases only: "DO" alone would collide.
  {
    kind: 'expiry',
    pattern:
      'MINDESTENS\\s*HALTBAR(?:\\s*(?:BIS|END))?|HALTBAR\\s*BIS|MIN\\.?\\s*HALTBAR' +
      '|A\\s*CONSOMMER(?:\\s*DE\\s*PREFERENCE)?\\s*AVANT(?:\\s*LE)?|CONSOMMER(?:\\s*DE\\s*PREFERENCE)?\\s*AVANT' +
      '|HOUDBAAR(?:HEID)?\\s*TOT|TE\\s*GEBRUIKEN\\s*(?:TOT|VOR)|TEN\\s*MINSTE\\s*HOUD\\*BAAR' +
      '|NAJBOLJE\\s*UPOTR[IJ]EBITI(?:\\s*DO)?|UPOTR[IJ]EBA(?:\\s*DO)?|ROK\\s*(?:POUZITOSTI|UPOTREBE|TRAJANJA)' +
      '|SPOTRBUJTE\\s*DO|DO\\s*SPOTREBY|MINIMALNA\\s*TRVANLIVOST' +
      '|NAJLEPIEJ\\s*SPOZYT\\s*PRZED|PRZYDATNOSC\\s*DO\\s*SPOZYCIA' +
      '|CONSUMIR(?:\\s*PREFERENTEMENTE)?\\s*ANTES\\s*DEL?|CADUCA(?:\\s*EL)?|CONSUMIR\\s*ANTES\\s*DE' +
      '|DA\\s*CONSUMARSI(?:\\s*ENTRO)?|CONSUMARE\\s*ENTRO|FELHASZNALHATO(?:\\s*DO)?|MINOSSEGMEGORZES(?:\\s*VEG)?' +
      // Turkish: "son kullanma tarihi" (expiry date) and its abbreviations, as
      // printed next to dates on Turkish goods (SKT on one line, the date on
      // the next — the label-only line join below already covers that).
      '|SON\\s*KULLANMA\\s*TARIHI|SON\\s*KUL\\.?\\s*TAR\\.?|SKT' +
      // Bulgarian/Macedonian: "годен до" (valid until). Cyrillic survives
      // normalizeLine's accent strip, and OCR engines that read Cyrillic at
      // all deliver it upper-cased, which the label match already expects.
      '|ГОДЕН\\s*ДО' +
      // East-Asian expiry phrases (only reachable when the OCR actually reads
      // CJK - Apple Vision does with the language packs present; the web OCR
      // returns such dates in their numeric forms, which the patterns read
      // without needing the words): Japanese shomikigen / shohikigen,
      // Chinese baozhiqi / daoqiri, Korean yutonggihan.
      // Written in POST-mapping form: the 年/月/日 markers inside these words
      // are consumed as date separators before labels are matched, so the
      // patterns spell the words without them (到期日→"到期-",
      // 製造年月日→"製造---", 生产日期→"生产--", 제조일자→"제조-").
      '|賞味期限|消費期限|保质期|保質期|到期|有效期限|유통기한|품질\\s*유지기한' +
      // Russian: "срок годности" (the standard shelf-life/expiry label) and
      // "годен до" (valid until — shared with Bulgarian). Cyrillic survives
      // normalizeLine untouched and upper-cases correctly.
      '|СРОК\\s*ГОДНОСТИ|ТЕРМ[ИІ]Н\\s*ГОДНОСТ[ИІ]' +
      // Ukrainian: "термін придатності" (shelf life/expiry — the Cyrillic І is
      // Ukraine's own letter, so both it and the Russian-style И are covered)
      // and "вжити до" / "краще вжити до" (use by / best used by).
      '|ТЕРМ[ИІ]Н\\s*ПРИДАТНОСТ[ИІ]|ВЖИТИ\\s*ДО|КРАЩЕ\\s*ВЖИТИ\\s*ДО' +
      // Hebrew: "תאריך תפוגה" (expiry date) and "לשימוש עד" (use by) — the two
      // labels Israeli packaging prints beside DD/MM/YYYY dates. Only the
      // native OCR path reads Hebrew; the digits themselves are read by every
      // engine either way.
      '|תאריך\\s*תפוגה|לשימוש\\s*עד' +
      // Arabic: "تاريخ انتهاء الصلاحية" (expiry date), the label of Arabic
      // packaging across the Middle East.
      '|تاريخ\\s*انتهاء\\s*الصلاحية' +
      // Romanian, as it reads AFTER accent stripping (ă→a, ș→s, ț→t, î→i):
      // "EXP" alone does not match "EXPIRĂ" (the standalone guard), so the
      // stripped form needs its own branch — plus the "use by"/"best before"
      // phrases and "data expirării".
      // The full "Expiră la data de:" phrase is consumed whole, so a line that
      // holds only it joins the date on the next line (joinLabelOnlyLines).
      '|EXPIRA(?:\\s*LA(?:\\s*DATA(?:\\s*DE)?)?)?|A\\s*SE\\s*CONSUMA\\s*PANA\\s*LA' +
      '|A\\s*SE\\s*CONSUMA\\s*DE\\s*PREFERINTA\\s*INAINTE\\s*DE(?:\\s*SFARSITUL)?' +
      '|A\\s*SE\\s*CONSUMA\\s*INAINTE\\s*DE(?:\\s*SFARSITUL)?|DATA\\s*EXPIRARII|DATA\\s*DE\\s*EXPIRARE|VALABIL\\s*PANA\\s*LA' +
      // Romanian "data limită de consum" (use-by date) and "termen de
      // valabilitate" (validity term), printed beside the date.
      '|DATA\\s*LIMITA\\s*DE\\s*CONSUM|TERMEN\\s*DE\\s*VALABILITATE' +
      // Bulgarian: "срок на годност" (shelf life), "най-добър до" (best
      // before), "годно до" / "използвай до" (use by), "да се консумира
      // до/преди" (to be consumed by/before). Й reads as И here: normalizeLine
      // strips its breve like any other accent.
      '|СРОК\\s*НА\\s*ГОДНОСТ|НА[ИЙ][\\s-]*ДОБЪР\\s*ДО|ГОДНО\\s*ДО|ИЗПОЛЗВА[ИЙ]\\s*ДО|ДА\\s*СЕ\\s*КОНСУМИРА\\s*(?:ДО|ПРЕДИ)' +
      // Russian "употребить до" / "использовать до" (use by), Polish
      // "należy spożyć do" (use by), German "MHD" (the printed abbreviation of
      // Mindesthaltbarkeitsdatum), English "valid until".
      '|УПОТРЕБИТЬ\\s*ДО|ИСПОЛЬЗОВАТЬ\\s*ДО|NALEZY\\s*SPOZYC\\s*DO|MHD|VALID\\s*(?:UNTIL|TILL|THRU|THROUGH)' +
      // Hebrew "בתוקף עד" (valid until) and the Chinese expiry-date words
      // 失效日期 / 有效期 (after the longer 有效期限 above has had its turn).
      '|בתוקף\\s*עד|失效-?期|有效期' +
      // More Hebrew: "להשתמש עד" (use by), "יש לצרוך עד" / "עדיף לצרוך עד"
      // (consume by / best consumed by), "תפוגה" alone and its "ת. תפוגה"
      // abbreviation. Arabic "انتهاء" / "ينتهي" (expiry / expires) and Persian
      // "انقضا" (expiry) for Middle-Eastern packs.
      '|להשתמש\\s*עד|יש\\s*לצרוך\\s*עד|עדיף\\s*לצרוך\\s*עד|ת\\.?\\s*תפוגה|תפוגה|انتهاء|ينتهي|انقضا' +
      // Italian: "scadenza" (expiry) and its pharma abbreviation "SCAD." —
      // the label Italian medicine and supplement packaging prints beside
      // the date (often the only word there; the hourglass-style icons are
      // product design, not reliable OCR text). SCADENZA is listed first so
      // the full word wins over the abbreviation at the same position.
      '|SCADENZA|SCAD\\.?',
  },
  {
    // Expiry wordings found missing by the country test table
    // (countryFormats.test.ts), as they read after normalizeLine (accents
    // stripped, upper case; ø and Greek/Arabic/Thai/CJK letters stay):
    // Scandinavia, Iberia and Latin America, France, Germany, Poland,
    // Czechia, Hungary, Turkey, Greece, Vietnam, Indonesia, Malaysia,
    // Thailand, the Arab world, Taiwan and Korea. Three earlier entries had
    // spelling slips (SPOZYT, SPOTRBUJTE, MINOSSEGMEGORZES) and never matched;
    // the correct spellings are here.
    kind: 'expiry',
    pattern:
      'BAST\\s*FORE|BEST\\s*F[OØ]R|BEDST\\s*F[OØ]R|MINDST\\s*HOLDBAR\\s*TIL|SISTA\\s*FORBRUKNINGSDAG|PARASTA\\s*ENNEN|VIIMEINEN\\s*KAYTTOPAIVA' +
      "|CONSUMIR\\s*DE\\s*PREFERENCIA\\s*ANTES\\s*DE|FECHA\\s*DE\\s*CADUCIDAD|FECHA\\s*DE\\s*VENCIMIENTO|CADUCIDAD|CONS\\.?\\s*PREF\\.?|VENCIMENTO|VENCIMIENTO|VALIDADE|VENCE|VTO\\.?|VAL\\.?|CAD\\.?" +
      "|A\\s*CONSOMMER\\s*JUSQU.?\\s*AU|DLUO|DDM|DLC|ZU\\s*VERBRAUCHEN\\s*BIS|NAJLEPIEJ\\s*SPOZYC\\s*PRZED|DATA\\s*WAZNOSCI" +
      '|MINIMALN[IA]\\s*TRVANLIVOST|SPOTREBUJTE\\s*DO|MINOSEGET\\s*MEGORZI|FOGYASZTHATO|SON\\s*TUKETIM\\s*TARIHI|TETT|THT|TGT' +
      '|ΑΝΑΛΩΣΗ|ΛΗΞΗ|HAN\\s*SU\\s*DUNG|HSD|BAIK\\s*DIGUNAKAN\\s*SEBELUM|KEDALUWARSA|KADALUARSA|KADALUWARSA|TARIKH\\s*LUPUT' +
      '|หมดอายุ|ควรบริโภคก่อน|صالح\\s*حتى|صالح\\s*لغاية|يستهلك\\s*قبل|有效-期|保存期限|소비기한|MEILLEUR\\s*AVANT',
  },
  {
    kind: 'manufacture',
    // The production-date wordings of the same countries: Vietnam (NSX),
    // Brazil and Spain (FAB / fabricación), Egypt and the Gulf (PRD), Greece,
    // Thailand, Indonesia.
    pattern:
      'NSX|NGAY\\s*SAN\\s*XUAT|FECHA\\s*DE\\s*FABRICACION|DATA\\s*DE\\s*FABRICACAO|FABRICACAO|FABRICACION|FAB\\.?|PRD\\.?|ΠΑΡΑΓΩΓΗ|ผลิต|TANGGAL\\s*PRODUKSI|TARIKH\\s*DIBUAT',
  },
  {
    kind: 'manufacture',
    pattern:
      'DATE\\s*OF\\s*MANUFACTURE|DATE\\s*OF\\s*MFG|MANUFACTURED(?:\\s*ON)?|MANUFACTURE|MANUF|MFG\\.?\\s*DATE|MFG|MFD(?:\\s*ON)?|MFR|PRODUCTION\\s*DATE|PRODUCED(?:\\s*ON)?|PROD\\.?\\s*DATE|PROD|PACKED(?:\\s*ON)?|PACK\\s*DATE|PKD|MADE\\s*ON|DOM|P\\s*/\\s*D|PD' +
      // Turkish production date ("üretim tarihi", upper-cased and unaccented
      // by normalizeLine): the OTHER date on Turkish packaging, which must not
      // be mistaken for the expiry.
      '|URETIM\\s*TARIHI|URET[II]M\\s*TAR\\.?' +
      // East-Asian production dates: Japanese seizo nengappi, Chinese
      // shengchan riqi, Korean jego ilja - the other date on East-Asian goods.
      // 生产日期 / 生産日期 read "生产-期" here (日 is already a separator), so
      // the full form is listed first and the date right after it pairs up.
      '|生产-期|生産-期|製造|生産|生产|제조' +
      // Russian production date: "дата изготовления" / "изготовлено" (the bare
      // stem covers every inflection — Cyrillic letters pass the [A-Z] word
      // guards, and every word grown on this stem still means "manufactured").
      '|ДАТА\\s*ИЗГОТОВЛЕНИЯ|ИЗГОТОВЛЕН' +
      // Ukrainian production date: "дата виготовлення" / "виготовлено", and
      // the synonym "вироблено" (made) — the date that must never become the
      // expiry on Ukrainian packaging.
      '|ДАТА\\s*ВИГОТОВЛЕННЯ|ДАТА\\s*ВИРОБЛЕННЯ|ВИГОТОВЛЕН|ВИРОБЛЕН' +
      // Hebrew production date: "תאריך ייצור" — the other date next to
      // תאריך תפוגה on Israeli packaging.
      '|תאריך\\s*ייצור' +
      // Arabic production date: "تاريخ الإنتاج" and its hamza-less spelling
      // "تاريخ الانتاج" — both are printed, so both are listed.
      '|تاريخ\\s*الإنتاج|تاريخ\\s*الانتاج' +
      // Romanian production date, post-accent-strip: "data fabricației" and
      // "data de fabricație".
      '|DATA\\s*FABRICATIEI|DATA\\s*DE\\s*FABRICATIE|DATA\\s*PRODUCTIEI|FABRICAT(?:\\s*LA)?|DATA\\s*AMBALARII|AMBALAT(?:\\s*LA)?' +
      // Bulgarian "дата на производство" / "произведено" / "пакетирано"
      // (packed), Russian "дата производства", Polish "data produkcji",
      // German "hergestellt am".
      '|ДАТА\\s*НА\\s*ПРОИЗВОДСТВО|ПРОИЗВЕДЕН|ПАКЕТИРАН|ДАТА\\s*ПРОИЗВОДСТВА|DATA\\s*PRODUKCJI|HERGESTELLT(?:\\s*AM)?',
  },
  {
    kind: 'lot',
    // Cyrillic batch labels ("Парт. №", "партида", "партия") and the Italian
    // "lotto" sit beside the dates on imported medicine and food.
    pattern: 'LOT\\s*NO|LOTTO|LOT|BATCH\\s*NO|BATCH|B\\.?\\s*NO|L\\.?\\s*NO|PARTIDA|ПАРТИДА|ПАРТИЯ|ПАРТ\\.?\\s*№?',
  },
  { kind: 'sell', pattern: 'SELL\\s*BY|DISPLAY\\s*UNTIL' },
  {
    // Dot-matrix seals print the expiry label compressed to initials with
    // full stops ("B.B.T" / "B.B.E" style, Best Before End in another
    // spelling); the dotted forms would never match the plain BB above.
    kind: 'expiry',
    pattern: 'B\\s*\\.\\s*B\\s*\\.\\s*[ET]',
  },
];

// Label words must stand alone: "EXP" but not "EXPLORE", "BB" but not "BBQ".
const LABEL_RE = new RegExp(
  LABELS.map((l, i) => `(?<l${i}>(?<![A-Z])(?:${l.pattern})(?![A-Z]))`).join('|'),
  'g',
);

type Span = { start: number; end: number };

type RawDate = Span & { raw: string; interpretations: Interpretation[] };

type FoundLabel = Span & { kind: LabelKind; text: string };

// OCR often reads O as 0, I or L as 1, S as 5 and B as 8 inside numbers. Only standalone
// tokens that already contain a digit are touched, so "OCT", "BEST" or "27OCT" keep their letters.
function normalizeDigits(line: string): string {
  // G (6) and Z (2) are the usual dot-matrix confusions on top of those. With
  // Cyrillic recognition on, the reader can also return CYRILLIC lookalikes
  // for digits (О for 0, З for 3, Б for 6, І for 1) — read as digits too.
  return line.replace(/(?<![A-Z])[0-9OILSBGZ|ОЗБІ]+(?![A-Z])/g, (token) => {
    if (!/[0-9]/.test(token)) return token;
    return token
      .replace(/[OО]/g, '0')
      .replace(/[IL|І]/g, '1')
      .replace(/S/g, '5')
      .replace(/B/g, '8')
      .replace(/[GБ]/g, '6')
      .replace(/Z/g, '2')
      .replace(/З/g, '3');
  });
}

export function normalizeLine(line: string): string {
  const upper = line
    // East-Asian date markers become separators FIRST — before the NFD step,
    // because Korean Hangul syllables (년/월/일) decompose into jamo under NFD
    // and would stop matching. "2027年3月15日" and "2027년 03월 15일" collapse
    // into the plain YYYY-MM-DD shape the patterns already read (a trailing
    // marker leaves a trailing dash, which the digit guards tolerate).
    .replace(/[年년]/g, '-')
    .replace(/[月월]/g, '-')
    .replace(/[日일]/g, '-')
    // Full-width digits and punctuation (Japanese packaging) become their
    // ASCII twins.
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    // Arabic-Indic (٠-٩) and Persian (۰-۹) digits, as Middle-Eastern packs
    // print them, become ASCII digits too.
    .replace(/[٠-٩]/g, (ch) => String(ch.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (ch) => String(ch.charCodeAt(0) - 0x6f0))
    .replace(/．/g, '.')
    .replace(/／/g, '/')
    .replace(/－/g, '-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Recompose: the Korean label syllables (유통기한…) come back as single
    // characters, which the CJK label patterns are written against.
    .normalize('NFC')
    .toUpperCase()
    // Dashes and dots that OCR returns as other characters.
    .replace(/[‐-―−]/g, '-')
    .replace(/[·•]/g, '.')
    .replace(/\s+/g, ' ');
  // A lot code printed straight after a date with no space ("012028L813" =
  // 01/2028 then lot L813): split it off as a LOT label before the digit
  // clean-up below would read its L as a 1 and fuse the two into one number.
  // A standalone "L5521" is a lot code too ("L" + 3 or more digits).
  const lotSplit = upper.replace(/(\d{4,})L(?=\d)/g, '$1 LOT ').replace(/(^|\s)L(?=\d{3,}(?:\s|$))/g, '$1LOT ');
  return splitGluedDates(normalizeDigits(lotSplit)).trim();
}

// A date the reader glued to the numbers around it — two stamped lines read
// as one ("12/07/281209375193"), a code run straight into the day
// ("93751912/07/28") — is cut free, anchored on its separators and its year:
// a 20xx four-digit year when the digits after the month say so
// ("12/07/2028120937"), otherwise two digits. Only separator-shaped dates are
// cut, so plain codes are never split into dates.
function splitGluedDates(line: string): string {
  return line
    // The whole digit run after the month decides: a plain year (2 digits,
    // or 4 starting 20) is left alone; a longer run is cut after its 20xx
    // year when it starts 20, otherwise after two digits.
    .replace(/(\d{1,2})([./-])(\d{1,2})\2(\d+)/g, (all, d: string, sep: string, mo: string, run: string) => {
      // (25xx is a Thai Buddhist-era year: also complete.)
      if (run.length === 2 || (run.length === 4 && (run.startsWith('20') || run.startsWith('25')))) return all;
      // A dot-matrix year whose "20" was misread ("8026"): also complete
      // (the lookalike pattern decides whether it reads as a date).
      if (run.length === 4 && /^[2378][0689]/.test(run)) return all;
      if (run.length < 2) return all;
      const year = run.startsWith('20') && run.length > 4 ? run.slice(0, 4) : run.slice(0, 2);
      return `${d}${sep}${mo}${sep}${year} ${run.slice(year.length)}`;
    })
    // A code of three or more digits run into a two-digit day. (A shorter
    // prefix is the start of a year-first date — "2027-03-15" — not a code.)
    .replace(/(\d{3,})(\d{2}[./-]\d{1,2}[./-](?:20\d{2}|\d{2})(?!\d))/g, '$1 $2');
}

const pad = (n: number) => String(n).padStart(2, '0');

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function makeYear(text: string): number {
  const n = Number(text);
  if (text.length === 2) return 2000 + n;
  // Thai packaging may print the Buddhist-era year (2570 = 2027 CE).
  if (n >= 2540 && n <= 2599) return n - 543;
  return n;
}

function toDay(year: number, month: number, day: number): Interpretation | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { iso: `${year}-${pad(month)}-${pad(day)}`, precision: 'day' };
}

function toMonth(year: number, month: number): Interpretation | null {
  if (month < 1 || month > 12) return null;
  return { iso: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`, precision: 'month' };
}

type Pattern = {
  re: RegExp;
  // Only used when an expiry label sits right before the date (too easy to confuse otherwise).
  labelledOnly?: boolean;
  // Bare compact stamps only count when they stand ALONE in their line: a
  // line carrying other long digit runs is a barcode or serial number, and
  // its digit groups are not dates ("9 010437 034685").
  isolatedOnly?: boolean;
  read: (m: RegExpExecArray, opts: ParseOptions) => Interpretation[];
};

const SEP = '\\s?[./\\-]\\s?';
// Between a month name and its numbers: spaces, dots, slashes, commas, dashes
// and the apostrophe of a shortened year ("MAR '27").
const SP = "[\\s./,'’\\-]*";
const NB = '(?<![0-9])';
const NA = '(?![0-9])';

// Order matters: earlier patterns claim their text first.
const PATTERNS: Pattern[] = [
  // 27 MR 15 / 2027 MR 15 - Canada's bilingual date: YEAR, a two-letter month
  // code shared by English and French (JA FE MR AL MA JN JL AU SE OC NO DE),
  // then the day (Health Canada / CFIA date markings). Two-letter codes are
  // too easily ordinary text, so only right after an expiry label
  // ("BEST BEFORE / MEILLEUR AVANT", "BB/MA").
  {
    re: new RegExp(`${NB}(\\d{4}|\\d{2})\\s?${ML}(JA|FE|MR|AL|MA|JN|JL|AU|SE|OC|NO|DE)${MR}\\s?(\\d{1,2})${NA}`, 'gu'),
    labelledOnly: true,
    read: (m) => [toDay(makeYear(m[1]), CANADA_MONTHS[m[2]], Number(m[3]))].filter(Boolean) as Interpretation[],
  },
  // 27 OCT 2026, 27OCT26, 27TH OCTOBER 2026
  {
    re: new RegExp(`${NB}(\\d{1,2})(?:ST|ND|RD|TH)?${SP}${ML}(${MONTH_ALT})${MR}${SP}(\\d{4}|\\d{2})${NA}`, 'gu'),
    read: (m) => [toDay(makeYear(m[3]), MONTHS[m[2]], Number(m[1]))].filter(Boolean) as Interpretation[],
  },
  // 15.III.2027, 15 III 27 - the Roman-numeral month of Polish, Russian,
  // Bulgarian and Czech packaging. The numerals only count between two
  // numbers, so a stray "V" or "X" in text never becomes a month.
  {
    re: new RegExp(`${NB}(\\d{1,2})\\s?[.\\s/\\-]\\s?(${ROMAN_ALT})\\s?[.\\s/\\-]\\s?(\\d{4}|\\d{2})${NA}`, 'g'),
    read: (m) => [toDay(makeYear(m[3]), ROMAN[m[2]], Number(m[1]))].filter(Boolean) as Interpretation[],
  },
  // III.2027 - a Roman-numeral month with a four-digit 20xx year, joined by
  // a dot, slash or dash (a space alone would let a stray "V 2027" in text
  // become May).
  {
    re: new RegExp(`(?<![A-Z0-9])(${ROMAN_ALT})\\s?[./\\-]\\s?(20\\d{2})${NA}`, 'g'),
    read: (m) => [toMonth(Number(m[2]), ROMAN[m[1]])].filter(Boolean) as Interpretation[],
  },
  // R9.3.15 / 令和9年3月15日 - Japanese era dates: Reiwa year n is 2018 + n.
  // (The 年/月/日 markers are already dashes here.)
  {
    re: new RegExp(`(?:(?<![A-Z])R|令和)\\s?(\\d{1,2})\\s?[.\\-/]\\s?(\\d{1,2})\\s?[.\\-/]\\s?(\\d{1,2})${NA}`, 'g'),
    read: (m) => [toDay(2018 + Number(m[1]), Number(m[2]), Number(m[3]))].filter(Boolean) as Interpretation[],
  },
  // OCT 27 2026, OCTOBER 27, 2026
  {
    re: new RegExp(`${ML}(${MONTH_ALT})${MR}${SP}(\\d{1,2})(?:ST|ND|RD|TH)?[\\s,./\\-]+(\\d{4})${NA}`, 'gu'),
    read: (m) => [toDay(Number(m[3]), MONTHS[m[1]], Number(m[2]))].filter(Boolean) as Interpretation[],
  },
  // 2026-10-27, 2026/10/27
  {
    re: new RegExp(`${NB}(\\d{4})${SEP}(\\d{1,2})${SEP}(\\d{1,2})${NA}`, 'g'),
    read: (m) => [toDay(Number(m[1]), Number(m[2]), Number(m[3]))].filter(Boolean) as Interpretation[],
  },
  // 2027 03 15 - the year-first print with SPACES instead of separators: how
  // an OCR that cannot read the CJK markers returns "2027年3月15日" (the
  // markers vanish, the digits stay), and how some dot-matrix printers stamp
  // East-Asian goods. Unambiguous by position (the 20xx year leads), so no
  // day/month question ever arises. Guards mirror the day-first space form.
  {
    re: new RegExp(`(?<![0-9.])(20\\d{2})\\s+(\\d{1,2})\\s+(\\d{1,2})(?![0-9])`, 'g'),
    read: (m) => [toDay(Number(m[1]), Number(m[2]), Number(m[3]))].filter(Boolean) as Interpretation[],
  },
  // 25.11:8926 - the same dot-matrix date with its century misread: in a
  // stamp's dots a 2 reads as 8, 3 or 7, and a 0 as 9, 8, 6 or O ("2026" ->
  // "8926"). A full day.month.year shape whose last two year digits make a
  // year from now to five years ahead, and whose first two are such
  // lookalikes of "20", reads as that 20xx year. Never a past year, never a
  // year far ahead, and unlabelled reads still need repeating to confirm.
  {
    re: new RegExp(`(?<![0-9.,])(\\d{1,2})(?:\\s?[.,:;/\\-]\\s?|\\s)(\\d{1,2})(?:\\s?[.,:;/\\-]\\s?|\\s)(?!20)([2378Z][0689OD])(\\d{2})${NA}`, 'g'),
    read: (m, opts) => {
      const year = 2000 + Number(m[4]);
      const now = opts.today.getFullYear();
      if (year < now || year > now + 5) return [];
      const a = Number(m[1]);
      const b = Number(m[2]);
      const dmy = toDay(year, b, a);
      const mdy = toDay(year, a, b);
      if (dmy && mdy && dmy.iso !== mdy.iso) return opts.preferredOrder === 'MDY' ? [mdy, dmy] : [dmy, mdy];
      return [dmy ?? mdy].filter(Boolean) as Interpretation[];
    },
  },
  // 27/10/2026, 10/27/2026, 27.10.26
  // With a two-digit year the same shape can also be Japanese/Chinese
  // year-first (27.03.15 = 2027-03-15): see withYearFirst.
  {
    re: new RegExp(`${NB}(\\d{1,2})(${SEP})(\\d{1,2})\\2(\\d{4}|\\d{2})${NA}`, 'g'),
    read: (m, opts) => {
      const a = Number(m[1]);
      const b = Number(m[3]);
      const year = makeYear(m[4]);
      const dmy = toDay(year, b, a);
      const mdy = toDay(year, a, b);
      const dayMonth =
        dmy && mdy && dmy.iso !== mdy.iso ? (opts.preferredOrder === 'MDY' ? [mdy, dmy] : [dmy, mdy]) : ([dmy ?? mdy].filter(Boolean) as Interpretation[]);
      return m[4].length === 2 ? withYearFirst(dayMonth, a, b, Number(m[4]), opts) : dayMonth;
    },
  },
  // 25.11,2026 / 25,11.2026 / 25:11:2026 - a dot-matrix stamp whose dots OCR
  // returns as mixed separators: commas, and colons where a stamped period
  // lines up with a dot of the row below. Only with a four-digit 20xx year:
  // the year anchors the shape, so a decimal ("3,4") or a clock time
  // ("10:51") never starts a date.
  {
    // A dot of the stamp can also go missing altogether ("25 11.2026").
    re: new RegExp(`(?<![0-9.,])(\\d{1,2})(?:\\s?[.,:;/\\-]\\s?|\\s)(\\d{1,2})(?:\\s?[.,:;/\\-]\\s?|\\s)(20\\d{2})${NA}`, 'g'),
    read: (m, opts) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const year = Number(m[3]);
      const dmy = toDay(year, b, a);
      const mdy = toDay(year, a, b);
      if (dmy && mdy && dmy.iso !== mdy.iso) return opts.preferredOrder === 'MDY' ? [mdy, dmy] : [dmy, mdy];
      return [dmy ?? mdy].filter(Boolean) as Interpretation[];
    },
  },
  // 06 03 2027 - the no-separator European print (spaces instead of dots or
  // slashes). The same day/month disambiguation as the separator form above.
  // Guards: the first number must not follow a digit OR a decimal point
  // (otherwise "V4.2 05 2027" would read its trailing 2 as a day), and the
  // year is four digits starting with 20 - expiry dates on live packaging are
  // 20xx, while barcode fragments, lot numbers and weights never form
  // "NN NN 20NN" through spaces (the digit guards fail them first).
  {
    re: new RegExp(`(?<![0-9.])(\\d{1,2})\\s+(\\d{1,2})\\s+(20\\d{2})(?![0-9])`, 'g'),
    read: (m, opts) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const year = Number(m[3]);
      const dmy = toDay(year, b, a);
      const mdy = toDay(year, a, b);
      if (dmy && mdy && dmy.iso !== mdy.iso) return opts.preferredOrder === 'MDY' ? [mdy, dmy] : [dmy, mdy];
      return [dmy ?? mdy].filter(Boolean) as Interpretation[];
    },
  },
  // 14 07 27 / 14 07 2027 - day, month and year separated by spaces only, as
  // dot-matrix and laser stamps print them (a protein bar's "14 07 27").
  // Two-digit day and month so loose numbers ("3 4 25") stay out. Listed
  // before "05 2027", which would claim the month and year alone. Without a
  // label only a future date reads, like the bare compact stamps below.
  {
    re: new RegExp(`${NB}(\\d{2})\\s{1,3}(\\d{2})\\s{1,3}(20\\d{2}|\\d{2})${NA}`, 'g'),
    labelledOnly: true,
    read: (m, opts) => spacedDate(m, opts),
  },
  {
    re: new RegExp(`${NB}(\\d{2})\\s{1,3}(\\d{2})\\s{1,3}(20\\d{2}|\\d{2})${NA}`, 'g'),
    read: (m, opts) => spacedDate(m, opts).filter((i) => i.iso >= isoToday(opts.today)),
  },
  // 05 2027 - month and year with no separator and no day: May 2027, the
  // standard "best before month" print. A first number above 12 simply fails
  // month validation (and counts as an invalid read, not a false date). The
  // same decimal-point guard keeps "V4.2 2027" style fragments out.
  {
    re: new RegExp(`(?<![0-9.])(\\d{1,2})\\s+(20\\d{2})(?![0-9])`, 'g'),
    read: (m) => [toMonth(Number(m[2]), Number(m[1]))].filter(Boolean) as Interpretation[],
  },
  // OCT 2026, OCT/26
  {
    re: new RegExp(`${ML}(${MONTH_ALT})${MR}${SP}(\\d{4}|\\d{2})${NA}`, 'gu'),
    read: (m) => [toMonth(makeYear(m[2]), MONTHS[m[1]])].filter(Boolean) as Interpretation[],
  },
  // 2026-10, 2026/10
  {
    re: new RegExp(`${NB}(20\\d{2})${SEP}(\\d{1,2})${NA}`, 'g'),
    read: (m) => [toMonth(Number(m[1]), Number(m[2]))].filter(Boolean) as Interpretation[],
  },
  // 10/2026
  {
    re: new RegExp(`${NB}(\\d{1,2})${SEP}(20\\d{2})${NA}`, 'g'),
    read: (m) => [toMonth(Number(m[2]), Number(m[1]))].filter(Boolean) as Interpretation[],
  },
  // EXP 10/26 (month and two-digit year), only right after an expiry label —
  // or, when that cannot be a month and year, a day and month with NO year:
  // "Expiră la data de: 14/11" on Romanian yogurt (14 November, the next time
  // it comes round, and the user is asked to check the year). The two readings
  // never compete: a two-digit year inside the accepted range (20..41 from a
  // 2026 vantage) is never a valid month, and a month is never such a year.
  {
    re: new RegExp(`${NB}(\\d{1,2})${SEP}(\\d{2})${NA}`, 'g'),
    labelledOnly: true,
    read: (m, opts) => {
      const monthYear = toMonth(makeYear(m[2]), Number(m[1]));
      if (monthYear && inRange(monthYear, opts.today)) return [monthYear];
      return dayMonthNoYear(Number(m[1]), Number(m[2]), opts);
    },
  },
  // BEST BEFORE 27 OCT (no year), only right after an expiry label. The year is the next
  // time that day comes round, and the user is asked to check it.
  {
    re: new RegExp(`${NB}(\\d{1,2})(?:ST|ND|RD|TH)?${SP}${ML}(${MONTH_ALT})(?![\\p{L}0-9])(?![\\s./,'’\\-]*\\d)`, 'gu'),
    labelledOnly: true,
    read: (m, opts) => {
      const t = opts.today;
      const month = MONTHS[m[2]];
      const day = Number(m[1]);
      const thisYear = toDay(t.getFullYear(), month, day);
      const pick = thisYear && thisYear.iso >= isoToday(t) ? thisYear : toDay(t.getFullYear() + 1, month, day);
      return pick ? [{ ...pick, yearGuessed: true }] : [];
    },
  },
  // EXP 20261027, only right after an expiry label.
  {
    re: new RegExp(`${NB}(20\\d{2})(\\d{2})(\\d{2})${NA}`, 'g'),
    labelledOnly: true,
    read: (m) => [toDay(Number(m[1]), Number(m[2]), Number(m[3]))].filter(Boolean) as Interpretation[],
  },
  // EXP 03062027 - the 8-digit day/month-first stamp (no separators at all),
  // only right after an expiry label and listed AFTER the year-first form so
  // "20261027" is claimed unambiguously first. Day-first vs month-first reads
  // exactly like the separator form: the user's preferred order wins the
  // primary slot, the other survives as an alternative, and the save sheet
  // asks (or preselects per the user's Date format setting) as usual.
  {
    re: new RegExp(`${NB}(\\d{2})(\\d{2})(20\\d{2})${NA}`, 'g'),
    labelledOnly: true,
    read: (m, opts) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const year = Number(m[3]);
      const dmy = toDay(year, b, a);
      const mdy = toDay(year, a, b);
      if (dmy && mdy && dmy.iso !== mdy.iso) return opts.preferredOrder === 'MDY' ? [mdy, dmy] : [dmy, mdy];
      return [dmy ?? mdy].filter(Boolean) as Interpretation[];
    },
  },
  // EXP 1226 - a 4-digit code right after an expiry label: month and
  // two-digit year (December 2026) when that is a date, otherwise the
  // one-digit-year Julian code (EXP 7074 = day 74 of 2027). A bare year
  // ("EXP 2027") is neither and is left alone.
  {
    re: new RegExp(`${NB}(?!20\\d{2}${NA})(\\d{4})${NA}`, 'g'),
    labelledOnly: true,
    read: (m, opts) => {
      const d = m[1];
      const monthYear = toMonth(2000 + Number(d.slice(2)), Number(d.slice(0, 2)));
      if (monthYear && inRange(monthYear, opts.today)) return [monthYear];
      const y = opts.today.getFullYear();
      let year = y - 1;
      while (year % 10 !== Number(d[0])) year += 1;
      const j = julian(year, Number(d.slice(1)));
      return j ? [j] : [];
    },
  },
  // EXP 2027280 - the 7-digit Julian code (four-digit year, day of the
  // year), only right after an expiry label.
  {
    re: new RegExp(`${NB}(20\\d{2})(\\d{3})${NA}`, 'g'),
    labelledOnly: true,
    read: (m) => [julian(Number(m[1]), Number(m[2]))].filter(Boolean) as Interpretation[],
  },
  // 17112026 with NO label (a bread bag's stamp under its lot code): an
  // 8-digit token standing ALONE in its line, read year-first (20261117) or
  // day/month-first (17112026 / 11172026). Future dates only, for the same
  // reason as the bare 6-digit stamp below: an unlabelled past 8-digit number
  // is a code far more often than an expiry worth tracking. Unlabelled, so the
  // save sheet always asks the user to check it.
  {
    re: new RegExp(`${NB}(\\d{8})${NA}`, 'g'),
    isolatedOnly: true,
    read: (m, opts) => compact8(m[1], opts).filter((i) => i.iso >= isoToday(opts.today)),
  },
  // 2511:2026 / 2511 2026 - a dot-matrix "25.11.2026" whose first dot was
  // lost and whose second was read as a colon or a gap (PaddleOCR on the
  // cottage cheese lid). Day and month run together, then the 20xx year.
  // Without a label only a future date reads, like the bare stamps below.
  {
    re: new RegExp(`${NB}(\\d{2})(\\d{2})\\s?[.,:;/\\-]?\\s?(20\\d{2})${NA}`, 'g'),
    isolatedOnly: true,
    read: (m, opts) => {
      const year = Number(m[3]);
      const a = Number(m[1]);
      const b = Number(m[2]);
      const dmy = toDay(year, b, a);
      const mdy = toDay(year, a, b);
      const order = opts.preferredOrder === 'MDY' ? [mdy, dmy] : [dmy, mdy];
      return order.filter((i, k): i is Interpretation => !!i && i.iso >= isoToday(opts.today) && (k === 0 || i.iso !== order[0]?.iso));
    },
  },
  // 012028 - month and four-digit year with no separator (chocolate and
  // sweets: "012028" = January 2028). Listed before the 6-digit day/month/year
  // stamps, which would otherwise read it as 20 Jan 2028. Labelled or not; a
  // bare one must stand alone in its line and not be over.
  {
    re: new RegExp(`${NB}(0[1-9]|1[0-2])(20\\d{2})${NA}`, 'g'),
    isolatedOnly: true,
    read: (m, opts) => [toMonth(Number(m[2]), Number(m[1]))].filter((i): i is Interpretation => !!i && i.iso >= isoToday(opts.today)),
  },
  // EXP 200627 - the 6-digit dot-matrix stamp (no separators at all): day,
  // month, two-digit year in either order. Only right after an expiry label
  // does the past also read; see the bare variant below for why.
  {
    re: new RegExp(`${NB}(\\d{2})(\\d{2})(\\d{2})${NA}`, 'g'),
    labelledOnly: true,
    read: (m, opts) => compact6(m[0], opts),
  },
  // 200627 with NO label: the same stamp read bare. Only FUTURE dates count
  // — an unlabelled past 6-digit token is a lot or batch code far more often
  // than an expiry worth tracking, and a definite expiry the user means to
  // save is ahead of today virtually always. Both day/month orders survive
  // (preferred order first) so the save sheet can ask or preselect.
  {
    re: new RegExp(`${NB}(\\d{2})(\\d{2})(\\d{2})${NA}`, 'g'),
    isolatedOnly: true,
    read: (m, opts) => compact6(m[0], opts, true).filter((i) => i.iso >= isoToday(opts.today)),
  },
  // EXP 20627 - the 5-digit stamp: the printer dropped the month's leading
  // zero, so the token is day, SINGLE-digit month, year ("20627" = 20.6.27
  // = 20 June 2027). Labelled variant reads any in-range date.
  {
    re: new RegExp(`${NB}(\\d{5})${NA}`, 'g'),
    labelledOnly: true,
    // When no day/month split is a date, the token may be the US "Julian"
    // code: two-digit year then day of the year ("EXPIRATION: 27280" =
    // 7 Oct 2027). Only ever read right after an expiry label.
    read: (m, opts) => {
      const dated = compact5(m[0], opts).filter((i) => inRange(i, opts.today));
      if (dated.length) return dated;
      const j = julian(makeYear(m[0].slice(0, 2)), Number(m[0].slice(2)));
      return j ? [j] : [];
    },
  },
  // 20627 bare, future-only (same reasoning as the bare 6-digit form: a past
  // unlabelled 5-digit token is a lot code, not an expiry). The single-digit
  // month makes the split genuinely ambiguous (20.6.27 vs 2.06.27), so both
  // readings survive with the preferred order first and the save sheet asks.
  {
    re: new RegExp(`${NB}(\\d{5})${NA}`, 'g'),
    isolatedOnly: true,
    read: (m, opts) => compact5(m[0], opts).filter((i) => i.iso >= isoToday(opts.today)),
  },
];

// The next time a day and month come round (today counts), or null when the
// pair is not a calendar date.
function nextOccurrence(month: number, day: number, today: Date): Interpretation | null {
  const thisYear = toDay(today.getFullYear(), month, day);
  if (thisYear && thisYear.iso >= isoToday(today)) return { ...thisYear, yearGuessed: true };
  const next = toDay(today.getFullYear() + 1, month, day);
  return next ? { ...next, yearGuessed: true } : null;
}

// A numeric day and month printed without a year ("14/11"): both orders when
// both are dates, the preferred order first, each in its next occurrence.
function dayMonthNoYear(a: number, b: number, opts: ParseOptions): Interpretation[] {
  const dmy = nextOccurrence(b, a, opts.today);
  const mdy = nextOccurrence(a, b, opts.today);
  if (dmy && mdy && dmy.iso !== mdy.iso) return opts.preferredOrder === 'MDY' ? [mdy, dmy] : [dmy, mdy];
  return [dmy ?? mdy].filter(Boolean) as Interpretation[];
}

// A year and a day of the year (1..365/366) as a calendar date, marked coded.
function julian(year: number, dayOfYear: number): Interpretation | null {
  const days = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
  if (dayOfYear < 1 || dayOfYear > days) return null;
  const d = new Date(Date.UTC(year, 0, dayOfYear));
  return { iso: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, precision: 'day', coded: true };
}

// The 8-digit no-separator stamp: YYYYMMDD, or DDMMYYYY / MMDDYYYY with a
// 20xx year. Every valid reading survives (preferred day/month order first).
function compact8(digits: string, opts: ParseOptions): Interpretation[] {
  const out: Interpretation[] = [];
  if (digits.startsWith('20')) {
    const ymd = toDay(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6)));
    if (ymd) out.push(ymd);
  }
  if (digits.slice(4, 6) === '20') {
    const year = Number(digits.slice(4));
    const dmy = toDay(year, Number(digits.slice(2, 4)), Number(digits.slice(0, 2)));
    const mdy = toDay(year, Number(digits.slice(0, 2)), Number(digits.slice(2, 4)));
    const pair = opts.preferredOrder === 'MDY' ? [mdy, dmy] : [dmy, mdy];
    for (const i of pair) if (i && !out.some((o) => o.iso === i.iso)) out.push(i);
  }
  return out;
}

// The spaced stamp "14 07 27": both day/month orders, preferred first.
function spacedDate(m: RegExpExecArray, opts: ParseOptions): Interpretation[] {
  const year = makeYear(m[3]);
  const dmy = toDay(year, Number(m[2]), Number(m[1]));
  const mdy = toDay(year, Number(m[1]), Number(m[2]));
  if (dmy && mdy && dmy.iso !== mdy.iso) return opts.preferredOrder === 'MDY' ? [mdy, dmy] : [dmy, mdy];
  return [dmy ?? mdy].filter(Boolean) as Interpretation[];
}

// The 6-digit no-separator stamp: DDMMYY or MMDDYY (both two-digit years).
// `ownOrderOnly`: a BARE stamp reads only in the user's own day/month order.
// Six loose digits that make a date only the other way round ("072629" in a
// day-first country: 26 July 2029) are a batch code far more often than a
// foreign date, so they are not offered at all.
function compact6(digits: string, opts: ParseOptions, ownOrderOnly = false): Interpretation[] {
  const year = makeYear(digits.slice(4));
  let dmy = toDay(year, Number(digits.slice(2, 4)), Number(digits.slice(0, 2)));
  let mdy = toDay(year, Number(digits.slice(0, 2)), Number(digits.slice(2, 4)));
  if (ownOrderOnly) {
    if (opts.preferredOrder === 'MDY') dmy = null;
    else mdy = null;
  }
  const dayMonth =
    dmy && mdy && dmy.iso !== mdy.iso ? (opts.preferredOrder === 'MDY' ? [mdy, dmy] : [dmy, mdy]) : ([dmy ?? mdy].filter(Boolean) as Interpretation[]);
  return withYearFirst(dayMonth, Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4)), opts);
}

// The year-first reading of a two-digit-year date (YY MM DD), as Japanese and
// Chinese packs print it: "27.03.15" / "270315" = 15 March 2027. The same
// digits read day-first in Europe ("27.10.26" = 27 Oct 2026), so year-first is
// only added when the day/month readings are impossible (out of range or not a
// date) — or when an East-Asian expiry label on the line says year-first is
// the packaging's own convention, in which case it leads and the day/month
// readings stay as alternatives for the user to pick.
function withYearFirst(dayMonth: Interpretation[], yy: number, mm: number, dd: number, opts: ParseOptions): Interpretation[] {
  const ymd = toDay(2000 + yy, mm, dd);
  if (!ymd || !inRange(ymd, opts.today)) return dayMonth;
  const plausible = dayMonth.filter((i) => inRange(i, opts.today));
  if (!plausible.length) return [ymd];
  if (!opts.yearFirst) return dayMonth;
  return [ymd, ...plausible.filter((i) => i.iso !== ymd.iso)];
}

// The 5-digit no-separator stamp: day, single-digit month, year (DDMYY), or
// month, day, year when the DAY was the single digit (MDDYY). Exactly one of
// the two splits has a valid calendar most of the time; both valid keeps both.
function compact5(digits: string, opts: ParseOptions): Interpretation[] {
  const year = makeYear(digits.slice(3));
  const dmy = toDay(year, Number(digits[2]), Number(digits.slice(0, 2)));
  const mdy = toDay(year, Number(digits[0]), Number(digits.slice(1, 3)));
  if (dmy && mdy && dmy.iso !== mdy.iso) return opts.preferredOrder === 'MDY' ? [mdy, dmy] : [dmy, mdy];
  return [dmy ?? mdy].filter(Boolean) as Interpretation[];
}

function findLabels(line: string): FoundLabel[] {
  const out: FoundLabel[] = [];
  LABEL_RE.lastIndex = 0;
  for (let m = LABEL_RE.exec(line); m; m = LABEL_RE.exec(line)) {
    const groups = m.groups ?? {};
    const idx = LABELS.findIndex((_, i) => groups[`l${i}`] !== undefined);
    out.push({ start: m.index, end: m.index + m[0].length, kind: LABELS[idx].kind, text: m[0] });
  }
  return out;
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

// A date-looking match that failed calendar validation, e.g. 31/02/2026.
type Invalid = { invalid: true };

// `carriedExpiry`: the previous line ended in an expiry label with nothing
// after it, so a date OPENING this line sits right after that label too
// ("Expiră la data de:" above "14/11").
function findDates(line: string, opts: ParseOptions, expiryLabelEnds: number[], carriedExpiry = false): (RawDate | (Span & Invalid))[] {
  const taken: Span[] = [];
  const out: (RawDate | (Span & Invalid))[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    for (let m = p.re.exec(line); m; m = p.re.exec(line)) {
      const span = { start: m.index, end: m.index + m[0].length };
      if (taken.some((t) => overlaps(t, span))) continue;
      if (p.labelledOnly) {
        // The label has to end just before the date: "EXP 10/26", "EXP: 10/26".
        const before = line.slice(0, span.start);
        const labelled =
          expiryLabelEnds.some((end) => end <= span.start && /^[\s:.\-]*$/.test(before.slice(end))) ||
          (carriedExpiry && /^[\s:.\-]*$/.test(before));
        if (!labelled) continue;
      }
      if (p.isolatedOnly) {
        // A bare compact stamp only reads as a date when it stands ALONE:
        // with other long digit runs in the line, this is a barcode or a
        // serial number whose groups happen to parse ("9 010437 034685").
        // A lot number ("LOT 5521") on the same line is not such a run.
        const rest = (line.slice(0, span.start) + ' ' + line.slice(span.end)).replace(/(?<![A-Z])LOT\s*[A-Z0-9]+/g, ' ');
        if (/\d{4,}/.test(rest)) continue;
      }
      const interpretations = p.read(m, opts).filter((i) => inRange(i, opts.today));
      taken.push(span);
      out.push(interpretations.length ? { ...span, raw: m[0].trim(), interpretations } : { ...span, invalid: true });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// Anything more than five years back or fifteen ahead is a misread or not an expiry date.
function inRange(i: Interpretation, today: Date) {
  const year = Number(i.iso.slice(0, 4));
  const y = today.getFullYear();
  return year >= y - 5 && year <= y + 15;
}

export function isoToday(today: Date) {
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

// Continental-European expiry phrases (German, French, Dutch, Italian,
// Spanish, Portuguese, Polish, Czech/Slovak, Hungarian, the Balkans, the
// Nordic dates): every market that prints them also writes its dates
// DAY FIRST. Seeing one next to an ambiguous date (03/04/2027) is packaging
// evidence from the product's own origin - stronger than the user's regional
// preference - so the day-first reading becomes the primary interpretation.
// English labels (BEST BEFORE / USE BY / EXP) stay with the user's preference:
// English appears on packaging in both day-first and month-first markets.
// The Cyrillic, Hebrew, Arabic and Romanian phrases join them: Russia,
// Ukraine, Israel and Romania all print DAY-FIRST dates (DD.MM.YYYY).
// Japanese kana, CJK ideographs and Hangul: an expiry label written in them.
const CJK_RE = /[぀-ヿ一-鿿가-힯]/;

const EU_EXPIRY_LABEL_RE =
  /HALTBAR|MHD|CONSOMMER|HOUDBAAR|UPOTR|SPOTRBUJTE|DO SPOTREBY|NAJLEPIEJ|NALEZY|PRZYDATNOSC|CONSUMIR|CADUCA|CONSUMARSI|CONSUMARE|FELHASZNALHATO|MINOSSEGMEGORZES|ГОДЕН|ГОДНО|ГОДНОСТ|НА[ИЙ]|КОНСУМИРА|УПОТРЕБИТЬ|ИСПОЛЬЗОВАТЬ|ИЗПОЛЗВА[ИЙ]|СРОК ГОДНОСТИ|ТЕРМ[ИІ]Н ГОДНОСТ|ПРИДАТНОСТ|ВЖИТИ ДО|תאריך תפוגה|לשימוש עד|בתוקף עד|تاريخ انتهاء|A SE CONSUMA|DATA EXPIRARII|DATA DE EXPIRARE|DATA LIMITA|TERMEN DE VALABILITATE|VALABIL|EXPIRA/;

// Pulls every date out of the OCR lines and attaches the label that governs it.
export function extractCandidates(lines: string[], opts: ParseOptions): { candidates: DateCandidate[]; invalid: number } {
  const norm = lines.flatMap((l) => l.split(/\r?\n/)).map(normalizeLine).filter(Boolean);
  const candidates: DateCandidate[] = [];
  let invalid = 0;

  // Labels printed on a line of their own apply to the dates on the next line,
  // matched up by position when there are several ("MFG   EXP" over "01/2025   01/2027").
  let pending: FoundLabel[] = [];

  norm.forEach((line, lineNo) => {
    const labels = findLabels(line);
    // The previous line ended in an expiry label with nothing after it: a
    // date that opens this line belongs to it (and short labelled-only forms
    // such as "14/11" may be read).
    const lastPending = pending[pending.length - 1];
    const carriedExpiry = lastPending?.kind === 'expiry' && (!labels.length || labels[0].start > 0);
    // A continental expiry label on THIS line (or carried from the line above)
    // is origin evidence: an ambiguous date it governs reads day-first. The
    // saved alternative still lets the save sheet offer the other reading.
    const euExpiry =
      labels.some((l) => l.kind === 'expiry' && EU_EXPIRY_LABEL_RE.test(l.text)) ||
      (carriedExpiry && EU_EXPIRY_LABEL_RE.test(lastPending.text));
    const dayFirstOpts = euExpiry && opts.preferredOrder !== 'DMY' ? { ...opts, preferredOrder: 'DMY' as const } : opts;
    // A Japanese, Chinese or Korean expiry label (here or carried from the line
    // above) is year-first evidence for two-digit-year dates ("27.03.15").
    const cjkExpiry =
      labels.some((l) => l.kind === 'expiry' && CJK_RE.test(l.text)) || (carriedExpiry && CJK_RE.test(lastPending.text));
    const lineOpts = cjkExpiry ? { ...dayFirstOpts, yearFirst: true } : dayFirstOpts;
    const dates = findDates(
      line,
      lineOpts,
      // Short and compact forms (10/26, 20260315) read after an expiry OR a
      // production label: a production date written "生产日期: 20260315" is
      // still that pack's production date (and feeds the shelf-life sum).
      labels.filter((l) => l.kind === 'expiry' || l.kind === 'manufacture').map((l) => l.end),
      carriedExpiry,
    );
    const valid = dates.filter((d): d is RawDate => !('invalid' in d));
    invalid += dates.length - valid.length;

    if (!valid.length) {
      // A short wordy line with no label and no digits ("data de:", a stray
      // brand word) between a label and its date does not break the pairing.
      const filler = !labels.length && !/\d/.test(line) && line.split(' ').length <= 3;
      if (!(filler && pending.length)) pending = labels;
      return;
    }

    const carried = !labels.length || labels[0].start > valid[0].start ? pending : [];
    valid.forEach((d, i) => {
      // The nearest label before the date on this line, unless another date sits between them.
      const before = labels.filter((l) => l.end <= d.start && !valid.some((o) => o !== d && o.start >= l.end && o.end <= d.start));
      let label: FoundLabel | undefined = before[before.length - 1];
      // A LOT or production label governs what it is printed NEXT to: with
      // its own code in between ("LOT 5693478 12.07.28"), the label belongs
      // to that code, and the date after it is not a lot or production date.
      if (label && (label.kind === 'lot' || label.kind === 'manufacture') && /\d{3,}/.test(line.slice(label.end, d.start))) {
        label = undefined;
      }
      let carriedLabel = false;
      if (!label && carried.length) {
        label = carried.length === valid.length ? carried[i] : carried[carried.length - 1];
        carriedLabel = true;
      }
      // A FUTURE date can never be a production date — nothing is
      // manufactured ahead of today — and a future LOT pairing is equally
      // wrong. But only when the label is NOT in its canonical "LABEL
      // <subject>" position at the START of its line: a manufacture/lot
      // label that opens its line governs what follows it ("PACKED ON 28
      // OCT" for same-day packing, "LOT 27/10/2026" for tomorrow's lot
      // stamp) — those stay production codes and never leak into the expiry
      // pool. When the label was CARRIED over from another line (OCR line
      // joins) or sits mid-line behind its own real subject ("25F0684 LOT
      // 2028/05" — the LOT governs the code printed before it, not the
      // future date printed after), attaching it to a future date is the
      // mistake: the candidate falls back to unlabelled — it still reaches
      // the expiry pool, the save sheet asks the user to check — while the
      // scanner can never again call a future date "a production date" (the
      // 2028/05 medicine-bottle case, whose classification used to flip with
      // every frame's OCR).
      // Even a LOT label that OPENS its line lets go of a future MONTH-ONLY
      // date: a lot identifies one batch and is never just a year and month,
      // so "LOT 2028/05" is the OCR reading the label column beside the date
      // column (the LOT belongs to "25F0684" on the next line). The date
      // stays unlabelled, so the save sheet still asks the user to check it.
      if (
        label &&
        (label.kind === 'manufacture' || label.kind === 'lot') &&
        (carriedLabel || label.start > 0 || (label.kind === 'lot' && d.interpretations[0].precision === 'month')) &&
        d.interpretations[0].iso > isoToday(opts.today)
      ) {
        label = undefined;
      }
      candidates.push({
        raw: d.raw,
        line: lineNo,
        interpretations: d.interpretations,
        label: label?.kind ?? null,
        labelText: label?.text ?? null,
      });
    });
    pending = [];
  });

  return { candidates, invalid };
}

export function parseExpiry(lines: string[], opts: ParseOptions): ScanParseResult {
  const text = lines.join(' ').trim();
  if (!text) return { kind: 'none', hint: 'no-text' };

  // Short "MM/YY" dates are only read right after an expiry label, including one that ends
  // the previous line. Joining such pairs lets the same rule cover both.
  const joined = joinLabelOnlyLines(lines);
  const { candidates, invalid } = extractCandidates(joined, opts);

  const expiry = candidates.filter((c) => c.label === 'expiry');
  const unlabelled = candidates.filter((c) => c.label === null);
  const sell = candidates.filter((c) => c.label === 'sell');

  let pool: DateCandidate[];
  const reasons: ConfirmReason[] = [];
  if (expiry.length) pool = expiry;
  else if (unlabelled.length) {
    // Unlabelled, a date printed WITH separators ("14 07 27", "12/07/28")
    // outranks a bare digit run in the same view ("072629"): that run is far
    // more likely the batch code beside the date, so it is not offered.
    const spaced = unlabelled.filter((c) => !/^\d+$/.test(c.raw));
    pool = spaced.length ? spaced : unlabelled;
    reasons.push('no-label');
  } else if (sell.length) {
    pool = sell;
    reasons.push('sell-by');
  } else if (candidates.length) {
    // Only a production date is printed — but many packs (Chinese, Russian,
    // Bulgarian, Romanian) print the shelf life beside it instead of an
    // expiry date ("生产日期 2026.03.15 保质期 24个月"). Then the expiry is
    // that date plus the shelf life, offered for the user to check.
    const computed = fromShelfLife(candidates, lines, opts.today);
    if (computed) return computed;
    return { kind: 'none', hint: 'manufacture-only' };
  } else {
    return { kind: 'none', hint: invalid ? 'invalid-date' : 'no-date' };
  }

  // Several distinct dates in the pool: the latest is listed first (an
  // unlabelled pair is often "made on" then "use by"), but nothing is decided
  // for the user — every other date rides along as an alternative and the
  // save sheet asks which one is the expiry date.
  const distinct = new Map<string, DateCandidate>();
  for (const c of pool) distinct.set(c.interpretations[0].iso, c);
  const ordered = [...distinct.values()].sort((a, b) => b.interpretations[0].iso.localeCompare(a.interpretations[0].iso));
  const chosen = ordered[0];
  if (distinct.size > 1) reasons.push('multiple-dates');

  const [primary, ...ownAlternatives] = chosen.interpretations;
  if (ownAlternatives.length) reasons.push('ambiguous-order');
  const alternatives = [...ownAlternatives];
  for (const other of ordered.slice(1)) {
    for (const i of other.interpretations) {
      if (i.iso !== primary.iso && !alternatives.some((a) => a.iso === i.iso)) alternatives.push(i);
    }
  }
  if (primary.precision === 'month') reasons.push('month-only');
  if (primary.iso < isoToday(opts.today)) reasons.push('in-past');
  if (primary.yearGuessed) reasons.push('no-year');
  if (primary.coded) reasons.push('coded-date');

  // Month-only expiry with a clear label is how medicine is printed; that alone is not doubt.
  const doubts = reasons.filter((r) => r !== 'month-only');
  return {
    kind: 'found',
    primary,
    alternatives,
    confidence: doubts.length ? 'medium' : 'high',
    reasons,
    label: chosen.label,
    labelText: chosen.labelText,
    raw: chosen.raw,
    // The whole text that was read, so the caller can guess the product's
    // category from the words around the date (see scanner/categoryGuess.ts).
    text,
    key: [primary.iso, ...alternatives.map((a) => a.iso), chosen.label ?? '-'].join('|'),
  };
}

// A printed shelf life: a shelf-life label, then a number and a unit, in the
// languages that print one instead of an expiry date. Read off the RAW text
// (upper-cased only): normalizeLine turns 月/日/年 into separators, which
// would erase the Chinese and Japanese units.
const SHELF_LIFE_RE = new RegExp(
  '(?:SHELF\\s*LIFE|BEST\\s*WITHIN|保质期|保質期|賞味期限|消費期限|유통기한|СРОК\\s*(?:НА\\s*)?ГОДНОСТИ?|ТЕРМ[ИІ]Н\\s*ПРИДАТНОСТ[ИІ]|' +
    'TERMEN\\s*DE\\s*VALABILITATE|VALABILITATE|HALTBARKEIT|DURATA|תוקף|' +
    // An expiry label followed by a DURATION rather than a date: India's
    // "Best before 12 months from manufacture", Vietnam's "HSD: 30 tháng".
    'BEST\\s*BEFORE|USE\\s*BEFORE|USE\\s*BY|EXPIRY|HSD|HẠN\\s*SỬ\\s*DỤNG)' +
    '\\s*[:：\\-–]?\\s*(?:\\S+\\s+)?(\\d{1,4})\\s*' +
    '(MONTHS?|MTHS?|МЕС[А-ЯЁ]*|LUNI|LUNA|MONATE?|MESI|MESES|MOIS|个月|個月|ヶ月|か月|カ月|개월|חודשים|חודש|THÁNG|THANG|' +
    'DAYS?|ДН[А-ЯЁ]*|ДЕН[А-ЯЁ]*|СУТ[А-ЯЁ]*|ZILE|TAGE|GIORNI|DIAS|JOURS|天|日|일|ימים|NGÀY|NGAY|' +
    'YEARS?|YRS?|ГОД[А-ЯЁ]*|ЛЕТ|ANI|JAHRE?|ANNI|ANOS|ANS|年|년|שנים|שנה|NĂM|NAM)',
);

type ShelfLife = { n: number; unit: 'day' | 'month' | 'year' };

export function readShelfLife(lines: string[]): ShelfLife | null {
  const m = SHELF_LIFE_RE.exec(lines.join(' ').normalize('NFC').toUpperCase());
  if (!m) return null;
  const n = Number(m[1]);
  if (!n) return null;
  const u = m[2];
  const unit: ShelfLife['unit'] = /^(?:MONTH|MTH|МЕС|LUN|MONAT|MESI|MESES|MOIS|个月|個月|ヶ月|か月|カ月|개월|חודש|THÁNG|THANG)/.test(u)
    ? 'month'
    : /^(?:YEAR|YR|ГОД|ЛЕТ|ANI|JAHR|ANNI|ANOS|ANS|年|년|שנ|NĂM|NAM)/.test(u)
      ? 'year'
      : 'day';
  // Sanity: nothing keeps longer than 15 years.
  const days = unit === 'day' ? n : unit === 'month' ? n * 30 : n * 365;
  return days <= 15 * 365 ? { n, unit } : null;
}

function addShelfLife(i: Interpretation, life: ShelfLife): Interpretation | null {
  const [y, m, d] = i.iso.split('-').map(Number);
  if (life.unit === 'day') {
    const t = new Date(Date.UTC(y, m - 1, d + life.n));
    return { iso: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`, precision: 'day' };
  }
  const months = life.unit === 'year' ? life.n * 12 : life.n;
  const total = (m - 1) + months;
  const year = y + Math.floor(total / 12);
  const month = (total % 12) + 1;
  if (i.precision === 'month') return toMonth(year, month);
  // The same day N months on, clamped to the end of a shorter month.
  return toDay(year, month, Math.min(d, daysInMonth(year, month)));
}

function fromShelfLife(candidates: DateCandidate[], lines: string[], today: Date): ScanParseResult | null {
  const made = candidates.filter((c) => c.label === 'manufacture');
  if (!made.length) return null;
  const life = readShelfLife(lines);
  if (!life) return null;
  const latest = made.reduce((a, b) => (b.interpretations[0].iso > a.interpretations[0].iso ? b : a));
  const expiry = addShelfLife(latest.interpretations[0], life);
  if (!expiry || !inRange(expiry, today)) return null;
  const reasons: ConfirmReason[] = ['shelf-life'];
  if (expiry.precision === 'month') reasons.push('month-only');
  if (expiry.iso < isoToday(today)) reasons.push('in-past');
  const unitText = `${life.n} ${life.unit}${life.n === 1 ? '' : 's'}`;
  return {
    kind: 'found',
    primary: expiry,
    alternatives: [],
    confidence: 'medium',
    reasons,
    label: 'expiry',
    labelText: `shelf life ${unitText}`,
    raw: `${latest.raw} + ${unitText}`,
    text: lines.join(' ').trim(),
    key: [expiry.iso, 'shelf-life'].join('|'),
  };
}

// "EXP" on one line and "10/26" on the next become "EXP 10/26" so the short form can be read.
function joinLabelOnlyLines(lines: string[]): string[] {
  const norm = lines.flatMap((l) => l.split(/\r?\n/));
  const out: string[] = [];
  for (let i = 0; i < norm.length; i++) {
    const line = norm[i];
    const n = normalizeLine(line);
    const labels = findLabels(n);
    const onlyOneExpiryLabel =
      labels.length === 1 && labels[0].kind === 'expiry' && n.replace(LABEL_RE, '').replace(/[\s:.\-]/g, '') === '';
    if (onlyOneExpiryLabel && i + 1 < norm.length && !findLabels(normalizeLine(norm[i + 1])).length) {
      out.push(`${line} ${norm[i + 1]}`);
      i++;
    } else out.push(line);
  }
  return out;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "27 Oct 2026", or "Oct 2026" for month-only dates.
export function formatDate(i: Interpretation | string): string {
  const iso = typeof i === 'string' ? i : i.iso;
  const precision = typeof i === 'string' ? 'day' : i.precision;
  const [y, m, d] = iso.split('-').map(Number);
  return precision === 'month' ? `${MONTH_NAMES[m - 1]} ${y}` : `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

export function daysUntil(iso: string, today: Date): number {
  const [y, m, d] = iso.split('-').map(Number);
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86400000);
}
