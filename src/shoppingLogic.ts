import type { Item } from './items';

// The Shopping List's pure logic: what counts as "expiring soon", which
// products belong on the list right now, which expiration events have already
// been handled, and how stored entries are validated. No React Native imports
// here, so it runs (and is tested) with Node on its own, like preferences.ts.
// The provider that loads and saves the data lives in src/shopping.tsx.

export type ShoppingReason = 'expiring' | 'manual';

// One entry on the Shopping List. Entries that came from a tracked product
// keep the link (product id and the expiration event key) so the same event is
// never added twice; entries the user typed carry no link.
export type ShoppingItem = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  reason: ShoppingReason;
  productId?: string;
  // `${productId}:${expiresOn}` at the time the entry was created. Identifies
  // one expiration event: a changed expiry date means a new event.
  eventKey?: string;
  // The expiry date the entry was created for (display only).
  expiresOn?: string;
  addedAt: string;
  // True when the entry was placed by the automatic rule rather than by a tap.
  addedAuto: boolean;
  purchasedAt: string | null;
};

// Everything remembered about one expiration event, so nothing repeats:
// re-adds, re-alerts and re-processing of events the user already handled.
export type EventState = {
  // An entry for this event is (or was) on the list.
  listed?: boolean;
  // The user removed the automatic entry: this event is never re-added and
  // never alerted again. A genuinely new expiration (a changed date) gets a
  // fresh event key and is evaluated on its own.
  autoDismissed?: boolean;
  // The in-app expiry alert for this event has been shown.
  notifShown?: boolean;
  notifAction?: 'added' | 'later';
};

export type EventStore = Record<string, EventState>;

// One queued in-app alert. The product is re-validated live when the user
// answers, so the payload only carries what is needed to find it again.
export type AlertInfo = {
  key: string;
  itemId: string;
  name: string;
  expiresOn: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function daysBetween(iso: string, today: Date): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
}

export function eventKeyFor(item: Pick<Item, 'id' | 'expiresOn'>): string {
  return `${item.id}:${item.expiresOn}`;
}

// "Expiring soon" follows the app's existing expiry rule (the same window that
// drives amber pills, the attention card and reminders): expired, or within
// the warning period chosen in Settings. Items with missing or invalid dates
// never qualify.
export function isExpiringSoon(item: Pick<Item, 'expiresOn'>, warningDays: number, today = new Date()): boolean {
  if (!ISO_DATE.test(item.expiresOn)) return false;
  return daysBetween(item.expiresOn, today) <= warningDays;
}

// True when the item was already inside the warning window at the moment it
// was added: the user just told the app about it, so an expiry alert for that
// event would be noise (the automatic list addition still happens).
export function wasEligibleAtAdd(item: Item, warningDays: number): boolean {
  if (!ISO_DATE.test(item.expiresOn)) return false;
  const added = new Date(item.addedAt);
  if (Number.isNaN(added.getTime())) return false;
  return daysBetween(item.expiresOn, added) <= warningDays;
}

// Tracked products that should land on the Shopping List right now: expiring,
// not yet listed for this event, and not dismissed. Passing the current list
// entries as well means even a lost or damaged event store cannot produce a
// duplicate open entry for the same event.
export function autoAdditions(items: Item[], events: EventStore, shopping: ShoppingItem[], warningDays: number, today = new Date()): Item[] {
  return items.filter((item) => {
    if (!isExpiringSoon(item, warningDays, today)) return false;
    const key = eventKeyFor(item);
    const state = events[key];
    if (state?.listed || state?.autoDismissed) return false;
    return !shopping.some((s) => s.eventKey === key && !s.purchasedAt);
  });
}

// Tracked products whose one-time expiry alert should be offered now. The
// product may already be on the list (added automatically); the alert then
// simply reflects that instead of asking. Events the user has already seen or
// dismissed are never offered again.
export function notificationsToShow(
  items: Item[],
  events: EventStore,
  warningDays: number,
  today = new Date(),
  pendingKeys: readonly string[] = [],
): Item[] {
  return items.filter((item) => {
    if (!isExpiringSoon(item, warningDays, today)) return false;
    if (wasEligibleAtAdd(item, warningDays)) return false;
    const key = eventKeyFor(item);
    const state = events[key];
    if (state?.notifShown || state?.autoDismissed) return false;
    return !pendingKeys.includes(key);
  });
}

// Event entries whose product no longer exists are stale: product ids never
// repeat, and orphaned list entries carry their own snapshot, so the state is
// only ever read for live products.
export function eventsToPrune(events: EventStore, items: Item[]): string[] {
  const live = new Set(items.map((i) => i.id));
  return Object.keys(events).filter((key) => !live.has(key.slice(0, key.lastIndexOf(':'))));
}

// Manual additions skip exact-name duplicates that are still open (case and
// surrounding spaces do not count as a difference).
export function isDuplicateManualAdd(shopping: ShoppingItem[], name: string): boolean {
  const clean = name.trim().toLocaleLowerCase();
  if (!clean) return false;
  return shopping.some((s) => !s.purchasedAt && s.name.trim().toLocaleLowerCase() === clean);
}

export function groupShopping(shopping: ShoppingItem[]): { toBuy: ShoppingItem[]; purchased: ShoppingItem[] } {
  const toBuy = shopping.filter((s) => !s.purchasedAt);
  const purchased = shopping
    .filter((s) => !!s.purchasedAt)
    .sort((a, b) => ((a.purchasedAt as string) < (b.purchasedAt as string) ? 1 : -1));
  return { toBuy, purchased };
}

const REASONS: readonly ShoppingReason[] = ['expiring', 'manual'];
const ACTIONS: readonly string[] = ['added', 'later'];

export function isShoppingItem(x: unknown): x is ShoppingItem {
  const s = x as ShoppingItem;
  return (
    !!s &&
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    s.name.length > 0 &&
    s.name.length <= 80 &&
    typeof s.category === 'string' &&
    s.category.length > 0 &&
    s.category.length <= 40 &&
    typeof s.quantity === 'number' &&
    Number.isFinite(s.quantity) &&
    s.quantity >= 1 &&
    s.quantity <= 99 &&
    (REASONS as string[]).includes(s.reason) &&
    (s.productId === undefined || typeof s.productId === 'string') &&
    (s.eventKey === undefined || typeof s.eventKey === 'string') &&
    (s.expiresOn === undefined || (typeof s.expiresOn === 'string' && ISO_DATE.test(s.expiresOn))) &&
    typeof s.addedAt === 'string' &&
    typeof s.addedAuto === 'boolean' &&
    (s.purchasedAt === null || typeof s.purchasedAt === 'string')
  );
}

export function sanitizeShopping(raw: unknown): ShoppingItem[] {
  const parsed: unknown = raw ?? [];
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isShoppingItem);
}

// Keeps only valid fields per event so damaged storage falls back cleanly.
export function sanitizeEventStore(raw: unknown): EventStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: EventStore = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const e = value as Record<string, unknown>;
    const state: EventState = {};
    if (typeof e.listed === 'boolean') state.listed = e.listed;
    if (typeof e.autoDismissed === 'boolean') state.autoDismissed = e.autoDismissed;
    if (typeof e.notifShown === 'boolean') state.notifShown = e.notifShown;
    if (typeof e.notifAction === 'string' && ACTIONS.includes(e.notifAction)) state.notifAction = e.notifAction as EventState['notifAction'];
    out[key] = state;
  }
  return out;
}
