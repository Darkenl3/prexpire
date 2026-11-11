import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWidgetReport } from './widgetReport.ts';
import type { Item } from './items.tsx';

const item = (id: string, expiresOn: string, extra: Partial<Item> = {}): Item => ({
  id,
  name: `Item ${id}`,
  category: 'food',
  expiresOn,
  datePrecision: 'day',
  addedAt: '2026-11-01T09:00:00.000Z',
  source: 'scan',
  ...extra,
});

test('widget report: warning period, icon, opened, and this month counted like Waste stats', () => {
  const today = new Date(2026, 10, 11);
  const items = [item('a', '2026-11-12', { openedOn: '2026-11-10' }), item('b', '2026-11-05'), item('c', '2027-01-01', { category: 'medicine' })];
  const history = [{ at: new Date(2026, 10, 3).toISOString(), kind: 'used' as const, category: 'food', name: 'Milk' }];
  const r = buildWidgetReport(items, history, (c) => (c === 'medicine' ? 30 : 3), (c) => (c === 'medicine' ? 'capsule' : 'restaurant-outline'), today);
  assert.equal(r.items.length, 3);
  assert.deepEqual(r.items[0], { name: 'Item a', expiresOn: '2026-11-12', addedAt: '2026-11-01T09:00:00.000Z', warn: 3, icon: 'restaurant-outline', opened: true });
  assert.equal(r.items[2].warn, 30);
  assert.equal(r.items[2].icon, 'capsule');
  // One used this month, and the expired one still in the list counts as thrown away.
  assert.equal(r.monthUsed, 1);
  assert.equal(r.monthWasted, 1);
});

test('widget report: photos only for the soonest upcoming items', () => {
  const today = new Date(2026, 10, 11);
  const items = Array.from({ length: 12 }, (_, i) => item(String(i), `2026-11-${String(12 + i).padStart(2, '0')}`, { image: `data:image/jpeg;base64,${i}` }));
  items.push(item('old', '2026-11-01', { image: 'data:image/jpeg;base64,old' }));
  const r = buildWidgetReport(items, [], () => 3, () => 'folder-outline', today);
  const withPhoto = r.items.filter((x) => x.image).map((x) => x.name);
  assert.equal(withPhoto.length, 8);
  assert.ok(withPhoto.includes('Item 0'));
  assert.ok(!withPhoto.includes('Item 11'));
  assert.ok(!withPhoto.includes('Item old'));
});
