import { guessCategory } from './categoryGuess.ts';
import { PRODUCT_RE, formatProductName, looksLikeTechnicalTitle, titleCase } from './productGuess.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 of barcode identification: a plain TEXT web search of the barcode
// number, run only after every barcode DATABASE answered "no record" — i.e.
// when the network is already known to be up. DuckDuckGo's HTML endpoints are
// free, keyless, JavaScript-free pages; only result titles, snippets and URLs
// are read — strictly text, no vision/AI ever sees a page.
//
// WHERE THIS RUNS. In the NATIVE scanner (the Expo shell), where fetch has no
// CORS wall: the search endpoints send no CORS headers, so a browser page —
// the web bundle, the WebView's file:// page — could never read their answers
// even if it asked. That is why the web app's productLookup does NOT import
// this module (there it would be dead code), while the shell's barcodeLookup
// wires it in through a byte-identical copy of this file. The phone's
// identification pipeline is therefore: local catalog → five barcode
// databases + Open Library → this web search. Nothing was removed from it.
//
// WHY THIS STAGE IS NOW TRUSTWORTHY. Three real scans once proved the naive
// version dishonest: a Bulgarian cough syrup was named "Quaker Chewy
// Granola Bars", a medicine box "ISBN Lookup Find Any Book By ISBN", a
// produce bag "Lookup & ISBN Search" — pages that merely RANK for the
// number while carrying no verifiable tie between that name and this code.
// A candidate name must now pass an EVIDENCE gate, not just look like a name:
//   • CODE MENTION — a result's title, snippet or URL must actually contain
//     the scanned number (printed spacing allowed: "3 838989 614249") for
//     that result to count as being ABOUT this code;
//   • DIRECTORY DOMAINS NEVER NAME A PRODUCT ALONE — barcode/UPC/ISBN
//     directory sites can only CORROBORATE a name that another site also
//     carries, because their pages list whatever ranks for a number,
//     neighbouring products included;
//   • CORROBORATION — a name is accepted when two DISTINCT sites agree on
//     it, or when one non-directory page ties itself to the exact code
//     (prints it or carries it in its URL). A lone page with no verifiable
//     tie to the number is not evidence: the scanner then shows the honest
//     "We couldn't identify this product" banner with manual entry instead.
// The furniture filters stay on top of all that: lookup/ISBN/search titles
// never survive (looksLikeTechnicalTitle), site tails, prices, sizes and
// shopping jargon are stripped, and letters must dominate what remains.
//
// This module also carries the Open Library book parser (parseOpenLibrary):
// it lives here, not in productLookup, so the whole file stays free of
// react-native imports and runs directly under Node's test runner — and the
// shell's byte-identical copy gets the tested parser for free.
// ─────────────────────────────────────────────────────────────────────────────

export type WebSearchHit = { name: string; categoryHint: string | null };

// One search result: plain-text title and snippet plus the target URL
// (unwrapped from the engine's redirect when present).
export type WebResult = { title: string; snippet: string; url: string };

const REQUEST_TIMEOUT_MS = 7000;

// A fetch that never throws, for pages (never JSON): network failure/timeout →
// { net: false }; anything the server answered → { net: true, status, text }.
// Exported because the injected fetcher type is what tests mock.
export type PageResult = { net: true; status: number; text: string } | { net: false };
export type FetchPage = (url: string, timeoutMs?: number) => Promise<PageResult>;

async function fetchPage(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<PageResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text().catch(() => '');
    return { net: true, status: res.status, text };
  } catch {
    return { net: false };
  } finally {
    clearTimeout(timer);
  }
}

