// Run with: npm test
// The Shopping List's pure logic, covering the behaviour the feature promised:
// which products belong on the list, how expiration events are remembered so
// nothing repeats, and how damaged storage falls back cleanly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoAdditions,
  daysBetween,
  eventKeyFor,
  eventsToPrune,
  groupShopping,
  isDuplicateManualAdd,
  isExpiringSoon,
  isShoppingItem,
  notificationsToShow,
  sanitizeEventStore,
  sanitizeShopping,
  wasEligibleAtAdd,
  type EventStore,
  type ShoppingItem,
} from './shoppingLogic.ts';
import type { Item } from './items.ts';

const today = new Date(2026, 9, 26); // 26 Oct 2026
const iso = (offsetDays: number) => {
  const d = new Date(Date.UTC(2026, 9, 26 + offsetDays));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

function product(id: string, name: string, expiresOn: string, addedAt = '2026-10-20T12:00:00.000Z'): Item {
  return { id, name, category: 'food', expiresOn, datePrecision: 'day', addedAt, source: 'scan' };
}

function entry(over: Partial<ShoppingItem>): ShoppingItem {
  return { id: 's1', name: 'Milk', category: 'food', quantity: 1, reason: 'manual', addedAt: '2026-10-26T09:00:00.000Z', addedAuto: false, purchasedAt: null, ...over };
}

// A fresh account starts with nothing: unreadable or absent storage sanitizes
// to an empty list and an empty event store, never to sample content.
test('empty storage sanitizes to an empty list and event store', () => {
  assert.deepEqual(sanitizeShopping(undefined), []);
  assert.deepEqual(sanitizeShopping('junk'), []);
  assert.deepEqual(sanitizeShopping([{ id: 'x' }]), [], 'invalid entries are dropped');
  assert.deepEqual(sanitizeEventStore(undefined), {});
  assert.deepEqual(sanitizeEventStore('junk'), {});
  assert.deepEqual(sanitizeEventStore({ a: 'nope' }), {});
});

test('stored entries are validated field by field', () => {
  const good = entry({ id: 'a', eventKey: 'i1:2026-10-28', expiresOn: '2026-10-28', reason: 'expiring', addedAuto: true, productId: 'i1' });
  assert.equal(sanitizeShopping([good]).length, 1);
  assert.equal(isShoppingItem(entry({ quantity: 0 })), false, 'quantity must be at least 1');
  assert.equal(isShoppingItem(entry({ quantity: 100 })), false, 'quantity must be at most 99');
  assert.equal(isShoppingItem(entry({ reason: 'other' as ShoppingItem['reason'] })), false);
  assert.equal(isShoppingItem(entry({ purchasedAt: 5 as unknown as string })), false);
  assert.equal(isShoppingItem(entry({ expiresOn: '10/28/2026' })), false, 'expiry dates are ISO only');
  assert.equal(isShoppingItem(entry({ name: '' })), false);
  assert.deepEqual(sanitizeEventStore({ k: { listed: 'yes', autoDismissed: true, notifAction: 'added', junk: 1 } }), { k: { autoDismissed: true, notifAction: 'added' } });
});

// "Expiring soon" is the app's existing rule: expired, or within the warning
// period (default 3 days). Missing or malformed dates never qualify.
test('expiring soon follows the warning window and skips invalid dates', () => {
  assert.equal(isExpiringSoon(product('i', 'Milk', iso(3)), 3, today), true);
  assert.equal(isExpiringSoon(product('i', 'Milk', iso(4)), 3, today), false);
  assert.equal(isExpiringSoon(product('i', 'Milk', iso(0)), 3, today), true, 'expires today');
  assert.equal(isExpiringSoon(product('i', 'Milk', iso(-2)), 3, today), true, 'already expired');
  assert.equal(isExpiringSoon(product('i', 'Milk', iso(14)), 14, today), true, 'a longer window widens the rule');
  assert.equal(isExpiringSoon(product('i', 'Milk', 'not-a-date'), 3, today), false);
  assert.equal(isExpiringSoon(product('i', 'Milk', ''), 3, today), false);
});

// The automatic rule: expiring products land on the list once per expiration
// event, and an unsaved preference counts as enabled (the provider's default).
test('auto additions pick up expiring products that were never handled', () => {
  const milk = product('i1', 'Milk', iso(2));
  const tea = product('i2', 'Tea', iso(2));
  const jam = product('i3', 'Jam', iso(20));
  const pills = product('i4', 'Pills', iso(2), '2026-10-26T08:00:00.000Z'); // just added, already expiring
  // The just-added expiring product is listed too: the user is reminded to
  // buy it, but no separate alert is raised for it (tested below).
  assert.deepEqual(autoAdditions([milk, tea, jam, pills], {}, [], 3, today).map((i) => i.id), ['i1', 'i2', 'i4']);
  // Already listed for this event: never again.
  assert.deepEqual(autoAdditions([milk], { [eventKeyFor(milk)]: { listed: true } }, [], 3, today), []);
  // Already dismissed by removing the automatic entry: never again for this event.
  assert.deepEqual(autoAdditions([milk], { [eventKeyFor(milk)]: { autoDismissed: true } }, [], 3, today), []);
});

test('auto additions never duplicate an open entry, even with a lost event store', () => {
  const milk = product('i1', 'Milk', iso(2));
  const onList = entry({ eventKey: eventKeyFor(milk), reason: 'expiring', purchasedAt: null });
  assert.deepEqual(autoAdditions([milk], {}, [onList], 3, today), []);
  // A purchased entry does not block the event's next automatic addition.
  const bought = entry({ eventKey: eventKeyFor(milk), reason: 'expiring', purchasedAt: '2026-10-25T09:00:00.000Z' });
  assert.deepEqual(autoAdditions([milk], {}, [bought], 3, today).map((i) => i.id), ['i1']);
});

// A changed expiry date is a genuinely new expiration event: it is evaluated
// on its own, while the old event's memory never blocks the new one.
test('a changed expiration date is a new event', () => {
  const oldDate = iso(2);
  const newDate = iso(1);
  const milk = product('i1', 'Milk', newDate);
  const events: EventStore = { [`i1:${oldDate}`]: { listed: true, autoDismissed: true, notifShown: true } };
  assert.deepEqual(autoAdditions([milk], events, [], 3, today).map((i) => i.id), ['i1']);
  assert.equal(eventKeyFor({ id: 'i1', expiresOn: newDate }) === eventKeyFor({ id: 'i1', expiresOn: oldDate }), false);
});

// The in-app expiry alerts: offered once per event, never for products the
// user added while already inside the warning window (they just told the app),
// and never again once seen or dismissed.
test('expiry alerts are offered once, and not for just-added expiring products', () => {
  const milk = product('i1', 'Milk', iso(2)); // added 20 Oct, well before expiry
  const pills = product('i4', 'Pills', iso(2), '2026-10-26T08:00:00.000Z'); // added today, already expiring
  assert.deepEqual(notificationsToShow([milk, pills], {}, 3, today).map((i) => i.id), ['i1']);
  assert.equal(wasEligibleAtAdd(pills, 3), true);
  assert.equal(wasEligibleAtAdd(milk, 3), false);
  // Already shown: never again for this event.
  assert.deepEqual(notificationsToShow([milk], { [eventKeyFor(milk)]: { notifShown: true } }, 3, today), []);
  // Already queued on screen: not offered twice at once.
  assert.deepEqual(notificationsToShow([milk], {}, 3, today, [eventKeyFor(milk)]), []);
  // Dismissed by removing the automatic entry: never alerted either.
  assert.deepEqual(notificationsToShow([milk], { [eventKeyFor(milk)]: { autoDismissed: true } }, 3, today), []);
});

// Deleting a product cleans up after it: its event state is pruned, and no
// orphaned memory can affect a future product (ids never repeat).
test('event state is pruned when its product no longer exists', () => {
  const milk = product('i1', 'Milk', iso(2));
  const events: EventStore = { [eventKeyFor(milk)]: { listed: true }, 'i2:2026-10-28': { notifShown: true } };
  assert.deepEqual(eventsToPrune(events, [milk]), ['i2:2026-10-28']);
  assert.deepEqual(eventsToPrune(events, []), ['i1:2026-10-28', 'i2:2026-10-28']);
});

test('manual additions skip exact-name duplicates that are still open', () => {
  const open = entry({ name: 'Oat milk ' });
  const bought = entry({ id: 's2', name: 'Bread', purchasedAt: '2026-10-25T09:00:00.000Z' });
  const list = [open, bought];
  assert.equal(isDuplicateManualAdd(list, ' OAT MILK '), true, 'case and spaces do not count as a difference');
  assert.equal(isDuplicateManualAdd(list, 'Bread'), false, 'a purchased entry does not block the name');
  assert.equal(isDuplicateManualAdd(list, 'Butter'), false);
  assert.equal(isDuplicateManualAdd(list, ''), false);
});

// The bought split: purchased entries keep their purchase order (newest
// first) and everything else stays a to-buy entry until it is checked.
test('the list splits into to buy and purchased', () => {
  const a = entry({ id: 'a', purchasedAt: null });
  const b = entry({ id: 'b', purchasedAt: '2026-10-24T09:00:00.000Z' });
  const c = entry({ id: 'c', purchasedAt: '2026-10-26T09:00:00.000Z' });
  const { toBuy, purchased } = groupShopping([a, b, c]);
  assert.deepEqual(toBuy.map((s) => s.id), ['a']);
  assert.deepEqual(purchased.map((s) => s.id), ['c', 'b'], 'newest purchase first');
});

test('day arithmetic crosses months without off-by-one errors', () => {
  assert.equal(daysBetween('2026-10-26', today), 0);
  assert.equal(daysBetween('2026-10-28', today), 2);
  assert.equal(daysBetween('2026-11-01', today), 6);
  assert.equal(daysBetween('2026-10-24', today), -2);
});
