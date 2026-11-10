// A small tap of feedback. A web page can't vibrate an iPhone, so inside the
// app (window.__prexpireHaptics) the app does it; elsewhere it's a no-op
// (or a short buzz where the browser supports one).
export type TapStyle = 'light' | 'medium' | 'success';

export function tap(style: TapStyle = 'light') {
  if (typeof window === 'undefined') return;
  const w = window as { __prexpireHaptics?: number; ReactNativeWebView?: { postMessage?: (d: string) => void } };
  if (w.__prexpireHaptics && w.ReactNativeWebView?.postMessage) {
    try {
      w.ReactNativeWebView.postMessage(JSON.stringify({ type: 'haptic', style }));
    } catch {}
    return;
  }
  try {
    (navigator as { vibrate?: (ms: number) => boolean }).vibrate?.(style === 'medium' ? 18 : 10);
  } catch {}
}
