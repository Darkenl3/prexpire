// The live scanner's guidance under the frame: which short hint a pass that
// did NOT confirm a date should show. Shared by the website's scanner
// (useExpiryScanner) and the Expo shell's native scanner (useNativeScan, which
// carries a byte-identical copy), so both give the same advice for the same
// observation. No imports: it runs directly under Node's test runner.
//
// The hint follows what the pass actually OBSERVED, never a fixed fallback:
//   capture failed / text flickered away  → hold the camera steady
//   a dark photo                          → improve the lighting
//   no text at all                        → move closer
//   a production date only                → find the expiry date instead
//   a date-shaped number that won't parse,
//   or several loose digits               → the date is hard to read: move
//                                           closer, tilt against glare
//   label text with no digits at all      → point the frame at the date
//   ~20 s without a confirmed date        → say so, and point at manual entry
// The product stage never enters this decision: a recognised product does not
// pause, replace or silence any of it.

export type ScanHint = 'aim' | 'text-found' | 'low-light' | 'closer' | 'manufacture' | 'unclear' | 'hold-steady' | 'ocr-error' | 'manual';

// Misses before a specific hint replaces the neutral "Looking for the expiry date".
export const MISSES_BEFORE_HINT = 3;

export type MissObservation = {
  // Consecutive passes without a confirmed date, this one included.
  misses: number;
  // Passes after which recognition has had a fair chance (~20 seconds).
  stuckAfter: number;
  // The capture or the text reader itself failed this pass.
  failed: boolean;
  // The OCR lines this pass read (empty when none).
  lines: string[];
  // Whether the previous pass read any text.
  hadText: boolean;
  // Consecutive passes that read no text at all, this one included.
  noTextStreak: number;
  // The photo was measurably dark (EXIF brightness / canvas luminance). Only
  // a measurement claims darkness; undefined never does.
  dark?: boolean;
  // Why the date parser found nothing usable.
  parseHint?: 'no-text' | 'no-date' | 'manufacture-only' | 'invalid-date';
  // A date was read within the last few passes (OCR flickered).
  recentDate: boolean;
};

// Date-SHAPED text that did not parse into a valid date: digit groups joined by
// a separator ("2 5.1 1", "14/1"), or a bare 5-6 digit stamp. Barcode digit
// runs (7+ digits) are deliberately not date-shaped, so pointing at a barcode
// never claims "the date is hard to read" — and neither do decimal commas
// ("3,4% fat", "69,8 g").
const DATE_SHAPED_RE = /\d{1,4}\s?[./\-]\s?\d{1,4}|(?<!\d)\d{5,6}(?!\d)/;

// A printed barcode number, spaced or not ("3 838989 614249"): eight or more
// digits in one run of digits and single spaces.
const BARCODE_RUN_RE = /\d(?:\s?\d){7,}/g;

export function looksDateShaped(lines: string[]): boolean {
  return lines.some((l) => DATE_SHAPED_RE.test(l.replace(BARCODE_RUN_RE, ' ')));
}

// Several digits in view (barcode numbers aside) that did not read as a date:
// the date is most likely IN the frame but unreadable — a dot-matrix stamp
// read as scattered digits, glare across a printed date — not missing.
export function hasLooseDigits(lines: string[]): boolean {
  return lines.join(' ').replace(BARCODE_RUN_RE, ' ').replace(/\D/g, '').length >= 3;
}

export function missHint(o: MissObservation): ScanHint {
  if (o.misses >= o.stuckAfter) return 'manual';
  const hasText = o.lines.length > 0;
  if (o.misses < MISSES_BEFORE_HINT) {
    if (o.parseHint === 'no-date' && hasText) return 'text-found';
    if (o.recentDate) return 'hold-steady';
    return 'aim';
  }
  if (o.failed) return 'ocr-error';
  if (o.dark) return 'low-light';
  if (!hasText) return o.hadText ? 'ocr-error' : 'closer';
  if (o.parseHint === 'manufacture-only') return 'manufacture';
  if (o.parseHint === 'invalid-date' || looksDateShaped(o.lines) || hasLooseDigits(o.lines)) return 'unclear';
  if (o.recentDate) return 'hold-steady';
  return 'text-found';
}

