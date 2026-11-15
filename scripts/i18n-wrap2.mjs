// Second pass: wraps the remaining visible text (any string or template that
// reads like text, wherever it is), except drawing code, matching strings,
// thrown developer errors and files that never show text. node scripts/i18n-wrap2.mjs [--dry]
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[1], '../..');
const DRY = process.argv.includes('--dry');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name).replace(/\\/g, '/')]);
const SKIP_FILES = /(\.test\.ts|i18n\.ts|locales\/|Art\.tsx|IconArt\.tsx|scanner\/(categoryGuess|dateParser|dateFormats|ocr|ocr\.web|productLookup|webSearchBarcode|barcode)\.tsx?|backup\.ts|widgetReport\.ts|stats\.ts|layout\.ts|density\.ts|theme\.tsx)$/;
const files = ['App.tsx', ...walk('src')].filter((f) => /\.(tsx|ts)$/.test(f) && !SKIP_FILES.test(f));

const SKIP_PROPS = new Set(['key', 'id', 'testID', 'nativeID', 'icon', 'name', 'type', 'kind', 'category', 'tint', 'source', 'reason', 'mode', 'role',
  'accessibilityRole', 'pointerEvents', 'resizeMode', 'keyboardType', 'returnKeyType', 'autoCapitalize', 'autoComplete', 'textContentType', 'inputMode',
  'enterKeyHint', 'color', 'backgroundColor', 'fontWeight', 'position', 'alignItems', 'justifyContent', 'flexDirection', 'transform', 'd', 'href', 'src', 'uri',
  'backdropFilter', 'WebkitBackdropFilter', 'backgroundImage', 'width', 'height', 'content', 'viewBox', 'fontFamily']);
const looksLikeText = (s) => /[A-Za-z]{2}/.test(s) && (/\s/.test(s) || /^[A-Z][a-z]/.test(s))
  && !/^(https?:|mailto:|prexpire[:.]|rotate\(|translate|scale\(|blur\(|calc\(|repeating|linear-|radial-|M[\d{ ]|rgba?\(|#)/.test(s)
  && !/^[\w.-]+\.(png|jpg|webp|json|svg|ts|tsx)$/.test(s) && !/^[a-z][\w-]*$/.test(s) && !/[{};]\s*$/.test(s) && !/:focus|\[role=|maximum-scale/.test(s)
  && !/^(Prexpire|prexpire)$/.test(s);
const lit = (s) => JSON.stringify(s);
const insideAny = (n, src) => {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isCallExpression(p)) {
      const c = p.expression;
      const name = ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : '';
      if (['tr', 'require', 'includes', 'startsWith', 'endsWith', 'test', 'match', 'replace', 'split', 'indexOf', 'getItem', 'setItem', 'removeItem', 'log', 'warn', 'error', 'info', 'debug', 'querySelector', 'addEventListener', 'dispatchEvent', 'postMessage', 'rpc', 'from', 'select', 'eq'].includes(name)) return true;
    }
    if (ts.isNewExpression(p) || ts.isThrowStatement(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isCaseClause(p) || ts.isTypeNode(p)) return true;
    if (ts.isBinaryExpression(p) && ['===', '!==', '==', '!='].includes(p.operatorToken.getText(src))) return true;
  }
  return false;
};

let total = 0;
for (const rel of files) {
  const file = path.join(ROOT, rel);
  const code = fs.readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  const visit = (node) => {
    let text = null, args = [];
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) {
      text = node.head.text + node.templateSpans.map((s, i) => `{${i}}` + s.literal.text).join('');
      args = node.templateSpans.map((s) => s.expression.getText(src));
    }
    if (text != null && looksLikeText(text.replace(/\{\d+\}/g, 'x')) && !insideAny(node, src)) {
      const p = node.parent;
      const prop = ts.isPropertyAssignment(p) ? p.name.getText(src).replace(/['"]/g, '') : ts.isJsxAttribute(p) ? p.name.getText(src) : ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) ? p.parent.name.getText(src) : '';
      const isStyle = /style|Style/.test(prop) || /^(font|margin|padding|border|text|letter|line|shadow|width|height|top|left|right|bottom|gap|flex)/.test(prop);
      const isKey = ts.isPropertyAssignment(p) && p.name === node; // a quoted object key
      if (!SKIP_PROPS.has(prop) && !isStyle && !isKey && !ts.isImportSpecifier(p) && !ts.isLiteralTypeNode(p)) {
        const inJsxAttr = ts.isJsxAttribute(p);
        const call = args.length ? `tr(${lit(text)}, [${args.join(', ')}])` : `tr(${lit(text)})`;
        edits.push([node.getStart(src), node.getEnd(), inJsxAttr ? `{${call}}` : call]);
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  if (!edits.length) continue;
  edits.sort((a, b) => b[0] - a[0]);
  let out = code;
  for (const [s, e, r] of edits) out = out.slice(0, s) + r + out.slice(e);
  if (!/import \{[^}]*\btr\b[^}]*\} from '[./]*i18n(\.ts)?'/.test(out)) {
    let relImport = path.relative(path.dirname(file), path.join(ROOT, 'src/i18n')).replace(/\\/g, '/');
    if (!relImport.startsWith('.')) relImport = './' + relImport;
    if (rel.endsWith('.ts')) relImport += '.ts';
    const imports = [...out.matchAll(/^import [\s\S]*?from '[^']+';\s*$/gm)];
    const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
    out = out.slice(0, at) + `\nimport { tr } from '${relImport}';` + out.slice(at);
  }
  total += edits.length;
  console.log(`${String(edits.length).padStart(4)}  ${rel}`);
  if (!DRY) fs.writeFileSync(file, out);
}
console.log(`${total} more texts wrapped${DRY ? ' (dry run)' : ''}`);
