// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byCategory, byMonth, tally, usedInTime } from './stats.ts';
import { buildBackup, parseBackup } from './backup.ts';
import { warningFor, openDaysFor, sanitizeSettings, defaultSettings } from './preferences.ts';

const h = (at: string, kind: 'used' | 'expired' | 'removed', category = 'food') => ({ at, kind, category, name: 'x' });

test('waste stats count what was used, thrown away and removed', () => {
  const list = [h('2026-11-01T10:00:00Z', 'used'), h('2026-11-02T10:00:00Z', 'used'), h('2026-10-05T10:00:00Z', 'expired', 'medicine'), h('2026-11-02T11:00:00Z', 'removed')];
  assert.deepEqual(tally(list), { used: 2, expired: 1, removed: 1 });
  assert.equal(usedInTime(tally(list)), 2 / 3);
  assert.equal(usedInTime({ used: 0, expired: 0, removed: 4 }), null);
  const months = byMonth(list, new Date(2026, 10, 3), 3);
  assert.deepEqual(months.map((m) => m.key), ['2026-09', '2026-10', '2026-11']);
  assert.deepEqual(months.map((m) => m.tally.used + m.tally.expired), [0, 1, 2]);
  assert.equal(byCategory(list)[0].category, 'medicine');
});

test('a backup restores exactly the Prexpire keys it holds', () => {
  const text = buildBackup(
    [
      ['prexpire.items.v1', JSON.stringify([{ id: 'a' }, { id: 'b' }])],
      ['prexpire.lastCategory.v1', 'food'],
      ['other.key', '1'],
      ['prexpire.empty', null],
    ],
    '1.0.0',
    new Date('2026-11-03T12:00:00Z'),
  );
  const r = parseBackup(text);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.data).sort(), ['prexpire.items.v1', 'prexpire.lastCategory.v1']);
  assert.equal(r.items, 2);
  assert.equal(parseBackup('{"items":[]}').ok, false);
  assert.equal(parseBackup('not json').ok, false);
  assert.equal(parseBackup(JSON.stringify({ kind: 'prexpire-backup', data: { 'prexpire.items.v1': '{broken' } })).ok, false);
});

test('a category can have its own warning period and opened shelf life', () => {
  const s = sanitizeSettings({ warningDays: 7, categoryWarning: { food: 3, bad: 99 }, openDays: { food: 2, x: 0 } }, defaultSettings(), ['food']);
  assert.deepEqual(s.categoryWarning, { food: 3 });
  assert.deepEqual(s.openDays, { food: 2 });
  assert.equal(warningFor(s, 'food'), 3);
  assert.equal(warningFor(s, 'medicine'), 7);
  assert.equal(openDaysFor(s, 'food'), 2);
  assert.equal(openDaysFor(s, 'medicine'), 90);
  assert.equal(openDaysFor(s, 'cat-x'), 7);
});