// When a read date is confirmed (and the save sheet opens):
//   • a HIGH-confidence read (a labelled, unambiguous expiry date) confirms
//     on the spot — the save sheet shows it for the user to check anyway;
//   • anything else needs the same DATE read twice within the last few passes.
// Agreement is on the date itself, not on everything around it: dot-matrix
// stamps read slightly differently every pass (a stray second line, a lost
// label), and requiring identical reads made a correct "25 Nov 2026" appear
// and vanish again instead of confirming.
export const AGREEMENT_WINDOW = 5;

export function confirmsDate(recent: (string | null)[], iso: string, confidence: 'high' | 'medium'): boolean {
  if (confidence === 'high') return true;
  return recent.slice(-AGREEMENT_WINDOW).filter((k) => k === iso).length >= 2;
}

// One pass's hint only replaces the one on screen when the next pass agrees,
// so the guidance does not flicker between two messages every half second.
// 'manual' (the verdict) and a return to 'aim'/'hold-steady' apply at once.
export function settleHint(shown: ScanHint, candidate: ScanHint, previousCandidate: ScanHint | null): ScanHint {
  if (candidate === shown) return shown;
  if (candidate === 'manual' || candidate === 'aim' || candidate === 'hold-steady' || shown === 'aim' || shown === 'hold-steady') return candidate;
  return candidate === previousCandidate ? candidate : shown;
}

// A dot-matrix stamp the reader cannot make out still often shows its YEAR
// in the fragments ("202C", "2O26": the 6 read as C, the 0 as O; "2926":
// the 0 as 9). The year a stamp seems to carry, from this year to five years
// ahead, or null. Only a four-character run counts whose first two are "20"
// or its dot-matrix lookalikes (2 as 8, 3, 7 or Z; 0 as 9, 8, 6, O or D),
// with the lookalike letters mapped back to digits in its last two places.
const YEAR_LOOKALIKE: Record<string, string> = { O: '0', D: '0', Q: '0', I: '1', L: '1', Z: '2', S: '5', G: '6', C: '6', E: '6', B: '8' };
export function yearHint(lines: string[], today: Date): number | null {
  const now = today.getFullYear();
  for (const raw of lines.join(' ').toUpperCase().split(/[^0-9A-Z]+/)) {
    const m = /^[2378Z][0689OD]([0-9A-Z]{2})$/.exec(raw);
    if (!m) continue;
    const tail = [...m[1]].map((ch) => (/\d/.test(ch) ? ch : (YEAR_LOOKALIKE[ch] ?? 'x'))).join('');
    if (!/^\d\d$/.test(tail)) continue;
    const year = 2000 + Number(tail);
    if (year >= now && year <= now + 5) return year;
  }
  return null;
}

// The day and month a stamp seems to carry when the reader caught them on
// their own ("25.11", the year lost to the dots), as "MM-DD" in the user's
// order, or null. Two digits each, a dot or comma between them only: a colon
// is a clock time ("10:51"), a run of more digits is a code or a full date,
// and a percentage, price or quantity ("3,4%", "12,99 LEI") is not a date.
export function dayMonthHint(lines: string[], order: 'DMY' | 'MDY'): string | null {
  for (const line of lines) {
    const re = /(?<![\d.,])(\d{2})[.,](\d{2})(?![\d]|[.,:]\d|\s?[%€$£]|\s?(?:LEI|RON|EUR|KG|G|ML|L)\b)/gi;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const day = Number(order === 'MDY' ? m[2] : m[1]);
      const month = Number(order === 'MDY' ? m[1] : m[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

// A date put together from several reads of the same stamp: the day and
// month caught twice, and a year caught at least once (the most frequent
// one). A real calendar date, not in the past. Null when the reads do not
// add up to one.
export function fuseDate(dayMonths: (string | null)[], years: (number | null)[], today: Date): string | null {
  const count = <T,>(list: (T | null)[]) => {
    const m = new Map<T, number>();
    for (const v of list) if (v !== null) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const dm = count(dayMonths)[0];
  const year = count(years)[0];
  if (!dm || dm[1] < 2 || !year) return null;
  const iso = `${year[0]}-${dm[0]}`;
  const [y, mo, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return null;
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return iso >= todayIso ? iso : null;
}
