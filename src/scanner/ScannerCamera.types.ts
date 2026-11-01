import type { Ref } from 'react';
import type { Rect, Size } from './cropMath';
import type { DayOrder } from './dateParser';

export type FrameGeometry = { view: Size; frame: Rect };

// expo-camera's barcode bounds: a rectangle in the PREVIEW's view coordinates.
export type BarcodeBounds = { origin?: { x?: number; y?: number }; size?: { width?: number; height?: number } };

// What one scanning pass read from the area inside the frame: OCR text lines
// and/or a decoded product barcode. Both come from the frame's exact region,
// never from the whole camera image. `dark` is the IMAGE-based brightness
// verdict (mean luminance of the crop below the too-dark threshold): it lets
// the loop say "Too dark. Improve lighting." even while the OCR still reads
// fragments of text — the no-text case it used to rely on is only a proxy.
// Optional: the native build measures through its own path and may omit it.
export type FrameReading = { lines: string[]; barcode: string | null; dark?: boolean };

// What the scan loop needs from the camera: read the area inside the frame once.
export type ScannerCameraHandle = {
  readFrame: (
    geometry: FrameGeometry | null,
    what: {
      text: boolean;
      barcode: boolean;
      // The caller's day/month order for ambiguous numeric dates. On the web it
      // lets the camera layer stop after its FIRST preprocessing variant
      // already read a confirmed date (the second variant is only worth its
      // latency when the first found nothing); the native build ignores it.
      preferredOrder?: DayOrder;
    },
  ) => Promise<FrameReading>;
};

export type CameraErrorKind = 'denied' | 'unavailable' | 'unsupported' | 'ocr' | 'other';

export type ScannerCameraProps = {
  ref?: Ref<ScannerCameraHandle>;
  // False in the background, with the tab hidden, or while the phone is locked.
  active: boolean;
  torch: boolean;
  // While true the camera's live barcode scanner runs (native) and the read
  // loop decodes barcodes from the frame crop (web). Only barcodes whose
  // detected bounds fall INSIDE the scanning frame are reported.
  scanBarcodes?: boolean;
  // The scanning frame in view coordinates, used to keep only barcodes inside it.
  barcodeFrame?: Rect | null;
  // A barcode was read inside the frame. Fired once per code; the caller stops
  // asking for barcodes while it looks the product up.
  onBarcodeInFrame?: (code: string) => void;
  // Called once the preview is live. `barcodes` says whether this device can
  // decode product barcodes at all (always true natively; on the web it depends
  // on the browser's decoding support, which this app provides itself).
  onReady: (capabilities: { torch: boolean; barcodes: boolean }) => void;
  onError: (kind: CameraErrorKind, message: string) => void;
};
