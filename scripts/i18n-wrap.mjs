// One-off codemod: wraps the app's visible English text in t() so it can be
// translated (src/i18n.ts). Handles JSX text, text props (title, label,
// description, accessibilityLabel…), the same names in object literals, and
// the arguments of toast/error setters. Template strings become placeholders:
// `Added ${name}` -> t('Added {0}', [name]). Idempotent: text already inside
// t() is left alone. node scripts/i18n-wrap.mjs [--dry]
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[1], '../..');
const DRY = process.argv.includes('--dry');
const FILES = [
  'App.tsx',
  ...walk('src').filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\.ts$/.test(f) && !/i18n\.ts$/.test(f)),
].filter((f) => !/scanner\/(dateParser|dateFormats|categoryGuess|productName|ocr|barcode)/.test(f));

const ATTRS = new Set(['title', 'label', 'description', 'placeholder', 'accessibilityLabel', 'accessibilityHint', 'aria-label', 'sub', 'subtitle', 'hint',
  'message', 'text', 'cta', 'heading', 'caption', 'note', 'confirmLabel', 'cancelLabel', 'secondaryLabel', 'primaryLabel', 'actionLabel', 'buttonLabel',
  'emptyTitle', 'emptyText', 'emptyBody', 'body', 'lede', 'detail', 'badge', 'question', 'prompt', 'errorText', 'helper', 'okLabel', 'doneLabel']);
const PROPS = new Set([...ATTRS, 'error', 'name_display', 'short', 'long', 'explain', 'why', 'tip']);
const CALLS = new Set(['onToast', 'setError', 'setMsg', 'setMessage', 'setNote', 'showToast', 'toast', 'setToast', 'setStatus', 'setNotice', 'announce',
  'announceForAccessibility', 'alert', 'setHint', 'setInfo', 'setWarning', 'flash', 'notify', 'setBanner', 'say']);

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name).replace(/\\/g, '/')],
  );
}

// Text a person reads: has a letter, and is a sentence or a capitalised word
// (not an identifier, a key, a URL, a colour or a style value).
function looksLikeText(s) {
  if (!/[A-Za-z]/.test(s)) return false;
  if (/^(https?:|mailto:|prexpire:|#|\.|\/)/.test(s) || /@\w/.test(s) || /^[\w-]+\.(png|jpg|webp|json|svg)$/.test(s)) return false;
  if (/^[a-z][\w-]*$/.test(s)) return false; // one lowercase word: an id
  if (/^[A-Z_]+$/.test(s)) return false; // CONSTANT
  if (/^[a-z]+[A-Z]\w*$/.test(s)) return false; // camelCase
  return /\s/.test(s) || /^[A-Z][a-z]/.test(s) || /[.!?…]$/.test(s);
}

const lit = (s) => JSON.stringify(s);

function wrapExpr(node, src) {
  // Returns replacement text for a UI expression, or null to leave it.
  if (ts.isParenthesizedExpression(node)) {
    const inner = wrapExpr(node.expression, src);
    return inner == null ? null : `(${inner})`;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return looksLikeText(node.text) ? `tr(${lit(node.text)})` : null;
  }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    const args = [];
    node.templateSpans.forEach((sp, i) => {
      text += `{${i}}` + sp.literal.text;
      args.push(sp.expression.getText(src));
    });
    if (!looksLikeText(text.replace(/\{\d+\}/g, ''))) return null;
    return `tr(${lit(text)}, [${args.join(', ')}])`;
  }
  if (ts.isConditionalExpression(node)) {
    const a = wrapExpr(node.whenTrue, src), b = wrapExpr(node.whenFalse, src);
    if (a == null && b == null) return null;
    return `${node.condition.getText(src)} ? ${a ?? node.whenTrue.getText(src)} : ${b ?? node.whenFalse.getText(src)}`;
  }
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) {
    const r = wrapExpr(node.right, src);
    const l = node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? null : wrapExpr(node.left, src);
    if (r == null && l == null) return null;
    return `${l ?? node.left.getText(src)} ${node.operatorToken.getText(src)} ${r ?? node.right.getText(src)}`;
  }
  return null;
}

