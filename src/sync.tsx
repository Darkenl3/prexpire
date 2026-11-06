import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, useAuth } from './auth';

// Backup and sync for signed-in people. The app stays local-first: everything
// lives on the phone exactly as before, and this keeps a copy in Supabase
// (public.records, one row per thing, readable only by its owner through Row
// Level Security) and brings changes made on another phone back here.
//
// It works at the storage level, under the app's own providers:
//   • items and shopping entries sync one by one (kind 'item' / 'shopping');
//   • small whole documents sync as a unit (kind 'doc': categories, their
//     names/order/hidden list, settings, the shopping list's expiry events,
//     and the waste-stats history, which is MERGED so two phones' stats add up).
// A change is noticed when it's saved (the storage calls are watched) and
// sent a few seconds later. Remote changes are written into storage and the
// providers reload (a remount, `generation`).
//
// Conflicts: if the same thing changed here and elsewhere since the last
// sync, the newer change wins. Deletions sync too. Offline, nothing breaks:
// the next sync catches up.

const ITEMS_KEY = 'prexpire.items.v1';
const SHOPPING_KEY = 'prexpire.shopping.v1';
const HISTORY_KEY = 'prexpire.history.v1';
const DOC_KEYS = [
  'prexpire.categories.v1',
  'prexpire.categoriesRemoved.v1',
  'prexpire.categoryNames.v1',
  'prexpire.categoryOrder.v1',
  'prexpire.settings.v1',
  'prexpire.expevents.v1',
  HISTORY_KEY,
];
const LIST_KEYS: Record<string, 'item' | 'shopping'> = { [ITEMS_KEY]: 'item', [SHOPPING_KEY]: 'shopping' };
const WATCHED = new Set([ITEMS_KEY, SHOPPING_KEY, ...DOC_KEYS]);
const stateKey = (userId: string) => `prexpire.sync.v2:${userId}`;
const PUSH_DELAY = 3000;

type SyncState = {
  // What each record looked like at the last sync (by content hash), so a
  // difference means "changed here since".
  base: Record<string, string>;
  // When a local change was first noticed (for conflicts).
  dirtyAt: Record<string, string>;
  // The newest server timestamp seen: the next pull starts there.
  cursor: string | null;
  lastSyncAt: string | null;
};
type Row = { user_id: string; kind: string; id: string; data: unknown; deleted: boolean; updated_at: string };
type Local = Map<string, { kind: string; id: string; data: unknown; hash: string }>;

const recKey = (kind: string, id: string) => `${kind}:${id}`;