// Minimal HTML-entity decode + tag strip + whitespace squeeze. Search engines
// wrap the queried digits in <b>…</b> and escape entities; names must come out
// as plain text.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', reg: '®', trade: '™', copy: '©', hellip: '…',
  mdash: '—', ndash: '–', middot: '·', bull: '•', deg: '°',
  laquo: '«', raquo: '»', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D',
  euro: '€', pound: '£', yen: '¥', cent: '¢', times: '×', divide: '÷', plusmn: '±', micro: 'µ',
};

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,9});/g, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_, d: string) => {
      const n = Number(d);
      return n > 0 && n < 0x11000 ? String.fromCodePoint(n) : ' ';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => {
      const n = Number.parseInt(h, 16);
      return n > 0 && n < 0x11000 ? String.fromCodePoint(n) : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Anchor attributes → the target URL. DuckDuckGo's html endpoint wraps result
// links in its own redirector (…/l/?uddg=<url-encoded target>); the lite
// endpoint serves direct hrefs. Entities are unescaped first (&amp; is routine
// inside hrefs); anything that does not decode to an absolute http(s) URL is
// dropped rather than guessed at.
function hrefFrom(attrs: string): string {
  const m = /href\s*=\s*"([^"]*)"/.exec(attrs) || /href\s*=\s*'([^']*)'/.exec(attrs);
  if (!m) return '';
  const raw = m[1].replace(/&amp;/g, '&');
  const uddg = /(?:^|[?&])uddg=([^&]*)/.exec(raw);
  const target = uddg ? uddg[1] : raw;
  let decoded: string;
  try {
    decoded = decodeURIComponent(target);
  } catch {
    return '';
  }
  return /^https?:\/\//i.test(decoded) ? decoded : '';
}

// Every anchor in the page, with its attributes (for class/href matching) and
// its tag-stripped text, in document order.
function anchors(html: string): { attrs: string; text: string }[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], text: htmlToText(m[2]) }));
}

// html.duckduckgo.com/html/: results carry
//   <a ... class="result__a" href=…>Title</a>  and  <a ... class="result__snippet" …>…</a>
// Titles and snippets are zipped in document order. Exported for tests.
export function parseDdgHtml(html: string): WebResult[] {
  const titles = anchors(html).filter((a) => /class="[^"]*result__a[^"]*"/.test(a.attrs));
  const snippets = [...html.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => htmlToText(m[1]));
  const out: WebResult[] = [];
  for (let i = 0; i < titles.length; i++) out.push({ title: titles[i].text, snippet: snippets[i] ?? '', url: hrefFrom(titles[i].attrs) });
  return out.filter((r) => r.title.length > 0);
}

// lite.duckduckgo.com/lite/: a bare table — result links are the only
// rel="nofollow" anchors, snippets sit in <td class="result-snippet"> cells.
// Exported for tests.
export function parseDdgLite(html: string): WebResult[] {
  const titles = anchors(html).filter((a) => /rel="nofollow"/.test(a.attrs));
  const snippets = [...html.matchAll(/<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => htmlToText(m[1]));
  const out: WebResult[] = [];
  for (let i = 0; i < titles.length; i++) out.push({ title: titles[i].text, snippet: snippets[i] ?? '', url: hrefFrom(titles[i].attrs) });
  return out.filter((r) => r.title.length > 0);
}

// DuckDuckGo serves an interstitial ("anomaly"/bot challenge) instead of
// results when it distrusts the client — that is a SEARCH failure, not a
// "product not found", and must stay 'error' so a later scan retries.
function looksBlocked(html: string): boolean {
  return /class="[^"]*anomaly|anomaly-detection|unfortunately, bots|If this persists/i.test(html);
}

// Site/retailer tails that ride behind a result title ("… - Walmart.com").
// The UPC/barcode-directory sites are included by name AND as word tails, so
// "Search Barcodestock", "Go-UPC" and "CheckUpc" style directory brands can
// never survive as (part of) a product name.
const SITE_TAIL_RE = /^(?:walmart|instacart|amazon|target|ebay|etsy|heb|kroger|wegmans|safeway|aldiusa|publix|costco|h-e-b|meijer|freshdirect|boxed|jet|seamless|grubhub|doordash|shipt|gopuff|upcitemdb|barcodelookup|barcodestock|upcsearch|barcodeindex|go-upc|chiptip|worldcoin|alibaba|aliexpress|dhgate|bonanza|rakuten|newegg|wish|shein|temu)(?:\s*[-·|]\s*[a-z0-9 .&]+)?$/i;
const DOMAINISH_RE = /^(?:[a-z0-9-]+\.)+(?:com|net|org|co|io|shop|store|biz|info|us|ca|de|fr|es|it|nl|pl|se|ua|uk)(?:\s*[-·|]\s*[a-z0-9 .&]+)?$/i;

