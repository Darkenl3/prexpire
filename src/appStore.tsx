import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './components/BottomSheet';
import { PressScale } from './components/Press';
import { makeStyles, useTheme } from './theme';

// The App Store, from the website part of the iPhone app (window.__prexpireStore):
//
//  • Rating: Apple's own "Enjoying Prexpire?" star prompt, asked only after
//    real use and at a good moment (just after an item is saved or used up),
//    never at launch. iOS itself shows it at most 3 times a year.
//  • Updates: once a day the app compares its version with the App Store's.
//    A newer one is announced once (UpdateNotice), and Settings keeps an
//    "Update available" row (useStoreUpdate) until it's installed.

type Shell = { postMessage?: (d: string) => void };
const shell = (): Shell | undefined =>
  Platform.OS === 'web' && typeof window !== 'undefined' && (window as { __prexpireStore?: number }).__prexpireStore
    ? (window as { ReactNativeWebView?: Shell }).ReactNativeWebView
    : undefined;
function send(msg: object) {
  try {
    shell()?.postMessage?.(JSON.stringify(msg));
  } catch {}
}
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- Rating ----------

const USE_KEY = 'prexpire.usage.v1'; // { first: day, days: [recent days used] }
const ASKED_KEY = 'prexpire.ratingAsked.v1'; // last time asked (ms)
const MIN_AGE_DAYS = 5;
const MIN_DAYS_USED = 4;
const MIN_ITEMS = 8;
const ASK_EVERY_DAYS = 120;

type Use = { first: string; days: string[] };

// Called when the app opens: remembers which days it was used.
export function noteAppUsed() {
  const day = today();
  const use = read<Use>(USE_KEY, { first: day, days: [] });
  if (!use.days.includes(day)) use.days = [...use.days, day].slice(-30);
  write(USE_KEY, use);
}

// Called at a good moment (an item saved, an item used up). itemsAdded: how
// many items this person has added in total (list + history).
export function maybeAskForRating(itemsAdded: number) {
  if (!shell()) return;
  const use = read<Use | null>(USE_KEY, null);
  if (!use) return;
  const ageDays = (Date.parse(today()) - Date.parse(use.first)) / 86400000;
  if (ageDays < MIN_AGE_DAYS || use.days.length < MIN_DAYS_USED || itemsAdded < MIN_ITEMS) return;
  const last = read<number>(ASKED_KEY, 0);
  if (Date.now() - last < ASK_EVERY_DAYS * 86400000) return;
  write(ASKED_KEY, Date.now());
  // A moment after the save confirmation, so the two never overlap.
  setTimeout(() => send({ type: 'rate-request' }), 1600);
}

// ---------- Updates ----------

export type StoreUpdate = { version: string; url: string; notes: string | null };
const CHECKED_KEY = 'prexpire.updateChecked.v1'; // day of the last check
const FOUND_KEY = 'prexpire.updateFound.v1'; // the last update found
const SHOWN_KEY = 'prexpire.updateShown.v1'; // the version already announced

let current: StoreUpdate | null = null;
const listeners = new Set<(u: StoreUpdate | null) => void>();
function setUpdate(u: StoreUpdate | null) {
  current = u;
  write(FOUND_KEY, u);
  listeners.forEach((f) => f(u));
}

// Once a day (and on the first open): ask the app to compare with the store.
export function checkForUpdate(force = false) {
  if (!shell()) return;
  if (current === null) current = read<StoreUpdate | null>(FOUND_KEY, null);
  if (!force && read<string>(CHECKED_KEY, '') === today()) {
    listeners.forEach((f) => f(current));
    return;
  }
  const on = (e: Event) => {
    window.removeEventListener('prexpire:update', on);
    write(CHECKED_KEY, today());
    setUpdate((e as CustomEvent<{ update?: StoreUpdate | null }>).detail?.update ?? null);
  };
  window.addEventListener('prexpire:update', on);
  send({ type: 'update-check' });
}

export function openStore(url: string) {
  send({ type: 'open-store', url });
}

export function useStoreUpdate(): StoreUpdate | null {
  const [u, setU] = useState<StoreUpdate | null>(() => current ?? read<StoreUpdate | null>(FOUND_KEY, null));
  useEffect(() => {
    listeners.add(setU);
    return () => {
      listeners.delete(setU);
    };
  }, []);
  return shell() ? u : null;
}

// The one-time announcement of a new version.
export function UpdateNotice() {
  const c = useTheme();
  const s = useStyles();
  const update = useStoreUpdate();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (update && read<string>(SHOWN_KEY, '') !== update.version) {
      const t = setTimeout(() => setOpen(true), 1200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [update]);
  if (!update) return null;
  const close = () => {
    write(SHOWN_KEY, update.version);
    setOpen(false);
  };
  return (
    <BottomSheet visible={open} onClose={close} title="Update available" scrollable maxWidth={460}>
      <View style={s.body}>
        <View style={s.badge}>
          <Ionicons name="arrow-up-circle" size={40} color={c.green} />
        </View>
        <Text style={s.lede}>Prexpire {update.version} is on the App Store.</Text>
        {update.notes ? <Text style={s.notes}>{update.notes}</Text> : null}
        <PressScale
          onPress={() => {
            close();
            openStore(update.url);
          }}
          scaleTo={0.97}
          accessibilityRole="button"
          accessibilityLabel="Update in the App Store"
          style={s.primary}
        >
          <Text style={s.primaryText}>Update in the App Store</Text>
        </PressScale>
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((c) => ({
  body: { gap: 12, paddingTop: 4, paddingBottom: 8 },
  badge: { alignItems: 'center', paddingVertical: 4 },
  lede: { color: c.textBody, fontSize: 15.5, lineHeight: 21, textAlign: 'center' },
  notes: { color: c.textMuted, fontSize: 14, lineHeight: 20 },
  primary: { height: 54, borderRadius: 16, backgroundColor: c.mint, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: c.scanInk, fontSize: 16.5, fontWeight: '800' },
}));
