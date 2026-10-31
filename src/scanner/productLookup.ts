import { Platform } from 'react-native';
import { guessCategory } from './categoryGuess';
import { PRODUCT_RE, looksLikeTechnicalTitle, titleCase } from './productGuess';

// Barcode → product lookup across the free, keyless PUBLIC barcode databases —
// no API keys, no accounts, no AI, just plain HTTPS GETs. One decoded barcode is
// queried in PARALLEL across every source, each under a short timeout, so the
// wall-clock cost stays one round trip no matter how many databases are asked.
// A product only has to exist in ONE of them to be identified, and they cover
// different worlds:
//
//   Open Food Facts       — food & drinks (curated names, category tags, photos)
//   Open Beauty Facts     — cosmetics & personal care
//   Open Pet Food Facts   — pet food
//   Open Products Facts   — everything else (household goods, hardware…)
//   UPCitemdb             — the big US retail catalogue (UPC-A/EAN, brand + title)
//
// On NATIVE every source runs, and when every database answers "no record" a
// plain TEXT web search of the barcode number follows (DuckDuckGo's HTML
// endpoints, no keys, no JavaScript, no vision/AI: only result titles and
// snippets are read). In THE BROWSER only the Open*Facts family runs: the
// others send no CORS headers, so a page could never read their answers, and
// the web search stage is skipped for the same reason.
//
// Honesty rules, same discipline as the rest of the scanner:
//   • a code is only "not found" (miss) when EVERY source gave a definite
//     no-record answer — so a definite miss can be cached without lying;
//   • offline, timeouts, rate limits and CORS-blocked sources are 'unreachable',
//     never a miss, so a later online session still gets its chance;
//   • UPCitemdb items are only accepted when the item's OWN code matches the
//     scanned one — a "close" code is not evidence;
//   • web-search names must look like product names (letters dominate, no
//     price/UPC/site junk left) and are preferred when several independent
//     results agree on them; a bare number or a shop menu never becomes a name;
//   • nothing is invented: no hit means no name, and the scanner shows the
//     honest status instead.

export type BarcodeHit = {
  name: string;
  image?: string;
  categoryHint: string | null;
  // Human-readable database name for the provenance line ("Open Food Facts").
  sourceLabel: string;
};

export type BarcodeOutcome =
  | { kind: 'hit'; hit: BarcodeHit }
  // Every database answered: this code has no record anywhere.
  | { kind: 'miss' }
  // No usable answer at all (offline, timeouts, rate limits) — unknown, not absent.
  | { kind: 'unreachable' };

// One source's answer: a hit, a definite no-record, or no answer.
type SourceAnswer = BarcodeHit | 'miss' | 'error';

const REQUEST_TIMEOUT_MS = 7000;
// In the browser only the CORS-enabled Open*Facts family answers; the others
// cannot, so they are not even asked (a blocked request is not evidence).
const WEB = Platform.OS === 'web';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const httpsOnly = (v: unknown): string | undefined => (typeof v === 'string' && /^https:\/\//.test(v) ? v : undefined);

// A fetch that never throws: network failure/timeout → { net: false }, anything
// the server answered → { net: true, json } (null when the body is not JSON).
// The body is parsed regardless of the HTTP status: the Open*Facts family
// answers "product not found" with HTTP 404 PLUS a JSON body saying so.
type NetResult = { net: true; json: unknown } | { net: false };

async function fetchJson(url: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<NetResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const json = await res.json().catch(() => null);
    return { net: true, json };
  } catch {
    return { net: false };
  } finally {
    clearTimeout(timer);
  }
}

// "Brand Product" without repeating the brand when the name already starts
// with it (port of the previous inline Open Food Facts logic).
function composeName(brand: string, productName: string): string {
  return (
    brand && productName && productName.toLowerCase().startsWith(brand.toLowerCase())
      ? productName
      : [brand, productName].filter(Boolean).join(' ')
  ).slice(0, 80);
}

// --- The Open*Facts family (Open Food / Beauty / Pet Food / Products Facts) ---
// All four run the same open-source platform, so one parser serves them all.
// They send CORS headers, so they answer in the browser too. 12-digit UPC-A
// codes also live zero-padded as EAN-13 in these databases, so both forms are
// queried in parallel and either one may carry the record.

const OFF_FIELDS = 'status,product_name,product_name_en,generic_name,brands,image_front_small_url,categories_tags';

type OffProduct = {
  product_name?: unknown;
  product_name_en?: unknown;
  generic_name?: unknown;
  brands?: unknown;
  image_front_small_url?: unknown;
  categories_tags?: unknown;
};

