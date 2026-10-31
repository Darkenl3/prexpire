#!/usr/bin/env node
// Builds Prexpire's OFFLINE-FIRST bundle: the entire web export inlined into
// ONE self-contained HTML file (the app JS, the Ionicons font and the two
// brand images become data URIs; nothing is fetched to boot the app).
//
//   dist/ (expo export --platform web)  ──▶  public/offline.html
//                                             └─▶ deployed at https://prexpire.vercel.app/offline.html
//
// The same file becomes the shell's bundled baseline (a generated TypeScript
// string module), so the native app opens with ZERO network dependency: the
// WebView always loads local content, and the shell can later download a
// fresher offline.html from the site in the background.
//
// Inputs to the bundle:
//   dist/index.html            the export's shell page (one <script src> tag)
//   dist/_expo/static/js/web/  the single app bundle (no code splitting)
//   dist/assets/...            Ionicons.ttf (inlined) + brand art (inlined,
//                              resized when large; the app only ever shows it
//                              ~420 css px wide)
// The other 19 icon-font URLs in the bundle stay remote on purpose: only
// Ionicons ever renders in this app, so the unused families are never fetched
// — keeping them inline would bloat the bundle by megabytes for nothing.
//
// Run after every `expo export --platform web` (vercel.json chains it):
//   node scripts/build-offline-html.mjs [--shell-out path/to/appHtml.ts]...
// Each --shell-out writes an ES module exporting OFFLINE_APP_HTML +
// OFFLINE_APP_VERSION. Default targets: the delivery shell + its flat mirror.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const indexHtml = readFileSync(path.join(dist, 'index.html'), 'utf8');

