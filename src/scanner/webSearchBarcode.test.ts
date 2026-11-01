import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDdgHtml,
  parseDdgLite,
  cleanWebCandidate,
  resultMentionsCode,
  mineProductName,
  webSearchBarcode,
  parseOpenLibrary,
  type WebResult,
  type FetchPage,
} from './webSearchBarcode.ts';

// Regression suite for the web-search identification stage, built from the
// four real scans that motivated the evidence gate:
//   • a medicine bottle whose barcode search surfaced an unrelated food name
//     ("Quaker Chewy Granola Bars") on a lone UPC-directory page;
//   • medicine-box searches that surfaced lookup-site landing pages
//     ("ISBN Lookup Find Any Book By ISBN", "Search Barcodestock",
//     "Lookup & ISBN Search") as "product names";
//   • and the honest paths that must keep working: a single retailer page
//     that ties itself to the exact code, and two sites independently
//     agreeing on the same name.

const CODE = '3838989614249'; // the KRKA medicine box EAN from the scans

// A DuckDuckGo html page with one result, as the engine really serves it:
// the title anchor wraps its redirect (uddg=…), the snippet rides separately.
const ddgHtml = (results: { href: string; title: string; snippet: string }[]): string =>
  results
    .map(
      (r) =>
        `<a rel="nofollow" class="result__a" href="${r.href}">${r.title}</a>` +
        `<a class="result__snippet" href="${r.href}">${r.snippet}</a>`,
    )
    .join('\n');

const ddgLite = (results: { href: string; title: string; snippet: string }[]): string =>
  results
    .map(
      (r) =>
        `<a rel="nofollow" href="${r.href}">${r.title}</a>` +
        `<td class="result-snippet">${r.snippet}</td>`,
    )
    .join('\n');

// URL-encode a target the way DuckDuckGo's redirector does.
const uddg = (target: string): string =>
  `//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}&amp;rut=ch`;

const r = (title: string, snippet: string, url: string): WebResult => ({ title, snippet, url });

// ─── Parsing: titles, snippets AND target URLs ──────────────────────────────

test('parseDdgHtml reads title, snippet and unwraps the uddg redirect target', () => {
  const html = ddgHtml([
    {
      href: uddg('https://www.walmart.com/ip/3800012345678/aveeno-lotion'),
      title: 'AVEENO Daily <b>Moisturizing</b> Lotion 18 fl oz - Walmart.com',
      snippet: 'Buy AVEENO Daily Moisturizing Lotion at <b>Walmart.com</b>',
    },
  ]);
  const results = parseDdgHtml(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'AVEENO Daily Moisturizing Lotion 18 fl oz - Walmart.com');
  assert.equal(results[0].snippet, 'Buy AVEENO Daily Moisturizing Lotion at Walmart.com');
  assert.equal(results[0].url, 'https://www.walmart.com/ip/3800012345678/aveeno-lotion');
});

