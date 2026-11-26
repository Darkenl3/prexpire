import { useEffect } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';

// Total time in the app, for the admin page (supabase/005_time_in_app.sql).
// Counts only while the app is on screen: not in the background, not while
// the phone is locked. The seconds wait here and are added to the account's
// total in batches: when the app goes to the background, or at most every
// 15 minutes while it stays open. Nothing else is recorded: no screens, no
// taps, no times of day.

const TICK_MS = 15_000;
const MAX_STEP_S = 30; // a gap longer than this (sleep, a stuck timer) counts as 30 s at most
const FLUSH_EVERY_MS = 15 * 60_000;
const BATCH_MAX_S = 900; // the server caps each batch at this too

const onScreen = () =>
  AppState.currentState === 'active' && (typeof document === 'undefined' || document.visibilityState === 'visible');

export function useTimeInApp(supabase: SupabaseClient, userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;
    const key = `prexpire.timeInApp.${userId}`;
    let pending = 0;
    let last = Date.now();
    let lastFlush = Date.now();
    let sending = false;
    let alive = true;

    AsyncStorage.getItem(key)
      .then((v) => {
        const saved = Number(v);
        if (alive && Number.isFinite(saved) && saved > 0) pending += Math.min(saved, BATCH_MAX_S * 4);
      })
      .catch(() => {});

    const save = () => AsyncStorage.setItem(key, String(Math.round(pending))).catch(() => {});

    const count = () => {
      const now = Date.now();
      if (onScreen()) pending += Math.min((now - last) / 1000, MAX_STEP_S);
      last = now;
    };

    const flush = async () => {
      if (sending || pending < 5) return;
      sending = true;
      const batch = Math.min(Math.round(pending), BATCH_MAX_S);
      try {
        const { error } = await supabase.rpc('add_time_in_app', { seconds: batch });
        if (!error) {
          pending = Math.max(0, pending - batch);
          lastFlush = Date.now();
        }
      } catch {
        // Offline: the seconds stay here and go with the next batch.
      } finally {
        sending = false;
        save();
      }
    };

    const timer = setInterval(() => {
      count();
      save();
      if (Date.now() - lastFlush >= FLUSH_EVERY_MS) void flush();
    }, TICK_MS);

    const leave = () => {
      count();
      void flush();
    };
    const back = () => {
      last = Date.now();
    };
    const app = AppState.addEventListener('change', (s) => (s === 'active' ? back() : leave()));
    const vis = () => (typeof document !== 'undefined' && document.visibilityState === 'visible' ? back() : leave());
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', vis);

    return () => {
      alive = false;
      clearInterval(timer);
      app.remove();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', vis);
      count();
      void flush();
    };
  }, [supabase, userId]);
}