// UPC/barcode jargon that never belongs in a product name.
const CODE_JARGON_RE = /\b(?:upc|upc-a|ean|ean-13|gtin|barcode|bar\s*code|item\s*code|product\s*code|sku|asin)\b/gi;
// Shopping furniture that sneaks into titles and snippets.
const SHOPPING_RE = /\b(?:free\s+(?:shipping|delivery)|add\s+to\s+(?:cart|basket)|in\s+stock|out\s+of\s+stock|order\s+online|shop\s+now|buy\s+now|for\s+sale|special\s+offers?|best\s+(?:sellers?|deals?)|coupons?|promo?\s*code|reviews?)\b/gi;
// A price, with or without a currency mark ("$3.99", "3,99 €", "USD 4").
const PRICE_RE =
  /[$€£₴]\s*\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s*[$€£₴]|\b(?:usd|eur|gbp)\b\s*\d+(?:[.,]\d{1,2})?\b|\b\d+(?:[.,]\d{1,2})?\s*(?:usd|eur|gbp)\b/gi;
// Quantities and sizes ("5.3 oz", "400 g", "12 pack", "6 x 90 g").
const SIZE_RE = /\b(?:\d+\s*x\s*)?\d+(?:[.,]\d+)?\s*(?:fl\.?\s*)?(?:oz|ounce|g|gr|gram(?:s)?|kg|ml|cl|l|litre|liter|lb|pound|ct|count|pack|pk|piece(?:s)?|pc|singles?)\b/gi;

// Turn one raw title/snippet into a candidate product name, or null when
// nothing name-like survives the cleaning. Exported for tests.
export function cleanWebCandidate(raw: string, code: string): string | null {
  let t = htmlToText(raw);
  if (!t) return null;
  // Drop trailing " - Site" / " | Site.com" segments (at most two: some titles
  // stack a retailer behind a distributor).
  for (let i = 0; i < 2; i++) {
    const parts = t.split(/\s+[-–—|·»]\s+/);
    if (parts.length > 1) {
      const tail = parts[parts.length - 1].trim();
      if (
        SITE_TAIL_RE.test(tail) ||
        DOMAINISH_RE.test(tail) ||
        (tail.split(/\s+/).length <= 2 && /\.(?:com|net|org|co|io)\b/i.test(tail))
      ) {
        parts.pop();
        t = parts.join(' - ');
        continue;
      }
    }
    break;
  }
  t = t
    .replace(new RegExp(`\\b${code}\\b`, 'g'), ' ') // the barcode itself, quoted or bare
    .replace(/\b\d{6,14}\b/g, ' ') // …and any other long digit run (related codes)
    .replace(CODE_JARGON_RE, ' ')
    .replace(PRICE_RE, ' ')
    .replace(SIZE_RE, ' ')
    .replace(SHOPPING_RE, ' ')
    .replace(/[®™©]/g, '')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    // Trailing punctuation may be stranded in pieces ("hours. .") after the
    // jargon/price removals, so the tail trim repeats over punct+space runs.
    .replace(/(?:\s*[.,;:–—|·])+\s*$/, '')
    .replace(/\s*[,;:–—|·]\s+/g, ' ')
    .trim();
  if (!t) return null;
  // Page furniture that masquerades as a short name on empty result pages
  // ("no results here", "see more results"): a product name made ENTIRELY of
  // furniture words never exists.
  const FURNITURE = new Set([
    'no', 'not', 'results', 'result', 'found', 'see', 'search', 'next', 'previous',
    'page', 'pages', 'more', 'images', 'videos', 'news', 'shopping', 'here',
    'matches', 'match', 'available', 'web', 'site', 'website', 'all', 'any', 'other',
    'report', 'reports', 'lookup', 'lookups', 'million', 'millions', 'products',
  ]);
  if (t.split(' ').every((w) => FURNITURE.has(w.toLowerCase()))) return null;
  const words = t.split(' ');
  if (words.length < 1 || words.length > 10) return null;
  // Letters have to dominate the surviving text — a pile of digits, units and
  // symbols is not a name.
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '').length;
  const solid = t.replace(/\s/g, '').length;
  if (!solid || letters / solid < 0.5) return null;
  // Pure numbers, prices and sizes are not names either.
  if (words.every((w) => /^[\d.,$€£₴%+x]+$/i.test(w))) return null;
  // Search-page furniture ("Lookup & ISBN Search") masquerading as a short
  // name: a title made entirely of lookup jargon never names a product.
  if (looksLikeTechnicalTitle(t)) return null;
  return formatProductName(t, 80);
}

