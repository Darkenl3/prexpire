import test from 'node:test';
import assert from 'node:assert/strict';
import { planReminders, wasteRisk } from './reminderPlan.ts';

const base = { reminders: true, reminderLead: 1 as const, dailySummary: false, warningDays: 3 as const, categoryWarning: {} };
const now = new Date(2026, 10, 6, 10, 0); // 6 Nov 2026, 10:00
const item = (id: string, name: string, expiresOn: string, category = 'food') => ({ id, name, category, expiresOn });

test('a reminder the day before and on the day, at 9:00', () => {
  const plan = planReminders([item('a', 'Milk', '2026-11-10')], base, now);
  assert.deepEqual(plan.map((r) => [r.id, r.title, new Date(r.at).getHours()]), [
    ['r-2026-11-09-1', 'Milk expires tomorrow', 9],
    ['r-2026-11-10-0', 'Milk expires today', 9],
  ]);
});

test('items due the same day share one notification', () => {
  const plan = planReminders([item('a', 'Milk', '2026-11-10'), item('b', 'Yogurt', '2026-11-10'), item('c', 'Cheese', '2026-11-10')], base, now);
  const eve = plan.find((r) => r.id === 'r-2026-11-09-1')!;
  assert.equal(eve.title, '3 items expire tomorrow');
  assert.match(eve.body, /Cheese, Milk and Yogurt/);
  assert.equal(plan.length, 2);
});

test('a reminder whose 9:00 has passed moves to 13:00, then 18:00, then is skipped', () => {
  // Expires today, added at 10:00: the 9:00 reminder moves to 13:00.
  const noon = planReminders([item('a', 'Milk', '2026-11-06')], base, now);
  assert.deepEqual(noon.map((r) => [r.id, r.title, new Date(r.at).getHours()]), [['r-2026-11-06-0', 'Milk expires today', 13]]);
  // Expires tomorrow, added at 15:00: tonight at 18:00, then tomorrow at 9:00.
  const afternoon = planReminders([item('a', 'Milk', '2026-11-07')], base, new Date(2026, 10, 6, 15, 0));
  assert.deepEqual(afternoon.map((r) => [r.title, new Date(r.at).getDate(), new Date(r.at).getHours()]), [
    ['Milk expires tomorrow', 6, 18],
    ['Milk expires today', 7, 9],
  ]);
  // After 18:00 there is no slot left today.
  assert.equal(planReminders([item('a', 'Milk', '2026-11-06')], base, new Date(2026, 10, 6, 19, 0)).length, 0);
});

test('nothing expired, nothing when reminders are off', () => {
  assert.equal(planReminders([item('a', 'Milk', '2026-11-01')], base, now).length, 0);
  assert.equal(planReminders([item('a', 'Milk', '2026-11-10')], { ...base, reminders: false }, now).length, 0);
});

test('reminder timing: on the expiry day only', () => {
  const plan = planReminders([item('a', 'Milk', '2026-11-10')], { ...base, reminderLead: 0 }, now);
  assert.deepEqual(plan.map((r) => r.id), ['r-2026-11-10-0']);
});

test('daily summary lists what is inside its warning period', () => {
  const plan = planReminders([item('a', 'Milk', '2026-11-09'), item('b', 'Pills', '2027-06-01', 'medicine')], { ...base, dailySummary: true }, now);
  const s = plan.filter((r) => r.id.startsWith('s-'));
  assert.equal(s[0].id, 's-2026-11-07'); // today's 8:30 already passed
  assert.equal(s[0].title, '1 item to use soon');
  assert.equal(s[0].body, 'Milk.');
  assert.ok(s.every((r) => !r.body.includes('Pills')));
});

test('a category with its own warning period gets an early heads-up too', () => {
  const settings = { ...base, categoryWarning: { medicine: 30 as const } };
  const plan = planReminders([item('p', 'Ibuprofen', '2026-12-20', 'medicine'), item('m', 'Milk', '2026-12-20')], settings, now);
  assert.deepEqual(plan.map((r) => [r.title, new Date(r.at).getMonth() + 1, new Date(r.at).getDate()]), [
    ['Ibuprofen expires in 30 days', 11, 20],
    ['2 items expire tomorrow', 12, 19],
    ['2 items expire today', 12, 20],
  ]);
});

test('reminder time: reminders at the chosen hour, catch-ups 4 and 9 hours later', () => {
  const plan = planReminders([item('a', 'Milk', '2026-11-10')], { ...base, reminderHour: 19 }, now);
  assert.deepEqual(plan.map((r) => new Date(r.at).getHours()), [19, 19]);
  // At 7:00 and it's already 10:00: the catch-up is 11:00 (7 + 4).
  const early = planReminders([item('a', 'Milk', '2026-11-06')], { ...base, reminderHour: 7 }, now);
  assert.deepEqual(early.map((r) => new Date(r.at).getHours()), [11]);
  // The daily summary comes half an hour before.
  const summary = planReminders([item('a', 'Milk', '2026-11-08')], { ...base, reminderHour: 19, dailySummary: true }, now).find((r) => r.id.startsWith('s-'))!;
  assert.deepEqual([new Date(summary.at).getHours(), new Date(summary.at).getMinutes()], [18, 30]);
});

test('waste-aware: a category often thrown away gets an earlier heads-up that says why', () => {
  const at = (d: number) => new Date(2026, 9, d).toISOString();
  const history = [
    { at: at(1), kind: 'expired' as const, category: 'dairy', name: 'Yogurt' },
    { at: at(5), kind: 'expired' as const, category: 'dairy', name: 'Milk' },
    { at: at(9), kind: 'used' as const, category: 'dairy', name: 'Cheese' },
    { at: at(9), kind: 'used' as const, category: 'food', name: 'Bread' },
    { at: at(10), kind: 'used' as const, category: 'food', name: 'Rice' },
    { at: at(11), kind: 'expired' as const, category: 'food', name: 'Soup' },
  ];
  const risk = wasteRisk(history, [], (id) => (id === 'dairy' ? 'Dairy' : 'Food'), now);
  assert.deepEqual(Object.keys(risk), ['dairy']);
  assert.equal(Math.round(risk.dairy.share * 100), 67);
  const plan = planReminders([item('a', 'Milk', '2026-11-12', 'dairy'), item('b', 'Bread', '2026-11-12')], base, now, risk);
  const early = plan.filter((r) => r.id.startsWith('w-'));
  assert.equal(early.length, 1);
  assert.equal(early[0].id, 'w-2026-11-09-3');
  assert.equal(early[0].title, 'Milk expires in 3 days');
  assert.match(early[0].body, /67% of your Dairy/);
  // Turned off: no extra reminder.
  assert.equal(planReminders([item('a', 'Milk', '2026-11-12', 'dairy')], { ...base, wasteAware: false }, now, risk).filter((r) => r.id.startsWith('w-')).length, 0);
});

test('waste-aware: fewer than 3 finished is not a pattern', () => {
  const history = [{ at: new Date(2026, 10, 1).toISOString(), kind: 'expired' as const, category: 'dairy', name: 'Milk' }];
  assert.deepEqual(wasteRisk(history, [], () => 'Dairy', now), {});
});
