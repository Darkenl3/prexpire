import test from 'node:test';
import assert from 'node:assert/strict';
import { tally, withExpiredInList } from './stats.ts';

test('expired items still in the list count as expired', () => {
  const history = [{ at: '2026-11-01T10:00:00.000Z', kind: 'used' as const, category: 'food', name: 'Milk' }];
  const items = [
    { expiresOn: '2026-11-05', category: 'food', name: 'Yogurt' },
    { expiresOn: '2026-11-08', category: 'food', name: 'Cheese' },
    { expiresOn: '2026-11-10', category: 'food', name: 'Bread' }, // today: not expired yet
    { expiresOn: '2026-12-01', category: 'pantry', name: 'Pasta' },
  ];
  const all = withExpiredInList(history, items, '2026-11-10');
  assert.deepEqual(tally(all), { used: 1, expired: 2, removed: 0 });
  assert.equal(new Date(all[1].at).getDate(), 5);
});

test('nothing expired in the list leaves the history as it is', () => {
  assert.deepEqual(withExpiredInList([], [{ expiresOn: '2026-12-01', category: 'food', name: 'Milk' }], '2026-11-10'), []);
});
