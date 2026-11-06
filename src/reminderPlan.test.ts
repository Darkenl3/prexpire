import test from 'node:test';
import assert from 'node:assert/strict';
import { planReminders } from './reminderPlan.ts';

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

test('nothing in the past, nothing expired, nothing when reminders are off', () => {
  // Expires today: the 9:00 reminder already passed at 10:00.
  assert.equal(planReminders([item('a', 'Milk', '2026-11-06')], base, now).length, 0);
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