function hash(value: unknown): string {
  const s = JSON.stringify(value) ?? '';
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}.${(h >>> 0).toString(36)}`;
}

function parse(raw: string | null): unknown {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function readLocal(): Promise<Local> {
  const keys = [ITEMS_KEY, SHOPPING_KEY, ...DOC_KEYS];
  const pairs = await AsyncStorage.multiGet(keys);
  const out: Local = new Map();
  for (const [key, raw] of pairs) {
    const value = parse(raw);
    if (LIST_KEYS[key]) {
      if (!Array.isArray(value)) continue;
      for (const rec of value as { id?: unknown }[]) {
        if (!rec || typeof rec.id !== 'string') continue;
        out.set(recKey(LIST_KEYS[key], rec.id), { kind: LIST_KEYS[key], id: rec.id, data: rec, hash: hash(rec) });
      }
    } else if (value !== undefined) {
      out.set(recKey('doc', key), { kind: 'doc', id: key, data: value, hash: hash(value) });
    }
  }
  return out;
}

// Two phones' waste-stats histories, joined without duplicates, newest last.
function mergeHistory(a: unknown, b: unknown): unknown[] {
  const seen = new Map<string, unknown>();
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue;
    for (const e of list as { at?: string; kind?: string; name?: string }[]) {
      if (e && typeof e.at === 'string') seen.set(`${e.at}|${e.kind}|${e.name}`, e);
    }
  }
  return [...seen.values()].sort((x, y) => String((x as { at: string }).at).localeCompare(String((y as { at: string }).at))).slice(-3000);
}

// Writes remote changes into storage. Returns true when anything changed.
async function applyRemote(rows: Row[], local: Local): Promise<boolean> {
  if (!rows.length) return false;
  const lists: Record<string, Map<string, unknown> | null> = { [ITEMS_KEY]: null, [SHOPPING_KEY]: null };
  const docs: [string, string][] = [];
  const removeDocs: string[] = [];
  for (const row of rows) {
    if (row.kind === 'doc') {
      if (row.deleted) removeDocs.push(row.id);
      else {
        const value = row.id === HISTORY_KEY ? mergeHistory(local.get(recKey('doc', HISTORY_KEY))?.data, row.data) : row.data;
        docs.push([row.id, JSON.stringify(value)]);
      }
      continue;
    }
    const storage = row.kind === 'item' ? ITEMS_KEY : row.kind === 'shopping' ? SHOPPING_KEY : null;
    if (!storage) continue;
    if (!lists[storage]) {
      const current = parse(await AsyncStorage.getItem(storage));
      lists[storage] = new Map((Array.isArray(current) ? (current as { id: string }[]) : []).filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]));
    }
    const map = lists[storage]!;
    if (row.deleted) map.delete(row.id);
    else map.set(row.id, row.data);
  }
  const writes: [string, string][] = [...docs];
  for (const [storage, map] of Object.entries(lists)) if (map) writes.push([storage, JSON.stringify([...map.values()])]);
  watching.paused = true;
  try {
    if (writes.length) await AsyncStorage.multiSet(writes);
    if (removeDocs.length) await AsyncStorage.multiRemove(removeDocs);
  } finally {
    watching.paused = false;
  }
  return writes.length > 0 || removeDocs.length > 0;
}

// Storage writes to synced keys schedule a push. Patched once, at load.
const watching = { paused: false, listeners: new Set<() => void>() };
(function watchStorage() {
  const store = AsyncStorage as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const wrap = (name: string, touches: (args: unknown[]) => boolean) => {
    const original = store[name];
    if (typeof original !== 'function') return;
    store[name] = async (...args: unknown[]) => {
      const out = await original.apply(AsyncStorage, args);
      if (!watching.paused && touches(args)) watching.listeners.forEach((f) => f());
      return out;
    };
  };
  wrap('setItem', (a) => WATCHED.has(String(a[0])));
  wrap('removeItem', (a) => WATCHED.has(String(a[0])));
  wrap('multiSet', (a) => Array.isArray(a[0]) && (a[0] as [string, string][]).some((p) => WATCHED.has(p[0])));
  wrap('multiRemove', (a) => Array.isArray(a[0]) && (a[0] as string[]).some((k) => WATCHED.has(k)));
})();

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';
type SyncContext = {
  status: SyncStatus;
  lastSyncAt: string | null;
  syncNow: () => Promise<void>;
  generation: number;
  // Signs out and takes the account's data off this phone (it stays in the
  // account and comes back on the next sign-in). Backs up first; resolves
  // with a sentence when that couldn't happen, and then nothing is removed.
  signOutAndClear: () => Promise<string | null>;
  // Set when the signed-in account is scheduled for deletion: the date (ISO)
  // it goes for good. Sync stays off until the person restores it.
  pendingDeletion: string | null;
  // Schedules deletion (30 days), then signs out and clears this phone.
  deleteAccount: () => Promise<string | null>;
  // Cancels the scheduled deletion; sync carries on as before.
  restoreAccount: () => Promise<string | null>;
  // Leaves the scheduled deletion in place and signs out.
  keepDeleted: () => Promise<void>;
  // Just deleted on this phone: the date (ISO) it goes for good, for the
  // confirmation shown after signing out. Cleared by dismissing it.
  deletedNotice: string | null;
  dismissDeletedNotice: () => void;
};
const Ctx = createContext<SyncContext>({
  status: 'off',
  lastSyncAt: null,
  syncNow: async () => {},
  generation: 0,
  signOutAndClear: async () => null,
  pendingDeletion: null,
  deleteAccount: async () => null,
  restoreAccount: async () => null,
  keepDeleted: async () => {},
  deletedNotice: null,
  dismissDeletedNotice: () => {},
});

const OFFLINE_DELETE = "You're offline. Connect to the internet to delete your account.";
const isNetwork = (e: unknown) => /fetch|network|load failed/i.test(String((e as { message?: string })?.message ?? e));

// When the signed-in account will be deleted for good, or null. A server
// without the deletion functions yet (002 not run) counts as "not scheduled".
async function deletionStatus(): Promise<string | null> {
  const { data, error } = await supabase.rpc('account_deletion_status');
  if (error) {
    if (isNetwork(error)) throw error;
    return null;
  }
  return typeof data === 'string' ? data : null;
}

// What belongs to the account, removed from the phone on sign-out. Settings
// (theme, date format…) are this phone's preferences and stay.
const ACCOUNT_KEYS = [ITEMS_KEY, SHOPPING_KEY, HISTORY_KEY, ...DOC_KEYS.filter((k) => k !== 'prexpire.settings.v1'), 'prexpire.lastCategory.v1'];

export function SyncProvider({ children }: { children: (generation: number) => ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [status, setStatus] = useState<SyncStatus>('off');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [pendingDeletion, setPendingDeletion] = useState<string | null>(null);
  const [deletedNotice, setDeletedNotice] = useState<string | null>(null);
  const dismissDeletedNotice = useCallback(() => setDeletedNotice(null), []);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runOnce = useCallback(async (uid: string) => {
    const saved = parse(await AsyncStorage.getItem(stateKey(uid))) as SyncState | undefined;
    const state: SyncState = saved && typeof saved === 'object' ? { base: saved.base ?? {}, dirtyAt: saved.dirtyAt ?? {}, cursor: saved.cursor ?? null, lastSyncAt: saved.lastSyncAt ?? null } : { base: {}, dirtyAt: {}, cursor: null, lastSyncAt: null };
    const now = new Date().toISOString();
    let local = await readLocal();

    // Note when local changes were first seen (for conflicts).
    for (const [k, rec] of local) if (state.base[k] !== rec.hash && !state.dirtyAt[k]) state.dirtyAt[k] = now;
    for (const k of Object.keys(state.base)) if (!local.has(k) && !state.dirtyAt[k]) state.dirtyAt[k] = now;

    // 1. Pull what changed elsewhere since the last sync.
    const incoming: Row[] = [];
    let from = state.cursor;
    for (let page = 0; page < 50; page++) {
      let q = supabase.from('records').select('user_id,kind,id,data,deleted,updated_at').order('updated_at', { ascending: true }).limit(500);
      if (from) q = q.gt('updated_at', from);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      incoming.push(...rows);
      if (rows.length < 500) break;
      from = rows[rows.length - 1].updated_at;
    }
    const accept: Row[] = [];
    let cursor = state.cursor;
    for (const row of incoming) {
      if (!cursor || row.updated_at > cursor) cursor = row.updated_at;
      const k = recKey(row.kind, row.id);
      const mine = local.get(k);
      const localChanged = mine ? state.base[k] !== mine.hash : k in state.base;
      const remoteHash = row.deleted ? null : hash(row.data);
      if (mine && remoteHash === mine.hash) {
        state.base[k] = mine.hash; // already the same
        delete state.dirtyAt[k];
        continue;
      }
      if (localChanged && !(row.id === HISTORY_KEY)) {
        // Both sides changed: the newer change wins.
        const localAt = state.dirtyAt[k] ?? now;
        if (localAt >= row.updated_at) continue; // keep ours; it's pushed below
      }
      accept.push(row);
    }
    const changedHere = await applyRemote(accept, local);
    if (changedHere) local = await readLocal();
    for (const row of accept) {
      const k = recKey(row.kind, row.id);
      const mine = local.get(k);
      // The merged history differs from the server's copy whenever this phone
      // had entries of its own: marking the server's version as the base
      // sends the merged list back up below.
      if (row.id === HISTORY_KEY && !row.deleted) state.base[k] = hash(row.data);
      else if (mine) state.base[k] = mine.hash;
      else delete state.base[k];
      delete state.dirtyAt[k];
    }

    // 2. Push what changed here.
    const upserts: Omit<Row, 'updated_at'>[] = [];
    for (const [k, rec] of local) if (state.base[k] !== rec.hash) upserts.push({ user_id: uid, kind: rec.kind, id: rec.id, data: rec.data, deleted: false });
    for (const k of Object.keys(state.base)) {
      if (local.has(k)) continue;
      const [kind, ...rest] = k.split(':');
      upserts.push({ user_id: uid, kind, id: rest.join(':'), data: null, deleted: true });
    }
    for (let i = 0; i < upserts.length; i += 200) {
      const chunk = upserts.slice(i, i + 200);
      const { data, error } = await supabase.from('records').upsert(chunk, { onConflict: 'user_id,kind,id' }).select('kind,id,deleted,updated_at');
      if (error) throw error;
      for (const r of (data ?? []) as Row[]) {
        const k = recKey(r.kind, r.id);
        if (r.deleted) delete state.base[k];
        else {
          const mine = local.get(k);
          if (mine) state.base[k] = mine.hash;
        }
        delete state.dirtyAt[k];
        if (!cursor || r.updated_at > cursor) cursor = r.updated_at;
      }
    }

    state.cursor = cursor;
    state.lastSyncAt = new Date().toISOString();
    await AsyncStorage.setItem(stateKey(uid), JSON.stringify(state));
    setLastSyncAt(state.lastSyncAt);
    if (changedHere) setGeneration((g) => g + 1);
  }, []);

  const syncNow = useCallback(async () => {
    if (!userId) return;
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const job = (async () => {
      setStatus('syncing');
      try {
        // An account waiting to be deleted is never synced: the person first
        // chooses to restore it or leave it deleted.
        const purge = await deletionStatus();
        setPendingDeletion(purge);
        if (purge) {
          setStatus('off');
          return;
        }
        do {
          again.current = false;
          await runOnce(userId);
        } while (again.current);
        setStatus('idle');
      } catch (e) {
        const msg = String((e as { message?: string })?.message ?? e).toLowerCase();
        setStatus(msg.includes('fetch') || msg.includes('network') ? 'offline' : 'error');
      } finally {
        running.current = null;
      }
    })();
    running.current = job;
    return job;
  }, [userId, runOnce]);

  // Signed in: sync now, after every local change (a few seconds later), when
  // the app comes back to the front, and when the connection returns.
  useEffect(() => {
    if (!userId) {
      setStatus('off');
      setLastSyncAt(null);
      setPendingDeletion(null);
      return;
    }
    AsyncStorage.getItem(stateKey(userId))
      .then((raw) => setLastSyncAt((parse(raw) as SyncState | undefined)?.lastSyncAt ?? null))
      .catch(() => {});
    syncNow();
    const onChange = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => syncNow(), PUSH_DELAY);
    };
    watching.listeners.add(onChange);
    const app = AppState.addEventListener('change', (s) => s === 'active' && syncNow());
    const online = () => syncNow();
    const visible = () => typeof document !== 'undefined' && document.visibilityState === 'visible' && syncNow();
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('online', online);
      document.addEventListener('visibilitychange', visible);
    }
    return () => {
      watching.listeners.delete(onChange);
      if (timer.current) clearTimeout(timer.current);
      app.remove();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('online', online);
        document.removeEventListener('visibilitychange', visible);
      }
    };
  }, [userId, syncNow]);

  const signOutAndClear = useCallback(async (): Promise<string | null> => {
    if (!userId) return null;
    if (timer.current) clearTimeout(timer.current);
    // 1. Back up whatever hasn't been sent yet, so signing out never loses it.
    if (typeof navigator !== 'undefined' && navigator.onLine === false)
      return "You're offline, and your latest changes haven't backed up yet. Connect to the internet, then sign out.";
    try {
      if (running.current) await running.current;
      await runOnce(userId);
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e).toLowerCase();
      return msg.includes('fetch') || msg.includes('network')
        ? "You're offline, and your latest changes haven't backed up yet. Connect to the internet, then sign out."
        : "Your latest changes couldn't be backed up just now. Try signing out again in a minute.";
    }
    // 2. Sign out, then 3. clear the account's data from this phone.
    await signOutClearing(userId);
    return null;
  }, [userId, runOnce]);

  // Signs out and removes the account's data from this phone, with the
  // storage watcher paused so the clearing is never synced as deletions.
  const signOutClearing = useCallback(async (uid: string) => {
    if (timer.current) clearTimeout(timer.current);
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    watching.paused = true;
    try {
      await AsyncStorage.multiRemove([...ACCOUNT_KEYS, stateKey(uid)]);
    } finally {
      watching.paused = false;
    }
    setGeneration((g) => g + 1);
  }, []);

  const deleteAccount = useCallback(async (): Promise<string | null> => {
    if (!userId) return null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE_DELETE;
    if (timer.current) clearTimeout(timer.current);
    // Back up the latest changes first, so restoring within the 30 days
    // brings back everything. A failed backup (other than being offline)
    // doesn't stop the deletion.
    try {
      if (running.current) await running.current;
      if (!pendingDeletion) await runOnce(userId);
    } catch (e) {
      if (isNetwork(e)) return OFFLINE_DELETE;
    }
    let { data: purge, error } = await supabase.rpc('request_account_deletion');
    // A server that doesn't have the 30-day functions yet (002 not run).
    if (error && !isNetwork(error) && /request_account_deletion|PGRST202|does not exist/i.test(`${error.code} ${error.message}`)) ({ error } = await supabase.rpc('delete_account')), (purge = null);
    if (error) return isNetwork(error) ? OFFLINE_DELETE : "Your account couldn't be deleted just now. Try again in a minute.";
    setPendingDeletion(null);
    setDeletedNotice(typeof purge === 'string' ? purge : new Date(Date.now() + 30 * 86_400_000).toISOString());
    await signOutClearing(userId);
    return null;
  }, [userId, runOnce, pendingDeletion, signOutClearing]);

  const restoreAccount = useCallback(async (): Promise<string | null> => {
    const { error } = await supabase.rpc('cancel_account_deletion');
    if (error) return isNetwork(error) ? "You're offline. Connect to the internet to restore your account." : "Your account couldn't be restored just now. Try again in a minute.";
    setPendingDeletion(null);
    syncNow();
    return null;
  }, [syncNow]);

  const keepDeleted = useCallback(async () => {
    if (!userId) return;
    setPendingDeletion(null);
    // This phone never synced with the account in this sign-in, so what's on
    // it was there before signing in: clear only if the phone had synced
    // this account earlier (its items are the account's).
    const synced = await AsyncStorage.getItem(stateKey(userId)).catch(() => null);
    if (synced) await signOutClearing(userId);
    else await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
  }, [userId, signOutClearing]);

  const value = useMemo(
    () => ({ status, lastSyncAt, syncNow, generation, signOutAndClear, pendingDeletion, deleteAccount, restoreAccount, keepDeleted, deletedNotice, dismissDeletedNotice }),
    [status, lastSyncAt, syncNow, generation, signOutAndClear, pendingDeletion, deleteAccount, restoreAccount, keepDeleted, deletedNotice, dismissDeletedNotice],
  );
  return <Ctx.Provider value={value}>{children(generation)}</Ctx.Provider>;
}

export function useSync() {
  return useContext(Ctx);
}
