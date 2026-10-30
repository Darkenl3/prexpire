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
import type { CameraErrorKind, FrameReading, ScannerCameraProps } from './ScannerCamera.types';

// Web build: the camera through getUserMedia (rear camera preferred) shown in a <video>,
// frames copied to a canvas cropped EXACTLY to the scanning frame, and read in the browser
// (Tesseract for text, ZXing or the native BarcodeDetector for product barcodes). Nothing
// is uploaded.

// Width of the image handed to Tesseract. Smaller is faster; this keeps print legible.
const OCR_WIDTH = 1000;

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
      const scale = Math.min(1, OCR_WIDTH / crop.width);
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

      // Grayscale with a little extra contrast helps Tesseract with printed labels.
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const px = img.data;
      for (let i = 0; i < px.length; i += 4) {
        const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const boosted = Math.max(0, Math.min(255, (g - 128) * 1.35 + 128));
        px[i] = px[i + 1] = px[i + 2] = boosted;
      }
      ctx.putImageData(img, 0, 0);

      const w = await worker.current;
      if (!w) return { lines: [], barcode };
      const { data } = await w.recognize(c);
      const lines = data.text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      return { lines, barcode };
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