// ─── The evidence gate ───────────────────────────────────────────────────────

// The scanned number as it appears in print: digit groups may be spaced or
// dashed ("3 838989 614249"). A 12-digit UPC and its zero-padded EAN-13 twin
// mean the same code, and pages print either form.
function mentionPatterns(code: string): RegExp[] {
  const forms = new Set([code]);
  if (code.length === 12) forms.add(`0${code}`);
  if (code.length === 13 && code.startsWith('0')) forms.add(code.slice(1));
  return [...forms].map((f) => new RegExp(f.split('').join('[\\s\\u00A0\\-]*')));
}

// Does one result tie itself to the scanned code — the number printed in its
// title, snippet, or URL? Exported for tests.
export function resultMentionsCode(r: WebResult, code: string): boolean {
  const hay = `${r.title} ${r.snippet} ${r.url}`;
  return mentionPatterns(code).some((p) => p.test(hay));
}

function hostOf(url: string): string {
  if (!/^https?:\/\//i.test(url)) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Barcode/UPC/ISBN directory sites: pages that catalogue codes. Their
// search pages for a number list whatever ranks — neighbouring products
// included — so they may CORROBORATE a name, but never supply one alone.
// Matched on hostname tokens ("www.barcodestock.com" → barcodestock,
// "go-upc.com" → go, upc): a token IS a hint, or is a compound of one
// ("upcitemdb" starts with "upc").
const DIRECTORY_HINTS = ['barcode', 'upc', 'ean', 'gtin', 'isbn', 'asin', 'lookup', 'chiptip', 'worldcoin'];

function isDirectoryHost(host: string): boolean {
  if (!host) return false;
  const tokens = host.split('.').flatMap((l) => l.split('-')).filter(Boolean);
  return tokens.some((t) => DIRECTORY_HINTS.some((h) => t === h || (t.length > h.length && (t.startsWith(h) || t.endsWith(h)))));
}

// Normalized form for cross-result agreement: lowercase letters and digits
// only, token-sorted, so "Chobani Greek Yogurt Blueberry" and "blueberry
// chobani greek yogurt 5 3 oz" overlap heavily.
function normTokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, ' ').trim().split(/\s+/).filter((w) => w.length > 1);
}

function tokenOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

// What one result brings to the trust decision.
type Evidence = { host: string; directory: boolean; mentionsCode: boolean };

// THE GATE. `corroborators` are the candidates (from any result) whose token
// set overlaps the winning name's by at least half — the results that are
// independently saying (roughly) the same name. A name is trusted exactly
// when one of these holds:
//   1. two DISTINCT non-directory sites carry it — plain corroboration;
//   2. two distinct sites carry it and at least one PRINTS the code (covers
//      all-directory agreement: two catalogues that both hold a record FOR
//      this number are databases, not noise);
//   3. the engine's URLs could not be parsed at all (older page shape), but
//      two separate results agree and one prints the code — degraded mode,
//      still evidence-tied;
//   4. one non-directory page ties itself to the exact code (prints it or
//      carries it in its URL): a per-code record, the same evidence class
//      the barcode databases themselves answer with.
// A lone directory page — however clean its name — is NONE of these.
function nameIsTrusted(corroborators: { idx: number; ev: Evidence }[]): boolean {
  const known = corroborators.map((c) => c.ev).filter((e) => e.host !== '');
  const unknownCount = corroborators.filter((c) => c.ev.host === '').length;
  const distinctHosts = new Set(known.map((e) => e.host));
  const someMention = corroborators.some((c) => c.ev.mentionsCode);
  const distinctResults = new Set(corroborators.map((c) => c.idx)).size;
  if (distinctHosts.size >= 2) return known.some((e) => !e.directory) || someMention;
  if (distinctHosts.size === 0) return unknownCount >= 2 && distinctResults >= 2 && someMention;
  return known.some((e) => !e.directory && e.mentionsCode);
}