async function openFactsOne(domain: string, code: string): Promise<SourceAnswer> {
  const res = await fetchJson(`https://${domain}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (!res.net) return 'error';
  const json = res.json as { status?: unknown; product?: OffProduct } | null;
  if (!json || typeof json !== 'object') return 'error';
  if (json.status !== 1) return 'miss'; // status 0 (HTTP 200 or 404): no record here
  const p = json.product ?? {};
  const rawName = str(p.product_name) || str(p.product_name_en) || str(p.generic_name);
  const productName = rawName.split(',')[0].trim();
  const brand = str(p.brands).split(',')[0].trim();
  const name = composeName(brand, productName);
  if (!name || looksLikeTechnicalTitle(name)) return 'miss'; // no usable name (or page furniture, not a product) is no evidence
  const image = httpsOnly(p.image_front_small_url);
  // Category tags ("en:sweet-spreads") read better as plain words for the
  // keyword-based category guess ("sweet spreads").
  const tags = Array.isArray(p.categories_tags)
    ? p.categories_tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.replace(/^[a-z]{2,3}:/, '').replace(/-/g, ' '))
        .join(' ')
    : '';
  return { name, image, categoryHint: guessCategory(`${brand} ${productName} ${tags}`), sourceLabel: '' };
}

async function openFactsLookup(domain: string, label: string, code: string): Promise<SourceAnswer> {
  const forms = code.length === 12 ? [code, `0${code}`] : [code];
  const answers = await Promise.all(forms.map((c) => openFactsOne(domain, c)));
  const hit = answers.find((a): a is BarcodeHit => a !== 'miss' && a !== 'error');
  if (hit) return { ...hit, sourceLabel: label };
  return answers.includes('error') ? 'error' : 'miss';
}

// --- UPCitemdb (free trial endpoint, no key; ~100 lookups/day per network) ---
// Native only: the endpoint sends no CORS headers, so the browser cannot read it.

async function upcItemDbLookup(code: string): Promise<SourceAnswer> {
  const res = await fetchJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`);
  if (!res.net) return 'error';
  const json = res.json as { code?: unknown; items?: unknown } | null;
  if (!json || typeof json !== 'object') return 'error';
  const status = str(json.code);
  if (status === 'RATE_LIMIT_EXCEEDED') return 'error'; // the free tier's daily cap: not this barcode's fault
  if (status !== 'OK') return 'miss'; // NOT_FOUND / INVALID_UPC: no record here
  const items = Array.isArray(json.items) ? json.items : [];
  const item = items.find((it): it is Record<string, unknown> => !!it && typeof it === 'object');
  if (!item) return 'miss'; // OK with no items: no record here

  // Exact-match guard: the item must be FOR this code. Both a 12-digit UPC and
  // its zero-padded EAN-13 form mean the same product.
  const norm = (x: string) => x.replace(/\D/g, '').padStart(13, '0');
  const ownUpc = str(item.upc);
  const ownEan = str(item.ean);
  const exact = (ownUpc && norm(ownUpc) === norm(code)) || (ownEan && norm(ownEan) === norm(code));
  if (!exact) return 'miss';

  // Titles read "Brand Full Product Name  12 oz": the size rides behind a run
  // of spaces, so the first segment names the product cleanly.
  const title = str(item.title).split(/\s{2,}/)[0].trim().slice(0, 80);
  // A title that is lookup-page furniture ("Lookup & ISBN Search") is not a
  // product name, no matter which database served it.
  if (!title || looksLikeTechnicalTitle(title)) return 'miss';
  const brand = str(item.brand);
  const category = str(item.category).replace(/>/g, ' ');
  const images = Array.isArray(item.images) ? item.images : [];
  const image = images.map(httpsOnly).find((u): u is string => !!u);
  return { name: title, image, categoryHint: guessCategory(`${brand} ${title} ${category}`), sourceLabel: 'UPCitemdb' };
}

