import { useCallback, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { cropForFrame, type Rect } from './cropMath';
import { recognizeText } from './ocr';
import type { BarcodeBounds, FrameGeometry, ScannerCameraProps } from './ScannerCamera.types';
// iOS and Android: expo-camera for the preview, a still about once a second cropped EXACTLY to
// the frame, and on-device text recognition (Apple Vision / ML Kit). Product barcodes are
// decoded by the camera's live scanner, but only reported when their bounds sit inside the
// frame. The web build uses ScannerCamera.web.tsx instead.

// Longest side of the image handed to OCR; larger crops are scaled down to keep passes fast.
const MAX_OCR_SIDE = 1600;

// Product barcode formats: the retail codes (EAN/UPC) plus the formats some
// goods carry instead. Bounds outside the frame are never reported.
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] as const;

function choosePictureSize(sizes: string[]): string | undefined {
  if (sizes.includes('1920x1080')) return '1920x1080';
  const parsed = sizes
    .map((s) => {
      const [w, h] = s.split('x').map(Number);
      return { s, long: Math.max(w, h), short: Math.min(w, h) };
    })
    .filter((p) => p.long > 0 && Math.abs(p.long / p.short - 4 / 3) < 0.02 && p.long >= 1600 && p.long <= 2600)
    .sort((a, b) => a.long - b.long);
  return parsed[0]?.s;
}

function deleteQuietly(uri: string | undefined) {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {
    // Cache files are cleared by the OS eventually; a failed delete is not worth surfacing.
  }
}

// Reads ONLY the area behind the frame: the photo is cropped to the frame's
// exact coordinates before OCR. When the crop cannot be computed (geometry not
// measured yet, or an orientation mismatch) nothing is read, so a pass can
// never analyse content the user cannot see inside the brackets.
async function readTextInFrame(camera: CameraView, geometry: FrameGeometry | null): Promise<string[]> {
  const photo = await camera.takePictureAsync({ quality: 0.7, shutterSound: false, exif: false });
  if (!photo?.uri) return [];
  let croppedUri: string | undefined;
  try {
    const crop = geometry ? cropForFrame(geometry.view, geometry.frame, { width: photo.width, height: photo.height }) : null;
    if (!crop) return [];
    const ctx = ImageManipulator.manipulate(photo.uri);
    ctx.crop({ originX: crop.x, originY: crop.y, width: crop.width, height: crop.height });
    if (Math.max(crop.width, crop.height) > MAX_OCR_SIDE) {
      ctx.resize(crop.width >= crop.height ? { width: MAX_OCR_SIDE } : { height: MAX_OCR_SIDE });
    }
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
    croppedUri = saved.uri;
    image.release();
    ctx.release();
    return await recognizeText(saved.uri);
  } finally {
    deleteQuietly(photo.uri);
    deleteQuietly(croppedUri);
  }
}

// A barcode counts only when its detected bounds sit inside the scanning
// frame: the centre of the bounds has to land within the frame rectangle in
// view coordinates (expo-camera reports bounds in the preview's coordinate
// space on both platforms). An empty/unusable bounds rectangle cannot prove
// the code was inside the frame, so it is ignored, never guessed.
function barcodeInsideFrame(bounds: BarcodeBounds | undefined, frame: Rect | null): boolean {
  if (!frame) return false;
  const size = bounds?.size;
  if (!size || !size.width || !size.height || size.width <= 0 || size.height <= 0) return false;
  const cx = (bounds?.origin?.x ?? 0) + size.width / 2;
  const cy = (bounds?.origin?.y ?? 0) + size.height / 2;
  return cx >= frame.x && cx <= frame.x + frame.width && cy >= frame.y && cy <= frame.y + frame.height;
}

export function ScannerCamera({ ref, active, torch, scanBarcodes = false, barcodeFrame = null, onBarcodeInFrame, onReady, onError }: ScannerCameraProps) {
  const camera = useRef<CameraView>(null);
  const [pictureSize, setPictureSize] = useState<string | undefined>();
  // Latest props for the event handlers, so the camera never re-mounts for them.
  const scan = useRef({ scanBarcodes, barcodeFrame, onBarcodeInFrame });
  scan.current = { scanBarcodes, barcodeFrame, onBarcodeInFrame };
  // The last reported code, so a continuous scanner firing the same barcode
  // every frame does not spam the lookup.
  const lastCode = useRef<{ code: string; at: number } | null>(null);

  useImperativeHandle(ref, () => ({
    readFrame: async (geometry, what) => {
      if (!camera.current) return { lines: [], barcode: null };
      // Barcodes arrive through the live scanner's events, not stills; text
      // comes from a photo cropped to the frame.
      const lines = what.text ? await readTextInFrame(camera.current, geometry) : [];
      return { lines, barcode: null };
    },
  }));

  const onBarcodeScanned = useCallback((result: { data: string; bounds?: BarcodeBounds }) => {
    const { scanBarcodes: want, barcodeFrame: frame, onBarcodeInFrame: report } = scan.current;
    if (!want || !report) return;
    const code = (result.data ?? '').trim();
    if (!/^\d{6,14}$/.test(code)) return;
    if (!barcodeInsideFrame(result.bounds, frame)) return;
    const now = Date.now();
    if (lastCode.current?.code === code && now - lastCode.current.at < 3000) return;
    lastCode.current = { code, at: now };
    report(code);
  }, []);

  const onCameraReady = async () => {
    onReady({ torch: true, barcodes: true });
    if (pictureSize) return;
    try {
      const sizes = await camera.current?.getAvailablePictureSizesAsync();
      const chosen = sizes && choosePictureSize(sizes);
      if (chosen) setPictureSize(chosen);
    } catch {
      // The default size works; it is just slower to process.
    }
  };

  return (
    <CameraView
      ref={camera}
      style={StyleSheet.absoluteFill}
      facing="back"
      active={active}
      enableTorch={torch && active}
      animateShutter={false}
      pictureSize={pictureSize}
      autofocus="on"
      // The handler's presence toggles the live barcode scanner: it only runs
      // while the product stage wants it, and only codes inside the frame pass.
      onBarcodeScanned={scanBarcodes ? onBarcodeScanned : undefined}
      barcodeScannerSettings={scanBarcodes ? { barcodeTypes: [...BARCODE_TYPES] } : undefined}
      onCameraReady={onCameraReady}
      onMountError={(e) => onError('unavailable', e.message || 'No camera was found on this device.')}
    />
  );
}
