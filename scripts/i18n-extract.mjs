// Collects every tr('…') text in the app into src/locales/strings.json (the
// list translators work from) and reports, for each translation file, how
// many texts are still missing. node scripts/i18n-extract.mjs
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[1], '../..');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name).replace(/\\/g, '/')]);
const files = ['App.tsx', ...walk('src')].filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\.ts$|locales\//.test(f));

const keys = new Map(); // text -> first place it appears
for (const rel of files) {
  const src = ts.createSourceFile(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8'), ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'tr' && n.arguments[0] && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))) {
      const k = n.arguments[0].text;
      if (!keys.has(k)) keys.set(k, `${rel}:${src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
}
// Language names shown in the picker (src/i18n.ts LANGUAGES[].english).
for (const m of fs.readFileSync(path.join(ROOT, 'src/i18n.ts'), 'utf8').matchAll(/english: '([^']+)'/g)) if (!keys.has(m[1])) keys.set(m[1], 'src/i18n.ts');

const list = [...keys.entries()].map(([text, where]) => ({ text, where }));
fs.writeFileSync(path.join(ROOT, 'src/locales/strings.json'), JSON.stringify(list, null, 1));
console.log(`${list.length} texts -> src/locales/strings.json (${list.reduce((a, b) => a + b.text.length, 0)} characters)`);

for (const f of fs.readdirSync(path.join(ROOT, 'src/locales')).filter((f) => /^[a-z]{2}(-[A-Za-z]+)?\.ts$/.test(f))) {
  const txt = fs.readFileSync(path.join(ROOT, 'src/locales', f), 'utf8');
  const have = new Set([...txt.matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*:/gm)].map((m) => JSON.parse(m[1])));
  const missing = list.filter((x) => !have.has(x.text));
  console.log(`${f}: ${list.length - missing.length}/${list.length} translated${missing.length ? `, ${missing.length} missing` : ''}`);
}