function isInsideT(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === 'tr') return true;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
  }
  return false;
}

// JSX text as React renders it: lines trimmed, joined with one space.
function jsxValue(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 1) return raw;
  return lines
    .map((l, i) => (i === 0 ? l.replace(/\s+$/, '') : i === lines.length - 1 ? l.replace(/^\s+/, '') : l.trim()))
    .filter((l) => l.length)
    .join(' ');
}

let total = 0;
const report = [];
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  const code = fs.readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  const visit = (node) => {
    if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text) && !isInsideT(node)) {
      const value = jsxValue(node.text);
      const trimmed = value.trim();
      if (trimmed && looksLikeText(trimmed) || /[A-Za-z]{2,}/.test(trimmed)) {
        const lead = /^[ \t]+\S/.test(value) && !/\n/.test(node.text.slice(0, node.text.search(/\S/))) ? "{' '}" : '';
        const tailWs = node.text.slice(node.text.search(/\s*$/));
        const trail = /^[ \t]+$/.test(tailWs) ? "{' '}" : '';
        edits.push([node.getStart(src), node.getEnd(), `${lead}{tr(${lit(trimmed)})}${trail}`]);
        return;
      }
    }
    if (ts.isJsxAttribute(node) && node.initializer && ATTRS.has(node.name.getText(src))) {
      const init = node.initializer;
      if (ts.isStringLiteral(init) && looksLikeText(init.text)) {
        edits.push([init.getStart(src), init.getEnd(), `{tr(${lit(init.text)})}`]);
        return;
      }
      if (ts.isJsxExpression(init) && init.expression && !isInsideT(init.expression)) {
        const r = wrapExpr(init.expression, src);
        if (r != null) { edits.push([init.expression.getStart(src), init.expression.getEnd(), r]); return; }
      }
    }
    if (ts.isJsxExpression(node) && node.expression && ts.isJsxElement(node.parent) | ts.isJsxFragment(node.parent) && !isInsideT(node.expression)) {
      const e = node.expression;
      if (ts.isStringLiteral(e) || ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isConditionalExpression(e) || ts.isBinaryExpression(e)) {
        const r = wrapExpr(e, src);
        if (r != null) { edits.push([e.getStart(src), e.getEnd(), r]); return; }
      }
    }
    if (ts.isPropertyAssignment(node) && PROPS.has(node.name.getText(src).replace(/['"]/g, '')) && !isInsideT(node.initializer)) {
      const r = wrapExpr(node.initializer, src);
      if (r != null) { edits.push([node.initializer.getStart(src), node.initializer.getEnd(), r]); return; }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      if (CALLS.has(name)) {
        for (const arg of node.arguments) {
          if (isInsideT(arg)) continue;
          const r = wrapExpr(arg, src);
          if (r != null) edits.push([arg.getStart(src), arg.getEnd(), r]);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  if (!edits.length) continue;
  edits.sort((a, b) => b[0] - a[0]);
  let out = code;
  for (const [s, e, r] of edits) out = out.slice(0, s) + r + out.slice(e);
  if (!/import \{[^}]*\bt\b[^}]*\} from '[./]*i18n'/.test(out)) {
    let relImport = path.relative(path.dirname(file), path.join(ROOT, 'src/i18n')).replace(/\\/g, '/');
    if (!relImport.startsWith('.')) relImport = './' + relImport;
    const imports = [...out.matchAll(/^import [\s\S]*?from '[^']+';\s*$/gm)];
    const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
    out = out.slice(0, at) + `\nimport { tr } from '${relImport}';` + out.slice(at);
  }
  total += edits.length;
  report.push(`${String(edits.length).padStart(4)}  ${rel}`);
  if (!DRY) fs.writeFileSync(file, out);
}
console.log(report.join('\n'));
console.log(`${total} texts wrapped${DRY ? ' (dry run)' : ''}`);
