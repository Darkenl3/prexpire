import type { Ref } from 'react';
import type { Rect, Size } from './cropMath';

export type FrameGeometry = { view: Size; frame: Rect };

// expo-camera's barcode bounds: a rectangle in the PREVIEW's view coordinates.
export type BarcodeBounds = { origin?: { x?: number; y?: number }; size?: { width?: number; height?: number } };

// What one scanning pass read from the area inside the frame: OCR text lines
// and/or a decoded product barcode. Both come from the frame's exact region,
// never from the whole camera image.
export type FrameReading = { lines: string[]; barcode: string | null };

// What the scan loop needs from the camera: read the area inside the frame once.
export type ScannerCameraHandle = {
  readFrame: (geometry: FrameGeometry | null, what: { text: boolean; barcode: boolean }) => Promise<FrameReading>;
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
