import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Worker } from 'tesseract.js';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HTMLCanvasElementLuminanceSource,
  HybridBinarizer,
  MultiFormatReader,
} from '@zxing/library';
import { cropForFrame } from './cropMath';
import { createWebOcr } from './ocr.web';
import { parseExpiry } from './dateParser';
import type { CameraErrorKind, FrameReading, ScannerCameraProps } from './ScannerCamera.types';

// Web build: the camera through getUserMedia (rear camera preferred) shown in a <video>,
// frames copied to a canvas cropped EXACTLY to the scanning frame, and read in the browser
// (Tesseract for text, ZXing or the native BarcodeDetector for product barcodes). Nothing
// is uploaded.

// Width of the image handed to Tesseract. Smaller is faster; this keeps print legible.
const OCR_WIDTH = 1000;
// Small crops are ENLARGED before OCR instead of passed at native size: a
// stamped or dot-matrix date that fills only part of a close-up crop has
// glyphs of 8-15 px at native scale, which Tesseract's LSTM routinely misses
// whole digits of (measured on real packaging photos); the same glyphs at
// 2-3x read reliably. Crops below SMALL_CROP px wide are scaled up toward
// SMALL_TARGET (never more than SMALL_CAP x, past which interpolation only
// smears).
const SMALL_CROP = 700;
const SMALL_TARGET = 1250;
const SMALL_CAP = 3;

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean };

// One decoded product barcode, or nothing.
type CanvasBarcodeReader = (canvas: HTMLCanvasElement) => Promise<string | null>;

// ZXing runs everywhere the browser's own BarcodeDetector is missing (desktop Chrome,
// Safari, Firefox): it decodes from the same canvas crop, so the frame stays the only
// region that is ever read. Both orientations are tried, because a phone held portrait
// shows a horizontal barcode rotated inside the landscape video frame.
function createZxingReader(): CanvasBarcodeReader {
  const reader = new MultiFormatReader();
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  reader.setHints(hints);
  const tryDecode = (bitmap: BinaryBitmap): string | null => {
    try {
      return reader.decode(bitmap)?.getText() ?? null;
    } catch {
      return null; // NotFoundException: nothing decodable in this orientation
    } finally {
      reader.reset();
    }
  };
  return async (canvas) => {
    try {
      const source = new HTMLCanvasElementLuminanceSource(canvas);
      let text = tryDecode(new BinaryBitmap(new HybridBinarizer(source)));
      if (!text && source.isRotateSupported?.()) {
        text = tryDecode(new BinaryBitmap(new HybridBinarizer(source.rotateCounterClockwise())));
      }
      const clean = (text ?? '').trim();
      return /^\d{6,14}$/.test(clean) ? clean : null;
    } catch {
      return null;
    }
  };
}

// The browser's own BarcodeDetector (Android Chrome, Samsung Internet): faster and
// hardware-backed where it exists. Returns null when the browser does not have it.
async function createDetectorReader(): Promise<CanvasBarcodeReader | null> {
  const Detector = (window as unknown as { BarcodeDetector?: new (opts?: { formats?: string[] }) => { detect: (src: CanvasImageSource) => Promise<{ rawValue?: string }[]>; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const probe = new Detector();
    const supported = (await probe.getSupportedFormats?.()) ?? [];
    const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
    const formats = wanted.filter((f) => supported.length === 0 || supported.includes(f));
    if (!formats.length) return null;
    const detector = new Detector({ formats });
    return async (canvas) => {
      try {
        const codes = await detector.detect(canvas);
        for (const code of codes) {
          const raw = (code.rawValue ?? '').trim();
          if (/^\d{6,14}$/.test(raw)) return raw;
        }
        return null;
      } catch {
        return null;
      }
    };
  } catch {
    return null;
  }
}

function describeError(e: unknown): [CameraErrorKind, string] {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return ['denied', 'Camera access is blocked for this site. Allow the camera in your browser settings, then try again.'];
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return ['unavailable', 'No camera was found on this device.'];
  if (name === 'NotReadableError' || name === 'AbortError') {
    return ['other', 'The camera is being used by another app or tab. Close it and try again.'];
  }
  return ['other', 'The camera could not start.'];
}

// Grayscale with a little extra contrast (the scanner's original preprocessing,
// kept as variant A exactly as it was).
function boostContrast(img: ImageData): ImageData {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const px = out.data;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const boosted = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128));
    px[i] = px[i + 1] = px[i + 2] = boosted;
  }
  return out;
}

