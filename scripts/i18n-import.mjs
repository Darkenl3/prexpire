// Turns a translator's numbered list into scripts/tr-<lang>/all.json.
// The list has one text per line, "N|translation" (or a tab), where N is the text's
// position in src/locales/strings.json (as of writing; keys end up as the
// English text, so later reordering never matters). "\n" in a line stands
// for a line break. Several files may be given, e.g. a first and second half.
// node scripts/i18n-import.mjs de part1.txt part2.txt
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[1], '../..');
const [lang, ...files] = process.argv.slice(2);
const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/locales/strings.json'), 'utf8'));
const out = {};
let lines = 0;
for (const f of files) {
  for (const raw of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const m = raw.match(/^(\d+)[\t|](.*)$/);
    if (!m) throw new Error(`Bad line in ${f}: ${raw.slice(0, 60)}`);
    const i = Number(m[1]);
    if (!list[i]) throw new Error(`No text #${i}`);
    out[list[i].text] = m[2].replace(/\\n/g, '\n');
    lines += 1;
  }
}
const dir = path.join(ROOT, 'scripts', `tr-${lang}`);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'all.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`${lang}: ${lines} lines -> scripts/tr-${lang}/all.json`);