// Mine the most plausible product name out of the search results — but only
// one that passes the evidence gate. Candidates come from every title
// (clean) and snippet (penalised); the winner is the candidate that looks
// most like a name AND that other results independently agree on. Returns
// null when nothing EARNS the name: that is the honest "couldn't identify"
// answer, never a guess. Exported for tests.
export function mineProductName(results: WebResult[], code: string): string | null {
  const patterns = mentionPatterns(code);
  const evidence: Evidence[] = results.map((r) => {
    const host = hostOf(r.url);
    return {
      host,
      directory: isDirectoryHost(host),
      mentionsCode: patterns.some((p) => p.test(`${r.title} ${r.snippet} ${r.url}`)),
    };
  });

  type Cand = { text: string; fromTitle: boolean; idx: number; tokens: string[] };
  const cands: Cand[] = [];
  results.slice(0, 8).forEach((r, idx) => {
    for (const [raw, fromTitle] of [
      [r.title, true],
      [r.snippet, false],
    ] as [string, boolean][]) {
      const text = cleanWebCandidate(raw, code);
      if (text) cands.push({ text, fromTitle, idx, tokens: normTokens(text) });
    }
  });
  if (!cands.length) return null;

  let best: { text: string; score: number; tokens: string[]; idx: number } | null = null;
  for (const c of cands) {
    const words = c.text.split(' ');
    let score = 0;
    if (words.length >= 2 && words.length <= 5) score += 2;
    else if (words.length === 6) score += 1;
    else if (words.length === 1) score -= 1.5; // a lone word is rarely the product
    if (!c.fromTitle) score -= 1; // titles are curated; snippets are prose
    if (PRODUCT_RE.test(c.text.toUpperCase())) score += 2;
    if (/[a-z]/.test(c.text) && /[A-Z]/.test(c.text)) score += 0.5; // printed-name casing
    // Independent agreement only: a result's own title and snippet echo each
    // other by construction, so agreement counts candidates from OTHER results.
    const agree = cands.filter((o) => o.idx !== c.idx && tokenOverlap(o.tokens, c.tokens) >= 0.5).length;
    score += Math.min(agree, 3) * 1.5;
    if (!best || score > best.score) best = { text: c.text, score, tokens: c.tokens, idx: c.idx };
  }
  if (!best) return null;
  if (looksLikeTechnicalTitle(best.text)) return null; // never let page furniture win the vote

  // The candidates that independently echo the winning name — each carries
  // its result's evidence for the gate.
  const corroborators = cands
    .filter((c) => tokenOverlap(c.tokens, best!.tokens) >= 0.5)
    .map((c) => ({ idx: c.idx, ev: evidence[c.idx] }));
  if (!nameIsTrusted(corroborators)) return null;
  // The gate carries the trust; the score's remaining job is "reads like a
  // name". A trusted single-word fragment is still noise; anything with at
  // least a word of substance passes.
  if (best.score < 1) return null;
  // Case discipline: an ALL-CAPS scrape is a shouted title and gets
  // title-cased ("QUAKER CHEWY" → "Quaker Chewy"); a mixed-case name is
  // printed as-is on the page and is kept verbatim ("NeoBianacid",
  // "AVEENO Daily Moisturizing") — flattening it would invent a spelling.
  const cased = best.text === best.text.toUpperCase() ? titleCase(best.text) : best.text;
  return formatProductName(cased);
}

