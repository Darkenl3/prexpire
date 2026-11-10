import { warningFor, type Settings } from './preferences.ts';

// Works out every expiry reminder from the saved items, automatically: nobody
// sets a reminder by hand. Re-run whenever items or settings change; the
// iPhone app replaces what it had scheduled with the new plan.
//
//   • A reminder "Reminder timing" days before each expiry (default 1 day),
//     and one on the expiry day itself. Items due the same day share ONE
//     notification, so a full fridge never means a pile of alerts.
//   • With "Daily summary" on: a morning summary on each of the next 14 days
//     that has something inside its category's warning period.
//
// Times are local: reminders at 9:00, summaries at 8:30. A reminder whose
// 9:00 has already gone by today (an item added in the afternoon that expires
// today or tomorrow) moves to the next fixed slot, 13:00 or 18:00, instead of
// being dropped. Fixed slots mean re-planning (every app open) never sends
// the same reminder twice.

export type PlannedReminder = { id: string; title: string; body: string; at: number };
type PlanItem = { id: string; name: string; category: string; expiresOn: string };
type PlanSettings = Pick<Settings, 'reminders' | 'reminderLead' | 'dailySummary' | 'warningDays' | 'categoryWarning'>;

const REMIND_HOUR = 9;
const CATCH_UP_HOURS = [13, 18];
const SUMMARY_HOUR = 8;
const SUMMARY_MINUTE = 30;
const SUMMARY_DAYS = 14;

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function atLocal(iso: string, hour: number, minute = 0): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0);
}
function addDays(iso: string, n: number): string {
  const d = atLocal(iso, 12);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
function daysFrom(fromIso: string, toIso: string): number {
  return Math.round((atLocal(toIso, 12).getTime() - atLocal(fromIso, 12).getTime()) / 86400000);
}

function names(list: PlanItem[]): string {
  const n = list.map((i) => i.name);
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  if (n.length === 3) return `${n[0]}, ${n[1]} and ${n[2]}`;
  return `${n[0]}, ${n[1]} and ${n.length - 2} more`;
}
function when(days: number): string {
  return days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

export function planReminders(items: PlanItem[], settings: PlanSettings, now = new Date()): PlannedReminder[] {
  if (!settings.reminders) return [];
  const today = isoDay(now);
  const out: PlannedReminder[] = [];

  // Reminders: group by (the day it fires, how far ahead of expiry it is).
  const leads = settings.reminderLead > 0 ? [settings.reminderLead, 0] : [0];
  const groups = new Map<string, { fire: string; lead: number; items: PlanItem[] }>();
  for (const item of items) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.expiresOn) || item.expiresOn < today) continue;
    for (const lead of leads) {
      const fire = addDays(item.expiresOn, -lead);
      if (fire < today) continue;
      const key = `${fire}|${lead}`;
      const g = groups.get(key) ?? { fire, lead, items: [] };
      g.items.push(item);
      groups.set(key, g);
    }
  }
  for (const g of groups.values()) {
    let at = atLocal(g.fire, REMIND_HOUR).getTime();
    if (at <= now.getTime()) {
      // Only today's reminders can have passed; give them the next slot.
      const next = CATCH_UP_HOURS.map((h) => atLocal(g.fire, h).getTime()).find((t) => t > now.getTime());
      if (next === undefined) continue;
      at = next;
    }
    const list = [...g.items].sort((a, b) => a.name.localeCompare(b.name));
    const one = list.length === 1;
    out.push({
      id: `r-${g.fire}-${g.lead}`,
      title: one ? `${list[0].name} expires ${when(g.lead)}` : `${list.length} items expire ${when(g.lead)}`,
      body: one
        ? g.lead === 0
          ? 'Use it today so it doesn\'t go to waste.'
          : 'Use it soon so it doesn\'t go to waste.'
        : `${names(list)}. Tap to see what to use first.`,
      at,
    });
  }

  // Daily summaries: what's inside its warning period on each morning.
  if (settings.dailySummary) {
    for (let i = 0; i < SUMMARY_DAYS; i++) {
      const day = addDays(today, i);
      const at = atLocal(day, SUMMARY_HOUR, SUMMARY_MINUTE).getTime();
      if (at <= now.getTime()) continue;
      const soon = items.filter((it) => it.expiresOn >= day && daysFrom(day, it.expiresOn) <= warningFor(settings, it.category));
      if (!soon.length) continue;
      const sorted = [...soon].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
      out.push({
        id: `s-${day}`,
        title: soon.length === 1 ? '1 item to use soon' : `${soon.length} items to use soon`,
        body: `${names(sorted)}.`,
        at,
      });
    }
  }

  return out.sort((a, b) => a.at - b.at);
}