// Locally adaptive binarization (variant B): each pixel is compared with the
// mean of its neighbourhood (integral image, window ~1/12 of the shorter side,
// offset 10) instead of one global curve, so faint print under uneven light,
// glare and shadows keeps enough contrast to survive as glyphs. The original
// ImageData is left untouched — both variants work from the same captured
// frame.
function binarizeAdaptive(img: ImageData): ImageData {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const px = out.data;
  const W = img.width;
  const H = img.height;
  const gray = new Float32Array(W * H);
  for (let i = 0, p = 0; p < W * H; p++, i += 4) gray[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowsum = 0;
    for (let x = 0; x < W; x++) {
      rowsum += gray[y * W + x];
      integ[(y + 1) * (W + 1) + (x + 1)] = integ[y * (W + 1) + (x + 1)] + rowsum;
    }
  }
  const r = Math.max(4, Math.floor(Math.max(8, Math.round(Math.min(W, H) / 12)) / 2));
  const OFF = 10;
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(W - 1, x + r);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integ[(y1 + 1) * (W + 1) + (x1 + 1)] - integ[y0 * (W + 1) + (x1 + 1)] - integ[(y1 + 1) * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
      const v = gray[y * W + x] < sum / area - OFF ? 0 : 255;
      const i = (y * W + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }
  return out;
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

// Mean luminance of the crop from a sparse sample (every 16th pixel — a
// dark/not-dark verdict needs no more). Below DARK_MEAN the lighting, not the
// aim, is why nothing reads: the loop's "Too dark. Improve lighting." hint
// fires on the IMAGE's own evidence, even when the OCR still caught fragments.
function meanLuminance(img: ImageData): number {
  const px = img.data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 2 < px.length; i += 64) {
    sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    n++;
  }
  return n ? sum / n : 255;
}
const DARK_MEAN = 60;

export function ScannerCamera({ ref, active, torch, onReady, onError }: ScannerCameraProps) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const worker = useRef<Promise<Worker> | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const barcodeReader = useRef<CanvasBarcodeReader | null>(null);
  // Latest callbacks, so starting the camera does not depend on their identity.
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  // The barcode the loop last reported, so a code held in the frame is not re-reported.
  const lastReported = useRef<{ code: string; at: number } | null>(null);

  // The OCR engine loads once per scanner visit and is shut down when the scanner closes.
  useEffect(() => {
    return () => {
      worker.current?.then((w) => w.terminate()).catch(() => {});
      worker.current = null;
    };
  }, []);

  // Start the stream while active; stop every track when inactive (tab hidden) or on unmount.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const stop = () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      if (video.current) video.current.srcObject = null;
    };

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        callbacks.current.onError('unsupported', 'This browser cannot use the camera here. Open Prexpire over https in Safari, Chrome or Edge.');
        return;
      }
      // Never two streams at once.
      stop();
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch (e) {
        if (!cancelled) callbacks.current.onError(...describeError(e));
        return;
      }
      if (cancelled) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      const v = video.current;
      if (v) {
        v.srcObject = s;
        await v.play().catch(() => {});
      }

      // The barcode decoder: the browser's own when present, ZXing otherwise.
      // This app ships ZXing, so barcode scanning works on every browser.
      barcodeReader.current = (await createDetectorReader()) ?? createZxingReader();

      // The scanner is live as soon as the preview and barcode decoding are
      // ready; the OCR engine keeps loading behind the date stage's first pass.
      if (cancelled) return;
      const caps = (s.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as TorchCapabilities;
      callbacks.current.onReady({ torch: !!caps.torch, barcodes: !!barcodeReader.current });

      try {
        worker.current ??= createWebOcr();
        await worker.current;
      } catch {
        worker.current = null;
        if (!cancelled) callbacks.current.onError('ocr', 'The text reader could not load. Check your connection and try again.');
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [active]);

  useEffect(() => {
    const track = stream.current?.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as TorchCapabilities;
    if (!track || !caps.torch) return;
    track.applyConstraints({ advanced: [{ torch } as MediaTrackConstraintSet] }).catch(() => {});
  }, [torch, active]);

  useImperativeHandle(ref, () => ({
    readFrame: async (geometry, what): Promise<FrameReading> => {
      const v = video.current;
      if (!v || !v.videoWidth || v.readyState < 2) return { lines: [], barcode: null };
      // The frame IS the region of interest: without a computable crop nothing is
      // read, so content outside the brackets is never analysed.
      const crop = geometry ? cropForFrame(geometry.view, geometry.frame, { width: v.videoWidth, height: v.videoHeight }) : null;
      if (!crop) return { lines: [], barcode: null };

      const c = (canvas.current ??= document.createElement('canvas'));
      const scale = crop.width < SMALL_CROP ? Math.min(SMALL_CAP, SMALL_TARGET / crop.width) : Math.min(1, OCR_WIDTH / crop.width);
      c.width = Math.round(crop.width * scale);
      c.height = Math.round(crop.height * scale);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { lines: [], barcode: null };
      ctx.drawImage(v, crop.x, crop.y, crop.width, crop.height, 0, 0, c.width, c.height);

      // Barcodes first, on the clean crop (before the OCR contrast boost).
      let barcode: string | null = null;
      if (what.barcode && barcodeReader.current) {
        const code = await barcodeReader.current(c);
        const now = Date.now();
        if (code && !(lastReported.current?.code === code && now - lastReported.current.at < 3000)) {
          lastReported.current = { code, at: now };
          barcode = code;
        }
      }

      if (!what.text) return { lines: [], barcode };

      const w = await worker.current;
      if (!w) return { lines: [], barcode };

      // Variant A (always, unchanged behaviour): grayscale with a little extra
      // contrast. This alone reads crisp inkjet prints; when it finds a date the
      // pass ends here at exactly the old latency.
      const base = ctx.getImageData(0, 0, c.width, c.height);
      const dark = meanLuminance(base) < DARK_MEAN;
      const boosted = boostContrast(base);
      ctx.putImageData(boosted, 0, 0);
      const { data } = await w.recognize(c);
      const lines = splitLines(data.text);
      // A confirmed date in variant A is enough — no second pass needed.
      if (what.preferredOrder && parseExpiry(lines, { today: new Date(), preferredOrder: what.preferredOrder }).kind === 'found') {
        return { lines, barcode, dark };
      }

      // Variant B (only when A found no date): the SAME frame, locally adaptive
      // binarized. Faint and low-contrast print (stamped, embossed-ink,
      // reflective packaging, uneven light) survives thresholds where a global
      // contrast curve loses it. Both variants' lines are returned together —
      // whichever one read the date, the parser finds it; garbage from either
      // cannot become a false date (every candidate is calendar-validated).
      const bin = binarizeAdaptive(base);
      ctx.putImageData(bin, 0, 0);
      const { data: dataB } = await w.recognize(c);
      const merged = [...lines];
      for (const l of splitLines(dataB.text)) if (!merged.includes(l)) merged.push(l);
      return { lines: merged, barcode, dark };
    },
  }));

  return (
    <video
      ref={video}
      autoPlay
      muted
      playsInline
      aria-label="Camera preview"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000' }}
    />
  );
}
