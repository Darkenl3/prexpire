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

// One pass's hint only replaces the one on screen when the next pass agrees,
// so the guidance does not flicker between two messages every half second.
// 'manual' (the verdict) and a return to 'aim'/'hold-steady' apply at once.
export function settleHint(shown: ScanHint, candidate: ScanHint, previousCandidate: ScanHint | null): ScanHint {
  if (candidate === shown) return shown;
  if (candidate === 'manual' || candidate === 'aim' || candidate === 'hold-steady' || shown === 'aim' || shown === 'hold-steady') return candidate;
  return candidate === previousCandidate ? candidate : shown;
}
