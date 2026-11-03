// A full backup of everything Prexpire stores (items, categories, settings,
// the Shopping List, the history behind the stats): every "prexpire." key, as
// one JSON file the user keeps. Restoring writes those keys back. Pure logic,
// no React Native imports, so it is tested with Node on its own.

export const BACKUP_PREFIX = 'prexpire.';
const KIND = 'prexpire-backup';

export type BackupData = Record<string, string>;

export function buildBackup(entries: readonly (readonly [string, string | null])[], appVersion: string, now: Date): string {
  const data: BackupData = {};
  for (const [k, v] of entries) if (k.startsWith(BACKUP_PREFIX) && typeof v === 'string') data[k] = v;
  return JSON.stringify({ app: 'Prexpire', kind: KIND, version: 1, appVersion, createdAt: now.toISOString(), data });
}

export type ParsedBackup = { ok: true; data: BackupData; createdAt: string | null; items: number } | { ok: false; reason: string };

// Reads a backup file. Only "prexpire." keys with text values are taken, and
// each must itself be valid JSON (every stored value is), so a damaged or
// foreign file is refused as a whole rather than half restored.
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'This file is not a Prexpire backup.' };
  }
  const r = raw as { kind?: unknown; data?: unknown; createdAt?: unknown };
  if (!r || r.kind !== KIND || !r.data || typeof r.data !== 'object' || Array.isArray(r.data)) {
    return { ok: false, reason: 'This file is not a Prexpire backup.' };
  }
  const data: BackupData = {};
  for (const [k, v] of Object.entries(r.data as Record<string, unknown>)) {
    if (!k.startsWith(BACKUP_PREFIX) || typeof v !== 'string') continue;
    try {
      JSON.parse(v);
    } catch {
      // A bare string value (the remembered category) is stored unquoted.
      if (!/^[\w-]{1,40}$/.test(v)) return { ok: false, reason: 'This backup is damaged and was not restored.' };
    }
    data[k] = v;
  }
  if (!Object.keys(data).length) return { ok: false, reason: 'This backup is empty.' };
  let items = 0;
  try {
    const list: unknown = data['prexpire.items.v1'] ? JSON.parse(data['prexpire.items.v1']) : [];
    items = Array.isArray(list) ? list.length : 0;
  } catch {
    items = 0;
  }
  return { ok: true, data, createdAt: typeof r.createdAt === 'string' ? r.createdAt : null, items };
}

export function backupFileName(now: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `prexpire-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}