test('parseDdgLite reads direct hrefs', () => {
  const html = ddgLite([
    {
      href: 'https://www.amazon.de/Ritter-Sport-Marzipan/dp/B07XY',
      title: 'Ritter Sport Marzipan 100g - Amazon.de',
      snippet: 'Ritter Sport Marzipan, 100 g',
    },
  ]);
  const results = parseDdgLite(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Ritter Sport Marzipan 100g - Amazon.de');
  assert.equal(results[0].url, 'https://www.amazon.de/Ritter-Sport-Marzipan/dp/B07XY');
});

// ─── The code-mention evidence signal ───────────────────────────────────────

test('a result mentions the code when it is printed with spacing or dashed', () => {
  // EANs print as digit groups: "3 838989 614249".
  assert.ok(resultMentionsCode(r('Best before', '3 838989 614249 Krka', ''), CODE));
  assert.ok(resultMentionsCode(r('3-838989-614249', '', ''), CODE));
  assert.ok(resultMentionsCode(r('Exp', '', 'https://x.com/upc/3838989614249'), CODE));
  // A zero-padded EAN twin of a scanned 12-digit UPC counts.
  assert.ok(resultMentionsCode(r('t', '0123456789012', ''), '123456789012'));
  // …and the bare UPC form of a zero-padded EAN counts too.
  assert.ok(resultMentionsCode(r('t', '123456789012', ''), '0123456789012'));
  // Different digits — even one off — are not this code. (A differently
  // GROUPED print of the same digits still is: separators sit between the
  // same digit sequence either way.)
  assert.equal(resultMentionsCode(r('t', '3838989614248', ''), CODE), false);
  assert.equal(resultMentionsCode(r('t', 'completely unrelated', ''), CODE), false);
});

// ─── The evidence gate: the three lying scans ───────────────────────────────

test('a lone UPC-directory page never names the product (the Quaker lie)', () => {
  // barcodestock's page FOR the code, carrying a food name for a medicine:
  // however clean the name, an uncorroborated directory is not evidence.
  const results = [
    r(
      'Quaker Chewy Granola Bars Chocolate Chip 8ct - Barcodestock',
      'Quaker Chewy Granola Bars, UPC 3838989614249 chocolate chip',
      'https://www.barcodestock.com/upc/3838989614249',
    ),
  ];
  assert.equal(mineProductName(results, CODE), null);
});

test('lookup-site landing pages are furniture, never names', () => {
  const results = [
    r('ISBN Lookup Find Any Book By ISBN', 'Search any book by ISBN', 'https://isbnsearch.org/'),
    r('Search Barcodestock', '', 'https://www.barcodestock.com/search?q=3838989614249'),
    r('Lookup &amp; ISBN Search', 'upc 3838989614249 lookup', 'https://www.lookupandisbnsearch.net/'),
  ];
  assert.equal(mineProductName(results, CODE), null);
});

test('a lone non-directory page with no tie to the code is not evidence', () => {
  const results = [
    r('Delicious Granola Bars Review', 'our favourite chewy bars this spring', 'https://www.someblog.com/food-review'),
  ];
  assert.equal(mineProductName(results, CODE), null);
});

// ─── The honest identification paths ────────────────────────────────────────

test('one retailer page that carries the code in its URL identifies the product', () => {
  const results = [
    r(
      'AVEENO Daily Moisturizing Lotion 18 fl oz - Walmart.com',
      'Buy AVEENO Daily Moisturizing Lotion 18 fl oz at Walmart.com',
      'https://www.walmart.com/ip/3800012345678/aveeno-daily',
    ),
  ];
  assert.equal(mineProductName(results, '3800012345678'), 'AVEENO Daily Moisturizing Lotion');
});

test('two distinct sites agreeing identify the product without a visible code', () => {
  // The engines rank both pages for the quoted number even though neither
  // snippet prints it: independent agreement is the evidence.
  const results = [
    r('Ritter Sport Marzipan 100g - Amazon.de', 'Ritter Sport Marzipan, 100 g', 'https://www.amazon.de/Ritter-Sport-Marzipan/dp/B07XY'),
    r('Ritter Sport Marzipan Chocolate 3.5 oz - Instacart', 'Ritter Sport Marzipan delivered', 'https://www.instacart.com/store/ritter-sport'),
  ];
  assert.equal(mineProductName(results, '4000417025003'), 'Ritter Sport Marzipan Chocolate');
});

test('a directory page may corroborate a name a shop also carries', () => {
  // The real fix for the medicine-box scan: barcodestock's per-code record
  // AND an independent pharmacy page agree on the actual product name.
  const results = [
    r('Aboca NeoBianacid 45 Cpr - Barcodestock', 'UPC 3838989614249 NeoBianacid', 'https://www.barcodestock.com/upc/3838989614249'),
    r('Aboca NeoBianacid 45 Compresse', 'integratore per la gola', 'https://www.farmacialoreto.it/prodotti/neobianacid-45'),
  ];
  assert.equal(mineProductName(results, CODE), 'Aboca NeoBianacid 45 Compresse');
});

test('two directory catalogues agreeing on a per-code record identify it', () => {
  const results = [
    r('Chobani Blueberry Greek Yogurt', 'upc 884365200012', 'https://www.barcodestock.com/upc/884365200012'),
    r('Chobani Blueberry Greek Yogurt 5.3 oz', 'ean 0884365200012', 'https://go-upc.com/upc/884365200012'),
  ];
  assert.equal(mineProductName(results, '884365200012'), 'Chobani Blueberry Greek Yogurt');
});

test('an ALL-CAPS scrape is title-cased, printed case is kept verbatim', () => {
  const allCaps = [
    r('QUAKER CHEWY GRANOLA BARS - Walmart.com', 'QUAKER CHEWY at Walmart', 'https://www.walmart.com/ip/3028490000000/quaker'),
  ];
  assert.equal(mineProductName(allCaps, '3028490000000'), 'Quaker Chewy Granola Bars');
});

// ─── Candidate cleaning sanity (unchanged discipline) ────────────────────────

test('cleanWebCandidate keeps stripping tails, jargon and sizes', () => {
  assert.equal(cleanWebCandidate('Quaker Chewy Granola Bars - Walmart.com', CODE), 'Quaker Chewy Granola Bars');
  assert.equal(cleanWebCandidate('Ritter Sport Marzipan 100g - Amazon.de', CODE), 'Ritter Sport Marzipan');
  assert.equal(cleanWebCandidate('UPC 3838989614249 Lookup', CODE), null);
  assert.equal(cleanWebCandidate('$3.99 special offer in stock', CODE), null);
});

// ─── The full stage with an injected fetcher ─────────────────────────────────

const fetcherFor = (pages: Record<string, string | { net: false }>): FetchPage => {
  return async (url: string) => {
    for (const [needle, page] of Object.entries(pages)) {
      if (url.includes(needle)) {
        return typeof page === 'string' ? { net: true, status: 200, text: page } : { net: false };
      }
    }
    return { net: false };
  };
};

test('webSearchBarcode: offline engines are an error, never a miss', async () => {
  const outcome = await webSearchBarcode(CODE, async () => ({ net: false }));
  assert.equal(outcome, 'error');
});

test('webSearchBarcode: a bot-challenge interstitial is an error, never a miss', async () => {
  const blocked = fetcherFor({ 'html.duckduckgo': '<html><body class="anomaly">unfortunately, bots…</body></html>' });
  assert.equal(await webSearchBarcode(CODE, blocked), 'error');
});

test('webSearchBarcode: the Quaker-lie page yields the honest miss', async () => {
  const quaker = fetcherFor({
    'html.duckduckgo': ddgHtml([
      {
        href: uddg('https://www.barcodestock.com/upc/3838989614249'),
        title: 'Quaker Chewy Granola Bars Chocolate Chip 8ct - Barcodestock',
        snippet: 'Quaker Chewy Granola Bars UPC 3838989614249',
      },
    ]),
  });
  assert.equal(await webSearchBarcode(CODE, quaker), 'miss');
});

test('webSearchBarcode: a per-code retailer page identifies the product', async () => {
  const aveeno = fetcherFor({
    'html.duckduckgo': ddgHtml([
      {
        href: uddg('https://www.walmart.com/ip/3800012345678/aveeno-daily'),
        title: 'AVEENO Daily Moisturizing Lotion 18 fl oz - Walmart.com',
        snippet: 'Buy AVEENO Daily Moisturizing Lotion at Walmart.com',
      },
    ]),
  });
  const outcome = await webSearchBarcode('3800012345678', aveeno);
  assert.ok(outcome !== 'miss' && outcome !== 'error');
  assert.equal((outcome as { name: string }).name, 'AVEENO Daily Moisturizing Lotion');
  assert.equal((outcome as { categoryHint: string | null }).categoryHint, 'skincare');
});

test('webSearchBarcode: lite corroborates html on a second attempt', async () => {
  // html returns one weak-but-real listing; lite's independent page agrees —
  // the combined mining earns the name.
  const twoEngines = fetcherFor({
    'html.duckduckgo': ddgHtml([
      {
        href: uddg('https://www.barcodestock.com/upc/884365200012'),
        title: 'Chobani Blueberry Greek Yogurt',
        snippet: 'upc 884365200012 chobani',
      },
    ]),
    'lite.duckduckgo': ddgLite([
      {
        href: 'https://go-upc.com/upc/884365200012',
        title: 'Chobani Blueberry Greek Yogurt 5.3 oz',
        snippet: 'ean 0884365200012',
      },
    ]),
  });
  const outcome = await webSearchBarcode('884365200012', twoEngines);
  assert.ok(outcome !== 'miss' && outcome !== 'error');
  assert.equal((outcome as { name: string }).name, 'Chobani Blueberry Greek Yogurt');
});

// ─── Open Library: the book database parser ─────────────────────────────────

test('parseOpenLibrary turns a book record into an author-titled name', () => {
  const hit = parseOpenLibrary({
    title: 'The Hobbit',
    authors: [{ name: 'J.R.R. Tolkien' }],
    cover: { medium: 'https://covers.openlibrary.org/b/id/6932863-M.jpg' },
  });
  assert.ok(hit);
  assert.equal(hit.name, 'The Hobbit - J.R.R. Tolkien');
  assert.equal(hit.image, 'https://covers.openlibrary.org/b/id/6932863-M.jpg');
});

test('parseOpenLibrary: a record without authors is the bare title; notfound is null', () => {
  assert.deepEqual(parseOpenLibrary({ title: 'Some Almanac' }), { name: 'Some Almanac', image: undefined });
  assert.equal(parseOpenLibrary({ error: 'notfound' }), null);
  assert.equal(parseOpenLibrary(null), null);
});
