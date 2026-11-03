// GS1 codes that carry the expiry date itself: the DataMatrix on every EU
// prescription medicine pack (required since 2019 by the Falsified
// Medicines Directive) and the GS1 QR / Digital Link codes appearing on food.
// Their contents are GS1 "element strings": application identifiers (AIs)
// followed by their data —
//   01 GTIN (14 digits)        17 expiry date (YYMMDD)
//   15 best before (YYMMDD)    16 sell by (YYMMDD)
//   10 batch / lot (up to 20)  21 serial (up to 20)
// A date's DD of 00 means the end of that month. Variable-length fields end
// at a group separator (ASCII 29) or the end of the data. A Digital Link is
// a URL carrying the same AIs as path segments or query parameters.
// Pure logic, no React Native imports; the shell keeps a byte-identical copy.

export type Gs1 = {
  gtin?: string;
  expiry?: { iso: string; precision: 'day' | 'month' };
  bestBefore?: { iso: string; precision: 'day' | 'month' };
  sellBy?: { iso: string; precision: 'day' | 'month' };
  batch?: string;
};

const GS = String.fromCharCode(29);
// AIs with a fixed data length (the ones that matter here, plus the common
// fixed ones that can come before them, so the string can be walked).
const FIXED: Record<string, number> = { '00': 18, '01': 14, '02': 14, '11': 6, '12': 6, '13': 6, '15': 6, '16': 6, '17': 6, '20': 2 };
const VARIABLE = new Set(['10', '21', '22', '240', '241', '30', '37', '90', '91', '92', '93', '94', '95', '96', '97', '98', '99']);

const pad = (n: number) => String(n).padStart(2, '0');

function gsDate(yymmdd: string): { iso: string; precision: 'day' | 'month' } | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const year = 2000 + Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4));
  if (month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day === 0) return { iso: `${year}-${pad(month)}-${pad(last)}`, precision: 'month' };
  if (day > last) return null;
  return { iso: `${year}-${pad(month)}-${pad(day)}`, precision: 'day' };
}

function apply(out: Gs1, ai: string, value: string) {
  if (ai === '01' && /^\d{14}$/.test(value)) out.gtin = value;
  else if (ai === '17') out.expiry = gsDate(value) ?? undefined;
  else if (ai === '15') out.bestBefore = gsDate(value) ?? undefined;
  else if (ai === '16') out.sellBy = gsDate(value) ?? undefined;
  else if (ai === '10' && value) out.batch = value;
}

// Element strings ("010950110153000317280131" + GS + "10ABC"). Returns null
// when the data is not GS1 (an ordinary QR code, a URL, plain text).
function elementString(raw: string): Gs1 | null {
  // Readers may pass a symbology prefix ("]d2", "]Q3", "]C1") or an FNC1.
  let s = raw.replace(/^\][A-Za-z]\d/, '').replace(/^è|^\u001d/, '');
  if (!/^\d{2}/.test(s)) return null;
  const out: Gs1 = {};
  let found = 0;
  while (s.length >= 2) {
    const ai2 = s.slice(0, 2);
    const ai3 = s.slice(0, 3);
    const ai4 = s.slice(0, 4);
    if (FIXED[ai2] !== undefined) {
      const len = FIXED[ai2];
      const value = s.slice(2, 2 + len);
      if (value.length < len) return found ? out : null;
      apply(out, ai2, value);
      found += 1;
      s = s.slice(2 + len);
      if (s.startsWith(GS)) s = s.slice(1);
      continue;
    }
    const ai = VARIABLE.has(ai4) ? ai4 : VARIABLE.has(ai3) ? ai3 : VARIABLE.has(ai2) ? ai2 : null;
    if (!ai) return found ? out : null;
    const end = s.indexOf(GS, ai.length);
    const value = s.slice(ai.length, end < 0 ? undefined : end).slice(0, 30);
    apply(out, ai, value);
    found += 1;
    s = end < 0 ? '' : s.slice(end + 1);
  }
  return found ? out : null;
}

// A GS1 Digital Link ("https://id.gs1.org/01/09501101530003/10/ABC?17=280131").
function digitalLink(raw: string): Gs1 | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.indexOf('01');
  if (at < 0 || !/^\d{8,14}$/.test(parts[at + 1] ?? '')) return null;
  const out: Gs1 = {};
  for (let i = at; i + 1 < parts.length; i += 2) {
    const ai = parts[i];
    const value = decodeURIComponent(parts[i + 1]);
    apply(out, ai, ai === '01' ? value.padStart(14, '0') : value);
  }
  for (const [ai, value] of url.searchParams) apply(out, ai, value);
  return out;
}

export function parseGs1(raw: string): Gs1 | null {
  if (!raw) return null;
  const r = /^https?:\/\//i.test(raw.trim()) ? digitalLink(raw) : elementString(raw);
  // Only a code that gives a product or a date counts as GS1 here.
  return r && (r.gtin || r.expiry || r.bestBefore || r.sellBy) ? r : null;
}

// The GTIN as the code the product databases know: GTIN-14 with its leading
// zeros dropped to EAN-13 (or UPC-A's 12 digits inside it, kept as EAN-13).
export function gtinToEan(gtin: string): string {
  const g = gtin.replace(/^0+(?=\d{13}$)/, '');
  return g.length === 14 && g.startsWith('0') ? g.slice(1) : g;
}
