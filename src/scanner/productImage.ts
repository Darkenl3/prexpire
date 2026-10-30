import { Platform } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';

// The scanned product's photo, saved onto the item so the card carries the
// REAL product image instead of the generic category art.
//
// Web: the image is fetched, drawn to a canvas and re-encoded as a small JPEG
// data URI (works offline afterwards, and the Open*Facts image servers send
// CORS headers, so the canvas never taints).
// Native: the image is resized through ImageManipulator and read back as
// base64. When anything in either path fails, the ORIGINAL https URL is
// returned instead — still the actual product's image, just loaded remotely —
// and when even that is unusable the caller falls back to the neutral art.

// Longest side of the saved thumbnail; the item card's art tile is ~64pt.
const MAX_SIDE = 256;
// A data URI beyond this is refused (the remote URL is kept instead): keeps
// storage writes small and fast however large the source photo was.
const MAX_DATA_URI = 300_000;

function deleteQuietly(uri: string | undefined) {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {
    // Cache files are cleared by the OS eventually.
  }
}

async function webImageToDataUri(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUri = canvas.toDataURL('image/jpeg', 0.72);
    return dataUri.length <= MAX_DATA_URI ? dataUri : null;
  } finally {
    bitmap.close?.();
  }
}

async function nativeImageToDataUri(url: string): Promise<string | null> {
  // ImageManipulator accepts the remote URL directly on iOS/Android; the
  // resized JPEG is read back as base64 and the cache file cleaned up.
  try {
    const ctx = ImageManipulator.manipulate(url);
    ctx.resize({ width: MAX_SIDE });
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.72 });
    image.release();
    ctx.release();
    try {
      const base64 = await new File(saved.uri).base64();
      if (base64 && base64.length * 1.37 <= MAX_DATA_URI) return `data:image/jpeg;base64,${base64}`;
      return null;
    } finally {
      deleteQuietly(saved.uri);
    }
  } catch {
    return null;
  }
}

// Returns a data URI of the actual product image when possible, the https URL
// itself when only that is reliable, or null when the image cannot be trusted
// (the caller then keeps the neutral fallback art).
export async function fetchProductImage(url: string): Promise<string | null> {
  if (!/^https:\/\//.test(url)) return null;
  try {
    const dataUri = Platform.OS === 'web' ? await webImageToDataUri(url) : await nativeImageToDataUri(url);
    if (dataUri) return dataUri;
  } catch {
    // The shrink failed; the URL itself is still the real product image.
  }
  return url;
}
