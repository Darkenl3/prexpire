import { warningFor, type Settings } from './preferences.ts';
import { withExpiredInList } from './stats.ts';
import type { HistoryEntry } from './items.tsx';

// Works out every expiry reminder from the saved items, automatically: nobody
// sets a reminder by hand. Re-run whenever items or settings change; the
// iPhone app replaces what it had scheduled with the new plan.
//
//   • Per item, up to three reminders: a heads-up as early as its category's
//     own warning period (Medicine set to 30 days: a month ahead), one
//     "Reminder timing" days before (default the day before), and one on
//     the expiry day itself. Items due the same day share ONE
//     notification, so a full fridge never means a pile of alerts.
//   • With "Daily summary" on: a morning summary on each of the next 14 days
//     that has something inside its category's warning period.
//
//   • Waste-aware (on by default): a category you often throw away (the waste
//     stats of the last 90 days, see wasteRisk) gets one more heads-up, two
//     days before the earliest one, saying why.
//
// Times are local, at the "Reminder time" setting (default 9:00); summaries
// half an hour before it. A reminder whose time has already gone by today (an
// item added in the afternoon that expires today or tomorrow) moves to a
// catch-up slot 4 or 9 hours later (13:00 or 18:00 for 9:00), instead of being
// dropped. Fixed slots mean re-planning (every app open) never sends the same
// reminder twice.

export type PlannedReminder = { id: string; title: string; body: string; at: number };
type PlanItem = { id: string; name: string; category: string; expiresOn: string };
type PlanSettings = Pick<Settings, 'reminders' | 'reminderLead' | 'dailySummary' | 'warningDays' | 'categoryWarning'> &
  Partial<Pick<Settings, 'reminderHour' | 'wasteAware'>>;
// Categories you often throw away: id -> share wasted (0..1) and its name.
export type WasteRisk = Record<string, { share: number; name: string }>;

const DEFAULT_HOUR = 9;
const CATCH_UP_AFTER = [4, 9];
const SUMMARY_DAYS = 14;
// Waste-aware: what counts as "often thrown away", and how much earlier.
const RISK_WINDOW_DAYS = 90;
const RISK_MIN_FINISHED = 3;
const RISK_SHARE = 0.4;
const RISK_EXTRA_DAYS = 2;

// From the waste stats: categories where at least 40% of what was finished in
// the last 90 days was thrown away (with at least 3 finished, so one bad week
// isn't a pattern). Expired items still in the list count, as in Waste stats.
export function wasteRisk(
  history: readonly HistoryEntry[],
  items: readonly { expiresOn: string; category: string; name: string }[],
  nameOf: (category: string) => string,
  now = new Date(),
): WasteRisk {
  const since = new Date(now.getTime() - RISK_WINDOW_DAYS * 86400000);
  const counts = new Map<string, { used: number; expired: number }>();
  for (const e of withExpiredInList(history, items, isoDay(now))) {
    if (e.kind === 'removed' || new Date(e.at) < since) continue;
    const c = counts.get(e.category) ?? { used: 0, expired: 0 };
    c[e.kind] += 1;
    counts.set(e.category, c);
  }
  const out: WasteRisk = {};
  for (const [category, c] of counts) {
    const finished = c.used + c.expired;
    if (finished >= RISK_MIN_FINISHED && c.expired / finished >= RISK_SHARE) out[category] = { share: c.expired / finished, name: nameOf(category) };
  }
  return out;
}

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

export function planReminders(items: PlanItem[], settings: PlanSettings, now = new Date(), risk: WasteRisk = {}): PlannedReminder[] {
  if (!settings.reminders) return [];
  const today = isoDay(now);
  const out: PlannedReminder[] = [];
  const hour = settings.reminderHour ?? DEFAULT_HOUR;
  const catchUp = CATCH_UP_AFTER.map((h) => hour + h).filter((h) => h <= 22);
  const wasteAware = settings.wasteAware ?? true;

  // Reminders: group by (the day it fires, how far ahead of expiry it is).
  const groups = new Map<string, { fire: string; lead: number; risky: boolean; items: PlanItem[] }>();
  for (const item of items) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.expiresOn) || item.expiresOn < today) continue;
    // The category's own warning period (only when one is set for it) gives
    // an early heads-up; Reminder timing the follow-up; then the day itself.
    const leads = new Set<number>([0]);
    if (settings.reminderLead > 0) leads.add(settings.reminderLead);
    const own = settings.categoryWarning[item.category];
    if (typeof own === 'number' && own > 0) leads.add(own);
    // Often thrown away: one more, earlier heads-up, two days before the
    // earliest one.
    const riskyLead = wasteAware && risk[item.category] ? Math.max(...leads) + RISK_EXTRA_DAYS : null;
    if (riskyLead !== null) leads.add(riskyLead);
    for (const lead of leads) {
      const fire = addDays(item.expiresOn, -lead);
      if (fire < today) continue;
      const risky = lead === riskyLead;
      const key = `${fire}|${lead}${risky ? '|w' : ''}`;
      const g = groups.get(key) ?? { fire, lead, risky, items: [] };
      g.items.push(item);
      groups.set(key, g);
    }
  }
  for (const g of groups.values()) {
    let at = atLocal(g.fire, hour).getTime();
    if (at <= now.getTime()) {
      // Only today's reminders can have passed; give them the next slot.
      const next = catchUp.map((h) => atLocal(g.fire, h).getTime()).find((t) => t > now.getTime());
      if (next === undefined) continue;
      at = next;
    }
    const list = [...g.items].sort((a, b) => a.name.localeCompare(b.name));
    const one = list.length === 1;
    if (g.risky) {
      // Say why this one is early: the category's own waste share.
      const cats = [...new Set(list.map((i) => i.category))];
      const r = cats.length === 1 ? risk[cats[0]] : null;
      const why = r
        ? `You've thrown away ${Math.round(r.share * 100)}% of your ${r.name} lately, so here's an early heads-up.`
        : "These often go to waste for you, so here's an early heads-up.";
      out.push({
        id: `w-${g.fire}-${g.lead}`,
        title: one ? `${list[0].name} expires ${when(g.lead)}` : `${list.length} items expire ${when(g.lead)}`,
        body: one ? why : `${names(list)}. ${why}`,
        at,
      });
      continue;
    }
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
      const at = atLocal(day, hour - 1, 30).getTime();
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
