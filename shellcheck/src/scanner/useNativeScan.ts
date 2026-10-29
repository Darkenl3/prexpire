import { useCallback, useEffect, useRef, useState } from 'react';
import { getLocales } from 'expo-localization';
import { dayOrderForRegion, parseExpiry, type ScanParseResult } from './dateParser';
import { guessProduct } from './productGuess';

export type Detection = Extract<ScanParseResult, { kind: 'found' }>;

export type ScanHint = 'aim' | 'text-found' | 'low-light' | 'closer' | 'manufacture' | 'unclear' | 'hold-steady' | 'ocr-error';

export type ScannerState =
  | { status: 'scanning'; hint: ScanHint }
  | { status: 'detected'; detection: Detection; lines: string[] };

type Options = {
  // Grabs one photo and returns its OCR lines. Resolves null (never rejects)
  // when the pass failed - camera reconfiguring, OCR hiccup - so the loop
  // retries instead of dying. Provided by the scanner component.
  capture: () => Promise<string[] | null>;
  // False while the camera is not ready, the app is backgrounded, the panel is
  // open, or OCR is unavailable.
  enabled: boolean;
};

// The same sampling discipline as the website's scanner (its
// src/scanner/useExpiryScanner.ts): one pass every PASS_GAP_MS after the
// previous pass finished - passes never overlap - and a date only counts once
// the same reading repeats within a short window, so a single misread frame
// can never confirm itself. The native pass (photo + Apple Vision / ML Kit)
// is heavier than the web's canvas crop, so the gap is a little longer.
const PASS_GAP_MS = 600;
const AGREEMENT_WINDOW = 3;
const AGREEMENT_NEEDED = 2;
// Misses before a hint replaces "Keep the date inside the frame".
const MISSES_BEFORE_HINT = 3;
// A label-derived product name also has to repeat before it is shown, so a
// transient OCR line can't flash a wrong name into the panel.
const NAME_WINDOW = 3;
const NAME_NEEDED = 2;

export function useNativeScan({ capture, enabled }: Options) {
  const [state, setState] = useState<ScannerState>({ status: 'scanning', hint: 'aim' });
  // The stable, label-derived product name (null until it repeats).
  const [product, setProduct] = useState<string | null>(null);
  const stateRef = useRef(state);
  const history = useRef<(string | null)[]>([]);
  const names = useRef<(string | null)[]>([]);
  const misses = useRef(0);
  // Consecutive passes in which OCR read NO text at all - the only honest
  // signal for "try better lighting" (a mixed streak of other misses is not).
  const noTextStreak = useRef(0);
  // Bumped by reset() so a pass that was already running when the user tapped
  // "Scan again" cannot publish a stale detection.
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
    names.current = [];
    misses.current = 0;
    noTextStreak.current = 0;
    stateRef.current = { status: 'scanning', hint: 'aim' };
    setState(stateRef.current);
    setProduct(null);
  }, []);

  const detected = state.status === 'detected';

  useEffect(() => {
    if (!enabled || detected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const preferredOrder = dayOrderForRegion(getLocales()[0]?.regionCode);

    const pass = async () => {
      // Session identity, read fresh at pass START: a pass that began before a
      // reset gets its result dropped once; the next pass reads the new
      // generation and continues normally (the loop can never die on resets).
      const passGen = generation.current;
      let lines: string[] | null = null;
      try {
        lines = await capture();
      } catch {
        lines = null;
      }
      if (cancelled) return;
      if (passGen !== generation.current) return schedule();
      const result: ScanParseResult | null = lines ? parseExpiry(lines, { today: new Date(), preferredOrder }) : null;

      // The product name tracks what the label currently reads, but only a
      // repeating name is promoted (and a full window with no guess demotes
      // it), so the panel never flickers and never lingers on a stale name.
      const guess = lines ? guessProduct(lines) : null;
      const nameKey = guess?.name ?? null;
      names.current = [...names.current, nameKey].slice(-NAME_WINDOW);
      const stable = nameKey && names.current.filter((n) => n === nameKey).length >= NAME_NEEDED ? nameKey : null;
      if (stable) setProduct((prev) => (prev === stable ? prev : stable));
      else if (!nameKey && names.current.every((n) => n === null)) setProduct((prev) => (prev === null ? prev : null));

      if (result?.kind === 'found') {
        noTextStreak.current = 0;
        const h = [...history.current, result.key].slice(-AGREEMENT_WINDOW);
        history.current = h;
        if (h.filter((k) => k === result.key).length >= AGREEMENT_NEEDED) {
          publish({ status: 'detected', detection: result, lines: lines ?? [] });
          return; // Stop scanning: the result panel is up.
        }
        misses.current = 0;
        publish({ status: 'scanning', hint: 'hold-steady' });
      } else {
        history.current = [...history.current, null].slice(-AGREEMENT_WINDOW);
        misses.current += 1;
        const noText = result?.kind === 'none' && result.hint === 'no-text';
        noTextStreak.current = noText ? noTextStreak.current + 1 : 0;
        if (misses.current >= MISSES_BEFORE_HINT) {
          const hint: ScanHint = !lines
            ? 'ocr-error'
            : noTextStreak.current >= MISSES_BEFORE_HINT
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
        } else if (history.current.some((k) => k !== null)) {
          // A date was seen a pass or two ago and OCR flickered: asking the
          // user to hold steady beats flapping back to the aiming hint.
          publish({ status: 'scanning', hint: 'hold-steady' });
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
  }, [enabled, detected, capture, publish]);

  return { state, product, reset };
}
