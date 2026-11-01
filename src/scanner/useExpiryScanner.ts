import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { parseExpiry, type DayOrder, type ScanParseResult } from './dateParser';
import { missHint, settleHint, type ScanHint } from './scanFeedback';
import type { FrameGeometry, FrameReading, ScannerCameraHandle } from './ScannerCamera.types';

export type Detection = Extract<ScanParseResult, { kind: 'found' }>;

export type { ScanHint };

export type ScannerState = { status: 'scanning'; hint: ScanHint } | { status: 'detected'; detection: Detection };

type Options = {
  camera: RefObject<ScannerCameraHandle | null>;
  // Size of the camera view and the frame inside it, in the same coordinates. Read on each pass.
  geometry: RefObject<FrameGeometry | null>;
  // False while the camera is not ready, the app is in the background, or OCR is unavailable.
  enabled: boolean;
  // ALSO decode product barcodes each pass (the optional product stage). Date
  // reading NEVER waits on them: a decoded code is reported through onBarcode
  // and the caller looks the product up in the background while this loop keeps
  // reading the expiry date, so scanning a date works with no barcode at all.
  readBarcodes: boolean;
  // A product barcode was read inside the frame. Called once per code (the
  // camera deduplicates repeats); the caller's lookup runs in parallel and
  // must never pause this loop.
  onBarcode?: (code: string) => void;
  // Day/month order for ambiguous numeric dates (03/04/2026). The caller
  // derives it from the user's Date format setting — see
  // preferences.dayOrderForFormat — so a scan agrees with how the user writes
  // and reads dates instead of the device region's habit.
  preferredOrder: DayOrder;
};

// Pause between passes. Each pass grabs one frame, crops it to the scanning frame and reads it
// on the device, so frames are sampled about once a second instead of analysing every one.
// Passes never overlap: the next is scheduled only after the previous one finishes.
const PASS_GAP_MS = 450;
// A date has to be read the same way in two of the last three passes before it counts.
const AGREEMENT_WINDOW = 3;
const AGREEMENT_NEEDED = 2;
// Misses before the loop gives its final verdict: roughly 20 seconds of live
// scanning with no confirmed date. From that point the hint says plainly
// that recognition did not work and manual entry is the way forward — the
// manual buttons are on screen from the start, so this only puts the failing
// recognition into words instead of leaving the user scanning forever.
const STUCK_MISSES = 14;

export function useExpiryScanner({ camera, geometry, enabled, readBarcodes, onBarcode, preferredOrder }: Options) {
  const [state, setState] = useState<ScannerState>({ status: 'scanning', hint: 'aim' });
  const stateRef = useRef(state);
  const history = useRef<(string | null)[]>([]);
  const misses = useRef(0);
  // What the previous passes saw, for the guidance (scanFeedback.missHint):
  // consecutive text-less passes, whether the last pass read text, and the
  // previous pass's candidate hint (a new hint must repeat before it shows).
  const noTextStreak = useRef(0);
  const lastText = useRef(false);
  const lastCandidate = useRef<ScanHint | null>(null);
  // Bumped by reset() so a pass that was already running when the user tapped "Scan again"
  // cannot publish a stale detection.
  const generation = useRef(0);

  // Only re-render when what the user sees changes.
  const publish = useCallback((next: ScannerState) => {
    const prev = stateRef.current;
    if (prev.status === next.status && (next.status === 'detected' || (prev.status === 'scanning' && prev.hint === next.hint))) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const reset = useCallback(() => {
    generation.current += 1;
    history.current = [];
    misses.current = 0;
    noTextStreak.current = 0;
    lastText.current = false;
    lastCandidate.current = null;
    stateRef.current = { status: 'scanning', hint: 'aim' };
    setState(stateRef.current);
  }, []);

  const detected = state.status === 'detected';
  // The loop's latest callbacks, so a pass never calls a stale listener.
  const listeners = useRef({ onBarcode });
  listeners.current = { onBarcode };

  useEffect(() => {
    if (!enabled || detected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gen = generation.current;
    const order = preferredOrder;

    const pass = async () => {
      const cam = camera.current;
      if (!cam) return schedule();
      let reading: FrameReading | null = null;
      let failed = false;
      try {
        // The frame IS the region of interest: the camera crops to the frame's
        // exact coordinates, so only content inside the brackets is read. Text
        // (the expiry date) is ALWAYS read; barcodes ride along in the same
        // pass so the product stage never delays or blocks the date. The
        // caller's day/month order rides along so the camera layer can stop
        // after its first preprocessing variant when that already read a date.
        reading = await cam.readFrame(geometry.current, { text: true, barcode: readBarcodes, preferredOrder: order });
      } catch {
        // Capture can fail while the camera is reconfiguring (rotation, backgrounding).
        failed = true;
      }
      if (cancelled || gen !== generation.current) return;

      // A decoded barcode is handed to the caller (its own dedupe keeps repeats
      // quiet) and the loop CONTINUES: the product lookup happens in the
      // background while date scanning keeps running.
      if (readBarcodes && reading?.barcode) listeners.current.onBarcode?.(reading.barcode);

      const lines = reading?.lines ?? [];
      const result: ScanParseResult | null = reading ? parseExpiry(lines, { today: new Date(), preferredOrder: order }) : null;
      if (result?.kind === 'found') {
        const h = [...history.current, result.key].slice(-AGREEMENT_WINDOW);
        history.current = h;
        if (h.filter((k) => k === result.key).length >= AGREEMENT_NEEDED) {
          publish({ status: 'detected', detection: result });
          return;
        }
        misses.current = 0;
        noTextStreak.current = 0;
        lastText.current = true;
        lastCandidate.current = 'hold-steady';
        publish({ status: 'scanning', hint: 'hold-steady' });
      } else {
        history.current = [...history.current, null].slice(-AGREEMENT_WINDOW);
        misses.current += 1;
        noTextStreak.current = lines.length ? 0 : noTextStreak.current + 1;
        // The guidance follows what THIS pass observed (scanFeedback.ts):
        // light, distance, steadiness, a production date, a date-shaped
        // number that would not read — and, after ~20 seconds, the plain
        // verdict pointing at the manual buttons (always on screen). A re-aim
        // that reads a date, or "Scan again", resets the counter.
        const candidate = missHint({
          misses: misses.current,
          stuckAfter: STUCK_MISSES,
          failed: failed || !reading,
          lines,
          hadText: lastText.current,
          noTextStreak: noTextStreak.current,
          dark: reading?.dark,
          parseHint: result?.kind === 'none' ? result.hint : undefined,
          recentDate: history.current.some((k) => k !== null),
        });
        lastText.current = lines.length > 0;
        const shown = stateRef.current.status === 'scanning' ? stateRef.current.hint : 'aim';
        publish({ status: 'scanning', hint: settleHint(shown, candidate, lastCandidate.current) });
        lastCandidate.current = candidate;
      }
      schedule();
    };

    const schedule = () => {
      if (!cancelled) timer = setTimeout(pass, PASS_GAP_MS);
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, detected, readBarcodes, camera, geometry, publish, preferredOrder]);

  return { state, reset };
}