// The export's single bundle script tag.
const tag = indexHtml.match(/<script[^>]*\ssrc="([^"]+)"[^>]*>\s*<\/script>/);
if (!tag) throw new Error('build-offline-html: no <script src> found in dist/index.html');
const bundleUrl = tag[1];
const jsPath = path.join(dist, bundleUrl.replace(/^\//, ''));
const rawJs = readFileSync(jsPath, 'utf8');

// Every /assets/... URL the bundle references at runtime. Each becomes a data
// URI when it is one of the assets the app actually needs offline.
const assetUrls = [...new Set([...rawJs.matchAll(/['"](\/assets\/[^'"]+)['"]/g)].map((m) => m[1]))];

// Resize a PNG with PIL (only present in the build sandbox; when unavailable
// the original is inlined — bigger but equally correct).
function resizePng(file, width) {
  const script = [
    'from PIL import Image',
    'import sys, io',
    `im = Image.open(${JSON.stringify(file)})`,
    `w = ${width}`,
    'h = max(1, round(im.height * w / im.width))',
    'im = im.convert("RGBA").resize((w, h), Image.LANCZOS)',
    'b = io.BytesIO()',
    "im.save(b, 'PNG', optimize=True)",
    'sys.stdout.buffer.write(b.getvalue())',
  ].join('\n');
  return execFileSync('python3', ['-c', script], { maxBuffer: 128 * 1024 * 1024 });
}

let js = rawJs;
let inlined = [];
for (const url of assetUrls) {
  const file = path.join(dist, url.slice(1));
  if (!existsSync(file)) continue; // stays a remote URL (never fetched in-app)
  const isTtf = file.endsWith('.ttf');
  const isPng = file.endsWith('.png');
  if (!isTtf && !isPng) continue; // unknown asset kind: leave the URL untouched
  // Only the assets the app really uses go in: the Ionicons font (the only
  // icon family that renders) and the two brand images. The other 19 font
  // families stay as remote URLs — they are never requested.
  const isIonicons = /Ionicons\.[0-9a-f]+\.ttf$/.test(file);
  const isBrand = /\/assets\/assets\/brand-(ink|white)\.[0-9a-f]+\.png$/.test(url);
  if (!isIonicons && !isBrand) continue;
  let buf = readFileSync(file);
  if (isPng && buf.length > 150_000) {
    try {
      buf = resizePng(file, 800); // displayed ≤ ~420 css px; 800px is 2x retina
    } catch {
      // PIL unavailable: inline the original.
    }
  }
  const mime = isTtf ? 'font/ttf' : 'image/png';
  const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
  const before = js;
  js = js.split(`'${url}'`).join(`'${dataUri}'`).split(`"${url}"`).join(`"${dataUri}"`);
  if (js !== before) inlined.push(path.basename(url));
}
if (!inlined.some((n) => n.startsWith('Ionicons.'))) {
  throw new Error('build-offline-html: the Ionicons font was not inlined — the offline bundle would render no icons');
}

// The version stamp: content hash of the ORIGINAL bundle + build date. The
// shell reads this marker to validate downloads and compare versions.
const version = `v${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${createHash('sha1').update(rawJs).digest('hex').slice(0, 10)}`;

// Assemble the single file. Function replacers everywhere: the bundle text
// must never flow through replacement patterns ($& and friends would corrupt
// it). The inlined script drops `defer` — it only ever mattered for external
// scripts; an inline script at the end of <body> runs after #root exists.
const html =
  indexHtml
    .replace(tag[0], () => `<script>\n${js}\n</script>`)
    .replace('<head>', () => `<head>\n    <meta name="prexpire-offline" content="${version}">`) + '\n';

// Sanity: the assembled file must be self-contained for the assets we inline.
for (const url of assetUrls) {
  const isBrand = /\/assets\/assets\/brand-(ink|white)\.[0-9a-f]+\.png$/.test(url);
  const isIonicons = /Ionicons\.[0-9a-f]+\.ttf$/.test(url);
  if (!isBrand && !isIonicons) continue;
  if (js.includes(`'${url}'`) || js.includes(`"${url}"`)) {
    throw new Error(`build-offline-html: ${url} survived the inlining`);
  }
}

const outSite = path.join(root, 'public', 'offline.html');
const outDist = path.join(dist, 'offline.html');
writeFileSync(outSite, html);
// Vercel serves dist/ (the export output), and `expo export` has already
// copied public/ into it by the time this runs — so the deployable copy is
// written into dist/ directly.
writeFileSync(outDist, html);

// The generated shell module: the whole file as ONE string constant.
const tsModule = `// GENERATED FILE — written by prexpire/scripts/build-offline-html.mjs.
// Do not edit by hand; regenerate with:
//   bun run export:web && node scripts/build-offline-html.mjs
//
// This is the app's full web export inlined into a single self-contained HTML
// string (app JS + Ionicons font + brand art as data URIs). The shell writes
// it to the filesystem on first launch and ALWAYS loads the app from that
// local file, so Prexpire opens instantly with no network at all; online
// features (barcode lookups) simply work when connectivity exists.
export const OFFLINE_APP_VERSION = ${JSON.stringify(version)};
export const OFFLINE_APP_HTML = ${JSON.stringify(html)};
`;

const defaultTargets = [
  '/home/z/my-project/download/expo-shell-updated/src/offline/appHtml.ts',
];
const args = process.argv.slice(2);
const targets = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--shell-out' && args[i + 1]) targets.push(args[++i]);
}
const all = targets.length ? targets : defaultTargets;
const written = [];
for (const t of all) {
  // Skip targets whose folder does not exist (e.g. the sandbox shell delivery
  // paths are absent on Vercel's builder) — the site bundle is still written.
  if (!existsSync(path.dirname(t))) continue;
  writeFileSync(t, tsModule);
  written.push(t);
}

const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`offline bundle ${version}`);
console.log(`  app bundle      ${kb(rawJs.length)} (${path.basename(jsPath)})`);
console.log(`  inlined assets  ${inlined.join(', ')}`);
console.log(`  offline.html    ${kb(html.length)} -> ${path.relative(root, outSite)}`);
for (const t of written) console.log(`  shell module    ${kb(tsModule.length)} -> ${path.relative(root, t)}`);
