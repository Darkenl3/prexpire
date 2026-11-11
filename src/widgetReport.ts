import { byMonth, withExpiredInList } from './stats.ts';
import type { HistoryEntry, Item } from './items.tsx';

// What the iPhone app's home-screen widgets need, sent to the shell as a
// 'widgets' message whenever items change (window.__prexpireWidgets). The
// shell works out each day's view itself (prexpire/src/widgets/widgetData.ts),
// so this is only the raw facts: every item with its category's warning
// period and icon, and this month's used / thrown-away counts (the same
// numbers as Waste stats, expired items still in the list included).

export type WidgetReport = {
  items: { name: string; expiresOn: string; addedAt: string; warn: number; icon: string; image?: string; opened?: boolean }[];
  monthUsed: number;
  monthWasted: number;
};

// Photos only for the soonest few: those are all a widget can show, and
// photos are the heavy part of the message.
const PHOTOS = 8;

export function buildWidgetReport(
  items: readonly Item[],
  history: readonly HistoryEntry[],
  warnFor: (category: string) => number,
  iconFor: (category: string) => string,
  today: Date,
): WidgetReport {
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const month = byMonth(withExpiredInList(history, items, todayIso), today, 1)[0].tally;
  const photoIds = new Set(
    items
      .filter((it) => it.image && it.expiresOn >= todayIso)
      .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
      .slice(0, PHOTOS)
      .map((it) => it.id),
  );
  return {
    items: items.map((it) => ({
      name: it.name,
      expiresOn: it.expiresOn,
      addedAt: it.addedAt,
      warn: warnFor(it.category),
      icon: iconFor(it.category),
      ...(photoIds.has(it.id) ? { image: it.image } : {}),
      ...(it.openedOn ? { opened: true } : {}),
    })),
    monthUsed: month.used,
    monthWasted: month.expired,
  };
}