// Sources in preference order: a curated Open*Facts name (with real category
// tags) beats the retail catalogue's longer titles; UPCitemdb then carries the
// US/UPC products the food databases don't have, and the niche databases cover
// cosmetics, pet food and household goods.
const SOURCES: { run: (code: string) => Promise<SourceAnswer> }[] = [
  { run: (c) => openFactsLookup('world.openfoodfacts.org', 'Open Food Facts', c) },
  ...(WEB ? [] : [{ run: upcItemDbLookup }]),
  { run: (c) => openFactsLookup('world.openbeautyfacts.org', 'Open Beauty Facts', c) },
  { run: (c) => openFactsLookup('world.openpetfoodfacts.org', 'Open Pet Food Facts', c) },
  { run: (c) => openFactsLookup('world.openproductsfacts.org', 'Open Products Facts', c) },
];

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 — text web search fallback, NATIVE ONLY (STRICTLY text: result
// titles/snippets only; no vision model ever sees a page screenshot).
// DuckDuckGo's HTML endpoints are free, keyless, JavaScript-free pages that
// work from a plain native fetch (the browser blocks them by CORS). Runs
// only after every barcode database answered "no record" — i.e. when the
// network is known to be up.
// ─────────────────────────────────────────────────────────────────────────────

// A fetch that never throws, for pages (never JSON): network failure/timeout →
// { net: false }; anything the server answered → { net: true, status, text }.
export type PageResult = { net: true; status: number; text: string } | { net: false };

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

export type WebResult = { title: string; snippet: string };

// html.duckduckgo.com/html/: results carry
//   <a ... class="result__a" ...>Title</a>  and  <a ... class="result__snippet" ...>…</a>
// Titles and snippets are zipped in document order.
export function parseDdgHtml(html: string): WebResult[] {
  const titles = [...html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => htmlToText(m[1]));
  const snippets = [...html.matchAll(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => htmlToText(m[1]));
  const out: WebResult[] = [];
  for (let i = 0; i < titles.length; i++) out.push({ title: titles[i], snippet: snippets[i] ?? '' });
  return out.filter((r) => r.title.length > 0);
}

// lite.duckduckgo.com/lite/: a bare table — result links are the only
// rel="nofollow" anchors, snippets sit in <td class="result-snippet"> cells.
export function parseDdgLite(html: string): WebResult[] {
  const titles = [...html.matchAll(/<a[^>]*rel="nofollow"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => htmlToText(m[1]));
  const snippets = [...html.matchAll(/<td[^>]*class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => htmlToText(m[1]));
  const out: WebResult[] = [];
  for (let i = 0; i < titles.length; i++) out.push({ title: titles[i], snippet: snippets[i] ?? '' });
  return out.filter((r) => r.title.length > 0);
}

// DuckDuckGo serves an interstitial ("anomaly"/bot challenge) instead of
// results when it distrusts the client — that is a SEARCH failure, not a
// "product not found", and must stay 'unreachable' so a later scan retries.
function looksBlocked(html: string): boolean {
  return /class="[^"]*anomaly|anomaly-detection|unfortunately, bots|If this persists/i.test(html);
}

// Site/retailer tails that ride behind a result title ("… - Walmart.com").
const SITE_TAIL_RE = /^(?:walmart|instacart|amazon|target|ebay|etsy|heb|kroger|wegmans|safeway|aldiusa|publix|costco|h-e-b|meijer|freshdirect|boxed|jet|seamless|grubhub|doordash|shipt|gopuff|instacart|upcitemdb|barcodelookup|upcsearch|barcodeindex|go-upc|chiptip|worldcoin|alibaba|aliexpress|dhgate|bonanza|rakuten|newegg|wish|shein|temu)(?:\s*[-·|]\s*[a-z0-9 .&]+)?$/i;
const DOMAINISH_RE = /^(?:[a-z0-9-]+\.)+(?:com|net|org|co|io|shop|store|biz|info|us|ca|de|fr|es|it|nl|pl|se|ua|uk)(?:\s*[-·|]\s*[a-z0-9 .&]+)?$/i;

// UPC/barcode jargon that never belongs in a product name.
const CODE_JARGON_RE = /\b(?:upc|upc-a|ean|ean-13|gtin|barcode|bar\s*code|item\s*code|product\s*code|sku|asin)\b/gi;
// Shopping furniture that sneaks into titles and snippets.
const SHOPPING_RE = /\b(?:free\s+(?:shipping|delivery)|add\s+to\s+(?:cart|basket)|in\s+stock|out\s+of\s+stock|order\s+online|shop\s+now|buy\s+now|for\s+sale|best\s+(?:sellers?|deals?)|coupons?|promo?\s*code|reviews?)\b/gi;
// A price, with or without a currency mark ("$3.99", "3,99 €", "USD 4").
const PRICE_RE =
  /[$€£₴]\s*\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s*[$€£₴]|\b(?:usd|eur|gbp)\b\s*\d+(?:[.,]\d{1,2})?\b|\b\d+(?:[.,]\d{1,2})?\s*(?:usd|eur|gbp)\b/gi;
// Quantities and sizes ("5.3 oz", "400 g", "12 pack", "6 x 90 g").
const SIZE_RE = /\b(?:\d+\s*x\s*)?\d+(?:[.,]\d+)?\s*(?:fl\.?\s*)?(?:oz|ounce|g|gr|gram(?:s)?|kg|ml|cl|l|litre|liter|lb|pound|ct|count|pack|pk|piece(?:s)?|pc|singles?)\b/gi;

// Turn one raw title/snippet into a candidate product name, or null when
// nothing name-like survives the cleaning.
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
  return t.slice(0, 80);
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

// Mine the most plausible product name out of the search results. Candidates
// come from every title (clean) and snippet (penalised); the winner is the
// candidate that looks most like a name AND that other results independently
// agree on. Returns null when nothing earns the name.
export function mineProductName(results: WebResult[], code: string): string | null {
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

  let best: { text: string; score: number } | null = null;
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
    if (!best || score > best.score) best = { text: c.text, score };
  }
  if (!best || best.score < 3) return null; // a lone short title with zero agreement is not evidence
  if (looksLikeTechnicalTitle(best.text)) return null; // never let page furniture win the vote
  return titleCase(best.text).slice(0, 80);
}

// The whole web stage: search the number, mine the name. Injected fetcher for
// tests. Returns a hit, 'miss' (the web answered: nothing usable) or 'error'
// (the web could not be searched at all — NOT evidence of absence).
export type FetchPage = (url: string, timeoutMs?: number) => Promise<PageResult>;

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

export async function webSearchBarcode(code: string, fetcher: FetchPage = fetchPage): Promise<BarcodeHit | 'miss' | 'error'> {
  // Quoted number: a bare long number can trip the calculator instant answer.
  const html = await tryEngine(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`"${code}"`)}`,
    parseDdgHtml,
    fetcher,
  );
  if (html.ok && html.blocked) return 'error';
  let results = html.ok ? html.results : [];
  if (!results.length) {
    // Second engine, different shape AND different query form — hedges both a
    // parse quirk and a query-syntax fluke before concluding anything.
    const lite = await tryEngine(
      `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(`${code} barcode`)}`,
      parseDdgLite,
      fetcher,
    );
    if (lite.ok && lite.blocked) return 'error';
    if (lite.ok) results = lite.results;
    else if (!html.ok) return 'error'; // both engines unreachable: no search happened
  }
  if (!results.length) return 'miss'; // searched; the web simply has nothing for this number
  const name = mineProductName(results, code);
  if (!name) return 'miss'; // pages exist for the number, but no name earned trust
  return { name, categoryHint: guessCategory(name), sourceLabel: 'Web search' };
}

export async function lookupBarcode(code: string): Promise<BarcodeOutcome> {
  const clean = code.trim();
  if (!/^\d{6,14}$/.test(clean)) return { kind: 'miss' };
  const answers = await Promise.all(SOURCES.map((s) => s.run(clean).catch((): SourceAnswer => 'error')));
  const hits = answers.filter((a): a is BarcodeHit => a !== 'miss' && a !== 'error');
  if (hits.length) {
    // Promise.all keeps the sources' order, so the first hit is the preferred
    // source's. Image and category fall back to any other hit that has them.
    const best = hits[0];
    const image = best.image ?? hits.find((h) => h.image)?.image;
    const categoryHint = best.categoryHint ?? hits.find((h) => h.categoryHint)?.categoryHint ?? null;
    return { kind: 'hit', hit: { ...best, image, categoryHint } };
  }
  // In the browser the Open*Facts family is everything that can answer; their
  // definite "no record" is the browser's honest whole answer.
  if (WEB) {
    const errored = answers.filter((a) => a === 'error').length;
    return errored === answers.length ? { kind: 'unreachable' } : { kind: 'miss' };
  }
  const errored = answers.filter((a) => a === 'error').length;
  if (errored === answers.length) {
    // Nobody answered at all (offline, total timeout): unknown, not absent —
    // and there is no honest way to search the web without connectivity.
    return { kind: 'unreachable' };
  }
  // At least one database gave a definite answer, so the network is up — the
  // TEXT web search gets its chance even when other databases were rate
  // limited (UPCitemdb's trial cap is per network per DAY; it must not lock
  // the whole identification pipeline out).
  const web = await webSearchBarcode(clean);
  if (web !== 'miss' && web !== 'error') return { kind: 'hit', hit: web };
  if (web === 'error') return { kind: 'unreachable' }; // search blocked: retry later, don't cache a lie
  if (errored === 0) return { kind: 'miss' }; // databases AND the web all said no: a definite, cacheable miss
  // Some database never got to speak (rate limit/timeout) while the web found
  // nothing: "unknown", so a later scan can still catch that database.
  return { kind: 'unreachable' };
}
