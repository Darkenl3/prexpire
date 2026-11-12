// Settings values and the pure logic that uses them (no React Native imports, so it is tested
// with Node on its own). The provider that loads and saves them lives in src/settings.tsx.

import type { DayOrder } from './scanner/dateParser';
import type { CategoryId, Item } from './items';

export type ReminderLead = 0 | 1 | 3 | 7;
export type ReminderHour = 7 | 8 | 9 | 10 | 12 | 17 | 19 | 21;
export type WarningDays = 3 | 7 | 14 | 30;
export type DateFormat = 'DMY' | 'MDY' | 'YMD';
export type SortOrder = 'expiry' | 'added' | 'name';
export type DefaultCategory = 'last' | CategoryId;
export type ThemeMode = 'dark' | 'light' | 'system';
// How much an iPad screen shows at once (see src/density.ts).
export type PadLayout = 'basic' | 'compact' | 'detailed';

export type Settings = {
  // Notifications. These drive the Reminders tab, its badge and the in-app
  // expiry alerts (alerts appear while the app is open; nothing is delivered
  // in the background).
  reminders: boolean;
  reminderLead: ReminderLead;
  // The hour reminders arrive (local time); the daily summary comes half an
  // hour before it.
  reminderHour: ReminderHour;
  dailySummary: boolean;
  // An extra, earlier heads-up for categories you often throw away (from the
  // waste stats: see wasteRisk in reminderPlan.ts).
  wasteAware: boolean;
  // Appearance
  theme: ThemeMode;
  compact: boolean;
  padLayout: PadLayout;
  animations: boolean;
  // The moving scanning line inside the Live Scan frame (cosmetic only: the
  // camera, barcode reading and date OCR keep running when it is off).
  scanLineAnimation: boolean;
  // Expiry
  warningDays: WarningDays;
  dateFormat: DateFormat;
  sort: SortOrder;
  showExpired: boolean;
  // Inventory
  defaultCategory: DefaultCategory;
  // Shopping List: expiring products are added automatically. Enabled by
  // default; a preference that has never been saved is treated as enabled.
  autoShoppingList: boolean;
  // Per category (edited on its page in Settings > Categories): a warning
  // period of its own instead of warningDays (milk 2 days, medicine 30), and
  // how many days an opened product of that category stays good ("use within
  // 3 days of opening"). Categories without an entry use the general warning
  // period and OPEN_DAYS_DEFAULT.
  categoryWarning: Record<string, WarningDays>;
  openDays: Record<string, number>;
};

export const REMINDER_LEADS: ReminderLead[] = [0, 1, 3, 7];
export const REMINDER_HOURS: ReminderHour[] = [7, 8, 9, 10, 12, 17, 19, 21];
export function reminderHourLabel(hour: number) {
  return new Date(2026, 0, 1, hour, 0).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export const WARNING_DAYS: WarningDays[] = [3, 7, 14, 30];
// "Use within" choices after opening, in days.
export const OPEN_DAY_CHOICES = [1, 2, 3, 5, 7, 14, 30, 60, 90];
// Typical use-within periods once opened, for the built-ins: fresh food and
// dairy keep days, pantry jars weeks, medicine and toiletries months.
export const OPEN_DAYS_DEFAULT: Record<string, number> = { food: 3, pantry: 30, medicine: 90, household: 90, skincare: 90 };
export const OPEN_DAYS_FALLBACK = 7;

// The warning period that applies to one category: its own, else the general one.
export function warningFor(settings: Pick<Settings, 'warningDays' | 'categoryWarning'>, category: string): number {
  return settings.categoryWarning[category] ?? settings.warningDays;
}

// How long an opened product of this category stays good, in days.
export function openDaysFor(settings: Pick<Settings, 'openDays'>, category: string): number {
  return settings.openDays[category] ?? OPEN_DAYS_DEFAULT[category] ?? OPEN_DAYS_FALLBACK;
}
export const DATE_FORMATS: DateFormat[] = ['DMY', 'MDY', 'YMD'];
export const SORT_ORDERS: SortOrder[] = ['expiry', 'added', 'name'];
export const THEME_MODES: ThemeMode[] = ['dark', 'light', 'system'];
export const PAD_LAYOUTS: PadLayout[] = ['basic', 'compact', 'detailed'];
export const PAD_LAYOUT_LABELS: Record<PadLayout, string> = { basic: 'Basic', compact: 'Compact', detailed: 'Detailed' };
export const THEME_LABELS: Record<ThemeMode, string> = { dark: 'Dark', light: 'Light', system: 'System' };

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = { DMY: 'DD/MM/YYYY', MDY: 'MM/DD/YYYY', YMD: 'YYYY-MM-DD' };

// The day/month order the scanner should assume for an ambiguous numeric date
// (03/04/2026). The user's Date format setting decides when it names an order
// (DD/MM or MM/DD); YMD says nothing about day/month order, so the caller's
// fallback (usually the device region's habit) wins.
export function dayOrderForFormat(format: DateFormat, fallback: DayOrder): DayOrder {
  return format === 'DMY' || format === 'MDY' ? format : fallback;
}

export const SORT_LABELS: Record<SortOrder, string> = { expiry: 'Expiry date', added: 'Recently added', name: 'Product name' };

export function reminderLeadLabel(lead: ReminderLead) {
  return lead === 0 ? 'On the expiry day' : lead === 1 ? '1 day before' : `${lead} days before`;
}

export function defaultSettings(dayOrder: 'DMY' | 'MDY' = 'DMY'): Settings {
  return {
    reminders: true,
    reminderLead: 1,
    reminderHour: 9,
    dailySummary: false,
    wasteAware: true,
    theme: 'dark',
    compact: false,
    padLayout: 'compact',
    animations: true,
    scanLineAnimation: true,
    warningDays: 3,
    dateFormat: dayOrder,
    sort: 'expiry',
    showExpired: true,
    defaultCategory: 'last',
    autoShoppingList: true,
    categoryWarning: {},
    openDays: {},
  };
}

// Takes whatever was stored and keeps only valid values, so an old or damaged entry
// falls back to the defaults field by field instead of breaking the app.
export function sanitizeSettings(raw: unknown, defaults: Settings, categories: readonly string[]): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof Settings) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (defaults[k] as boolean));
  const oneOf = <T,>(k: keyof Settings, options: readonly T[]) => (options.includes(r[k] as T) ? (r[k] as T) : (defaults[k] as T));
  return {
    reminders: bool('reminders'),
    reminderLead: oneOf('reminderLead', REMINDER_LEADS),
    reminderHour: oneOf('reminderHour', REMINDER_HOURS),
    dailySummary: bool('dailySummary'),
    wasteAware: bool('wasteAware'),
    theme: oneOf('theme', THEME_MODES),
    compact: bool('compact'),
    // The old Compact rows switch (before the Layout choice) becomes Detailed.
    padLayout: PAD_LAYOUTS.includes(r.padLayout as PadLayout) ? (r.padLayout as PadLayout) : r.compact === true ? 'detailed' : defaults.padLayout,
    animations: bool('animations'),
    scanLineAnimation: bool('scanLineAnimation'),
    warningDays: oneOf('warningDays', WARNING_DAYS),
    dateFormat: oneOf('dateFormat', DATE_FORMATS),
    sort: oneOf('sort', SORT_ORDERS),
    showExpired: bool('showExpired'),
    defaultCategory: oneOf('defaultCategory', ['last', ...categories] as DefaultCategory[]),
    autoShoppingList: bool('autoShoppingList'),
    categoryWarning: idMap(r.categoryWarning, (v): v is WarningDays => WARNING_DAYS.includes(v as WarningDays)),
    openDays: idMap(r.openDays, (v): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 365),
  };
}

