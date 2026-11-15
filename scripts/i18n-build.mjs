// Builds src/locales/<lang>.ts from scripts/tr-<lang>/*.json (English text ->
// translation; keyed by text so new or moved texts never shift the others).
// Reports texts with no translation yet and checks that every placeholder in
// the English text is kept. node scripts/i18n-build.mjs ro
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[1], '../..');
const lang = process.argv[2];
const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/locales/strings.json'), 'utf8'));
const dir = path.join(ROOT, 'scripts', `tr-${lang}`);
const parts = Object.assign({}, ...fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
const out = {};
const problems = [];
for (const x of list) {
  const v = parts[x.text];
  if (v == null) { problems.push(`missing: ${x.text}`); continue; }
  const need = (x.text.match(/\{\w+\}/g) ?? []).sort().join();
  const have = (v.match(/\{\w+\}/g) ?? []).sort().join();
  if (need !== have) problems.push(`placeholders differ: ${x.text} -> ${v}`);
  out[x.text] = v;
}
const unused = Object.keys(parts).filter((k) => !list.some((x) => x.text === k));
const body = Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
fs.writeFileSync(path.join(ROOT, 'src/locales', `${lang}.ts`), `// ${lang}: built by scripts/i18n-build.mjs from scripts/tr-${lang}/. Keys are the app's English text.\nconst table: Record<string, string> = {\n${body}\n};\nexport default table;\n`);
console.log(`${lang}: ${Object.keys(out).length}/${list.length}${unused.length ? ` (${unused.length} no longer used)` : ''}`);
if (problems.length) { console.log(problems.join('\n')); process.exitCode = 1; }
