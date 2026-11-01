import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { parseExpiry, type DayOrder, type ScanParseResult } from './dateParser';
import type { FrameGeometry, FrameReading, ScannerCameraHandle } from './ScannerCamera.types';

export type Detection = Extract<ScanParseResult, { kind: 'found' }>;

export type ScanHint = 'aim' | 'text-found' | 'low-light' | 'closer' | 'manufacture' | 'unclear' | 'hold-steady' | 'ocr-error' | 'manual';

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
// Misses before a hint replaces "Keep the date inside the frame".
const MISSES_BEFORE_HINT = 3;
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
  // True once the date stage has failed for long enough (STUCK_MISSES passes)
  // that the "Date not recognized" verdict should show. Kept as a ref so the
  // pass closure and reset() always touch the same flag without resubscribing
  // the loop.
  const stuckRef = useRef(false);
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
    stuckRef.current = false;
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
        publish({ status: 'scanning', hint: 'hold-steady' });
      } else {
        history.current = [...history.current, null].slice(-AGREEMENT_WINDOW);
        misses.current += 1;
        if (misses.current >= STUCK_MISSES) {
          // Automatic recognition has had its fair chance: the verdict says so
          // plainly and points at the manual buttons (always on screen). A
          // re-aim or "Scan again" resets the counter, so the message only
          // stays while the same hopeless aim is held.
          if (!stuckRef.current) stuckRef.current = true;
          publish({ status: 'scanning', hint: 'manual' });
          schedule();
          return;
        }
        if (misses.current >= MISSES_BEFORE_HINT) {
          // The IMAGE's own brightness first (measured by the camera layer),
          // then the no-text proxy: a dark frame that still reads fragments
          // of text needs LIGHT, not a steadier aim.
          const hint: ScanHint = failed
            ? 'ocr-error'
            : reading?.dark || result?.hint === 'no-text'
              ? 'low-light'
              : result?.hint === 'manufacture-only'
                ? 'manufacture'
                : result?.hint === 'invalid-date'
                  ? 'unclear'
                  : 'closer';
          publish({ status: 'scanning', hint });
        } else if (result?.kind === 'none' && result.hint === 'no-date') {
          // Text was read but none of it is a date yet.
          publish({ status: 'scanning', hint: 'text-found' });
        } else if (stateRef.current.status === 'scanning' && stateRef.current.hint === 'hold-steady') {
          publish({ status: 'scanning', hint: 'aim' });
        }
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
