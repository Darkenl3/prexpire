import { Platform } from 'react-native';
import { guessCategory } from './categoryGuess';
import { formatProductName, looksLikeTechnicalTitle } from './productGuess';
import { parseOpenLibrary } from './webSearchBarcode';

// Barcode → product lookup across the free, keyless PUBLIC barcode databases —
// no API keys, no accounts, no AI, just plain HTTPS GETs. One decoded barcode is
// queried in PARALLEL across every source, each under a short timeout, so the
// wall-clock cost stays one round trip no matter how many databases are asked.
// A product only has to exist in ONE of them to be identified, and they cover
// different worlds:
//
//   Open Food Facts       — food & drinks (curated names, category tags, photos)
//   Open Library          — books: ISBN-13 barcodes (978/979), ~30M records
//   Open Beauty Facts     — cosmetics & personal care
//   Open Pet Food Facts   — pet food
//   Open Products Facts   — everything else (household goods, hardware…)
//   UPCitemdb             — the big US retail catalogue (UPC-A/EAN, brand + title)
//
// In THE BROWSER only the CORS-enabled sources answer (the whole Open*Facts
// family and Open Library); the others send no CORS headers, so a page could
// never read their answers and they are not even asked.
//
// THE SEARCH STAGE IS NOT GONE — IT LIVES WHERE IT CAN ACTUALLY RUN. When
// every database answers "no record", a hardened text web search of the
// barcode number (DuckDuckGo titles/snippets/URLs, with an evidence gate:
// code-mention, directory-domain and corroboration rules) gets its chance —
// see ./webSearchBarcode.ts. The search endpoints send no CORS headers, so a
// browser page — this bundle, the WebView's file:// page — could never read
// their answers even if it asked: importing that stage here would be dead
// code. The NATIVE scanner (the Expo shell) has no CORS wall: its own
// barcodeLookup wires the very same stage (a byte-identical copy of the
// module) into the pipeline. The phone app therefore identifies barcodes as
// catalog → six databases → web search; THIS browser bundle runs catalog →
// the CORS-enabled databases, and honestly reports what it could not ask.
//
// Honesty rules, same discipline as the rest of the scanner:
//   • a code is only "not found" (miss) when EVERY source gave a definite
//     no-record answer — so a definite miss can be cached without lying;
//   • offline, timeouts and rate limits are 'unreachable', never a miss, so
//     a later online session still gets its chance;
//   • UPCitemdb items are only accepted when the item's OWN code matches the
//     scanned one — a "close" code is not evidence;
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
// with it (port of the previous inline Open Food Facts logic). The composed
// name goes through the SHARED formatter (dedup, dangling marketing tails,
// word-boundary cap) so every source produces the same style of name.
function composeName(brand: string, productName: string): string {
  const composed =
    brand && productName && productName.toLowerCase().startsWith(brand.toLowerCase())
      ? productName
      : [brand, productName].filter(Boolean).join(' ');
  return formatProductName(composed);
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

// --- Open Library (books; ISBN-13 barcodes start 978/979) ---
// A real, keyless catalogue of ~30M books that DOES send CORS headers, so it
// answers in the browser too. The honest answer for the barcode family the
// food/retail databases barely touch — far better than letting "ISBN search"
// furniture pages near the name (parseOpenLibrary in webSearchBarcode.ts is
// the tested parser; this side owns the fetch and the honesty rules).

async function openLibraryLookup(code: string): Promise<SourceAnswer> {
  if (!/^97[89]\d{10}$/.test(code)) return 'miss'; // not an ISBN-13: no record HERE
  const res = await fetchJson(`https://openlibrary.org/isbn/${encodeURIComponent(code)}.json?jscmd=data`);
  if (!res.net) return 'error';
  const hit = parseOpenLibrary(res.json);
  if (!hit) return 'miss'; // includes the {"error":"notfound"} 404 body: no record
  return { name: hit.name, image: hit.image, categoryHint: guessCategory(`${hit.name} book`), sourceLabel: 'Open Library' };
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
// tags) beats the retail catalogue's longer titles; Open Library names the
// book family authoritatively; UPCitemdb then carries the US/UPC products the
// open databases don't have, and the niche databases cover cosmetics, pet
// food and household goods.
const SOURCES: { run: (code: string) => Promise<SourceAnswer> }[] = [
  { run: (c) => openFactsLookup('world.openfoodfacts.org', 'Open Food Facts', c) },
  { run: openLibraryLookup },
  ...(WEB ? [] : [{ run: upcItemDbLookup }]),
  { run: (c) => openFactsLookup('world.openbeautyfacts.org', 'Open Beauty Facts', c) },
  { run: (c) => openFactsLookup('world.openpetfoodfacts.org', 'Open Pet Food Facts', c) },
  { run: (c) => openFactsLookup('world.openproductsfacts.org', 'Open Products Facts', c) },
];

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
  const errored = answers.filter((a) => a === 'error').length;
  // Nobody answered at all (offline, total timeout): unknown, not absent —
  // a later online scan still gets its chance.
  if (errored === answers.length) return { kind: 'unreachable' };
  // At least one database answered, and every definite answer said "no
  // record". When they ALL answered, that is a definite, cacheable miss; when
  // some were rate-limited or timed out, the code stays "unknown" so a later
  // scan can still hear from the source that never got to speak.
  return errored === 0 ? { kind: 'miss' } : { kind: 'unreachable' };
}