// A stored { categoryId: value } map, keeping only the valid entries.
function idMap<T>(raw: unknown, valid: (v: unknown) => v is T): Record<string, T> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(raw)) if (k.length > 0 && k.length <= 40 && valid(v)) out[k] = v;
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

// Dates are stored as YYYY-MM-DD and only formatted here, for display.
// Month-only dates show the month and year alone.
export function formatDisplayDate(iso: string, precision: 'day' | 'month', format: DateFormat) {
  const [y, m, d] = iso.split('-').map(Number);
  if (precision === 'month') return format === 'YMD' ? `${y}-${pad(m)}` : `${pad(m)}/${y}`;
  if (format === 'YMD') return `${y}-${pad(m)}-${pad(d)}`;
  if (format === 'MDY') return `${pad(m)}/${pad(d)}/${y}`;
  return `${pad(d)}/${pad(m)}/${y}`;
}

function daysBetween(iso: string, today: Date) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
}

export function sortItems(items: Item[], order: SortOrder) {
  const list = [...items];
  if (order === 'name') list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.expiresOn.localeCompare(b.expiresOn));
  else if (order === 'added') list.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.expiresOn.localeCompare(b.expiresOn));
  else list.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.name.localeCompare(b.name));
  return list;
}

export type ExpiryStatus = 'expired' | 'soon' | 'ok';

// "soon" covers today through the warning period.
export function expiryStatus(iso: string, warningDays: number, today = new Date()): ExpiryStatus {
  const days = daysBetween(iso, today);
  return days < 0 ? 'expired' : days <= warningDays ? 'soon' : 'ok';
}

// The day a reminder for this item is due (YYYY-MM-DD).
export function reminderDate(iso: string, lead: ReminderLead) {
  const [y, m, d] = iso.split('-').map(Number);
  const r = new Date(Date.UTC(y, m - 1, d - lead));
  return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
}

// Items whose reminder day has arrived: expired items, and items within the reminder lead time.
export function remindersDue(items: Item[], lead: ReminderLead, today = new Date()) {
  return items.filter((i) => daysBetween(i.expiresOn, today) <= lead);
}

const EXPORT_FIELDS = ['name', 'category', 'expiresOn', 'datePrecision', 'addedAt', 'source'] as const;

export function itemsToJson(items: Item[], exportedAt: Date, appVersion: string) {
  return JSON.stringify(
    {
      app: 'Prexpire',
      appVersion,
      exportedAt: exportedAt.toISOString(),
      itemCount: items.length,
      items: items.map((i) => Object.fromEntries(EXPORT_FIELDS.map((f) => [f, i[f]]))),
    },
    null,
    2,
  );
}

// RFC 4180 quoting. Cells that a spreadsheet would run as a formula get a leading apostrophe.
function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function itemsToCsv(items: Item[], categoryNames: Record<string, string>) {
  const header = ['Name', 'Category', 'Expires on', 'Date precision', 'Added at', 'Source'];
  const rows = items.map((i) => [i.name, categoryNames[i.category] ?? i.category, i.expiresOn, i.datePrecision, i.addedAt, i.source]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function exportFileName(ext: 'json' | 'csv', now: Date) {
  return `prexpire-items-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${ext}`;
}
