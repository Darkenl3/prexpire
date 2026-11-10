// Waste stats: what happened to the items that left the list (used up, thrown
// away expired, or removed), from the history kept by src/items.tsx, plus the
// items that have expired but are still in the list (withExpiredInList). Pure
// logic, no React Native imports, so it is tested with Node on its own.

import type { HistoryEntry } from './items';

export type Tally = { used: number; expired: number; removed: number };

// Of the items that were either used or expired, the share used in time
// (0..1), or null when there is nothing to judge yet.
export function usedInTime(t: Tally): number | null {
  const judged = t.used + t.expired;
  return judged ? t.used / judged : null;
}

export function tally(entries: readonly HistoryEntry[]): Tally {
  const t: Tally = { used: 0, expired: 0, removed: 0 };
  for (const e of entries) t[e.kind] += 1;
  return t;
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// The last `count` calendar months (oldest first, this month last), each with
// its tally. Months with nothing in them are kept, so the chart has no gaps.
export function byMonth(entries: readonly HistoryEntry[], today: Date, count = 6): { key: string; month: number; tally: Tally }[] {
  const months = Array.from({ length: count }, (_, i) => new Date(today.getFullYear(), today.getMonth() - (count - 1 - i), 1));
  return months.map((m) => {
    const key = monthKey(m);
    return { key, month: m.getMonth(), tally: tally(entries.filter((e) => monthKey(new Date(e.at)) === key)) };
  });
}

// Per category, the categories with the most thrown away first.
export function byCategory(entries: readonly HistoryEntry[]): { category: string; tally: Tally }[] {
  const map = new Map<string, HistoryEntry[]>();
  for (const e of entries) map.set(e.category, [...(map.get(e.category) ?? []), e]);
  return [...map.entries()]
    .map(([category, list]) => ({ category, tally: tally(list) }))
    .sort((a, b) => b.tally.expired - a.tally.expired || b.tally.used - a.tally.used);
}

// The history plus every item that has expired but is still in the list,
// counted as expired on its expiry day. Removing such an item later records
// it in the history (as expired) and it leaves the list, so it is never
// counted twice. todayIso is the local date, YYYY-MM-DD.
export function withExpiredInList(
  history: readonly HistoryEntry[],
  items: readonly { expiresOn: string; category: string; name: string }[],
  todayIso: string,
): HistoryEntry[] {
  const lapsed = items
    .filter((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.expiresOn) && i.expiresOn < todayIso)
    .map((i): HistoryEntry => ({ at: new Date(`${i.expiresOn}T12:00:00`).toISOString(), kind: 'expired', category: i.category as HistoryEntry['category'], name: i.name }));
  return lapsed.length ? [...history, ...lapsed] : [...history];
}
