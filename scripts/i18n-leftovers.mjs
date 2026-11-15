// Lists English text the app still shows untranslated: string literals and
// template strings that read like text and are not inside tr(). For review.
// node scripts/i18n-leftovers.mjs [file-filter]
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[1], '../..');
const filter = process.argv[2] ?? '';
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name).replace(/\\/g, '/')]);
const files = ['App.tsx', ...walk('src')].filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\.ts$|i18n\.ts$|locales\//.test(f) && f.includes(filter));

const SKIP_PROPS = new Set(['key', 'id', 'testID', 'nativeID', 'icon', 'name', 'type', 'kind', 'category', 'tint', 'source', 'reason', 'mode', 'role',
  'accessibilityRole', 'pointerEvents', 'resizeMode', 'keyboardType', 'returnKeyType', 'autoCapitalize', 'autoComplete', 'textContentType', 'inputMode',
  'enterKeyHint', 'color', 'backgroundColor', 'fontWeight', 'position', 'alignItems', 'justifyContent', 'flexDirection', 'value']);
const looksLikeText = (s) => /[A-Za-z]{2}/.test(s) && (/\s/.test(s) || /^[A-Z][a-z]/.test(s)) && !/^(https?:|mailto:|prexpire[:.])/.test(s)
  && !/^[\w.-]+\.(png|jpg|webp|json|svg|ts|tsx)$/.test(s) && !/^(rgba?|#|[0-9])/.test(s) && !/^[a-z][\w-]*$/.test(s);
const inside = (n, names) => { for (let p = n.parent; p; p = p.parent) {
  if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && names.includes(p.expression.text)) return true;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true; } return false; };

let n = 0;
for (const rel of files) {
  const file = path.join(ROOT, rel);
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (node) => {
    let text = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    if (ts.isTemplateExpression(node)) text = node.head.text + node.templateSpans.map((s, i) => `{${i}}` + s.literal.text).join('');
    if (ts.isJsxText(node) && /[A-Za-z]{2}/.test(node.text)) text = node.text.trim();
    if (text != null && looksLikeText(text.replace(/\{\d+\}/g, 'x')) && !inside(node, ['tr', 'require', 'console', 'Error', 'log', 'warn'])) {
      const p = node.parent;
      const prop = ts.isPropertyAssignment(p) ? p.name.getText(src) : ts.isJsxAttribute(p) ? p.name.getText(src) : '';
      const isStyle = /style|Style/.test(prop) || (ts.isPropertyAssignment(p) && /^(font|margin|padding|border|text|letter|line|shadow|width|height)/.test(prop));
      if (!SKIP_PROPS.has(prop) && !isStyle && !(ts.isCaseClause(p)) && !(ts.isBinaryExpression(p) && /===|!==/.test(p.operatorToken.getText(src)))) {
        const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
        out.push(`  ${String(line).padStart(5)}  ${JSON.stringify(text).slice(0, 110)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  if (out.length) { console.log(`${rel} (${out.length})`); console.log(out.join('\n')); n += out.length; }
}
console.log(`\n${n} candidates`);