// ─── The stage itself ────────────────────────────────────────────────────────

// One engine attempt: unreachable OR an HTTP error status counts as "this
// engine could not be searched"; a parsed page is its result set (empty when
// the engine genuinely has no results, plus a blocked flag for the DDG
// anomaly interstitial, which is a search failure rather than a miss).
type EngineOutcome = { ok: true; results: WebResult[]; blocked: boolean } | { ok: false };

async function tryEngine(url: string, parse: (html: string) => WebResult[], fetcher: FetchPage): Promise<EngineOutcome> {
  const page = await fetcher(url);
  if (!page.net || page.status >= 400) return { ok: false };
  if (looksBlocked(page.text)) return { ok: true, results: [], blocked: true };
  return { ok: true, results: parse(page.text), blocked: false };
}

export async function webSearchBarcode(code: string, fetcher: FetchPage = fetchPage): Promise<WebSearchHit | 'miss' | 'error'> {
  // Quoted number: a bare long number can trip the calculator instant answer.
  const html = await tryEngine(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`"${code}"`)}`,
    parseDdgHtml,
    fetcher,
  );
  if (html.ok && html.blocked) return 'error';
  let results = html.ok ? html.results : [];
  // Second engine, different shape AND different query form — hedges both a
  // parse quirk and a query-syntax flake. It also runs when the first engine's
  // results hold no TRUSTED name: lite's pages can corroborate html's, which
  // is exactly what a single weak-but-real listing needs.
  if (!results.length || !mineProductName(results, code)) {
    const lite = await tryEngine(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(`${code} barcode`)}`,
      parseDdgLite,
      fetcher,
    );
    if (lite.ok && lite.blocked) return 'error';
    if (lite.ok && lite.results.length) results = [...results, ...lite.results];
    else if (!html.ok && !lite.ok) return 'error'; // both engines unreachable: no search happened
  }
  if (!results.length) return 'miss'; // searched; the web simply has nothing for this number
  const name = mineProductName(results, code);
  if (!name) return 'miss'; // pages exist for the number, but no name earned trust
  return { name, categoryHint: guessCategory(name) };
}

// ─── Open Library: the book database ─────────────────────────────────────────
// ISBN-13 barcodes (978/979 prefixes) are BOOKS: the biggest barcode family
// the food/retail databases barely touch, and the one whose searches rank
// ISBN-lookup furniture pages. Open Library answers FOR the exact code with
// a real catalogue record — ~30M books, free, keyless, CORS-enabled (so the
// browser bundle can query it too, not just the native shell). The parser
// lives here so it is node-testable; productLookup/barcodeLookup own the
// fetch and the source ordering.

export type OpenLibraryHit = { name: string; image?: string } | null;

export function parseOpenLibrary(json: unknown): OpenLibraryHit {
  if (!json || typeof json !== 'object') return null;
  const j = json as { title?: unknown; authors?: unknown; cover?: unknown };
  const title = typeof j.title === 'string' ? j.title.trim() : '';
  if (!title) return null; // 404 bodies ({"error":"notfound"}) land here: no record
  const authors = Array.isArray(j.authors) ? j.authors : [];
  const author = authors
    .map((a) => (a && typeof a === 'object' ? (a as { name?: unknown }).name : undefined))
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    .map((n) => n.trim())[0] ?? '';
  const name = formatProductName(author ? `${title} - ${author}` : title);
  if (!name || looksLikeTechnicalTitle(name)) return null;
  const cover = j.cover && typeof j.cover === 'object' ? (j.cover as { small?: unknown; medium?: unknown; large?: unknown }) : {};
  const image =
    typeof cover.medium === 'string' && /^https:\/\//.test(cover.medium)
      ? cover.medium
      : typeof cover.large === 'string' && /^https:\/\//.test(cover.large)
        ? cover.large
        : typeof cover.small === 'string' && /^https:\/\//.test(cover.small)
          ? cover.small
          : undefined;
  return { name, image };
}
