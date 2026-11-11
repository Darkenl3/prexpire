import { Platform } from 'react-native';

// Opening a link outside the app (email to support, the support website,
// Apple's subscription page). In a browser it's a new tab or the mail app.
// Inside the iPhone app the shell opens it (window.__prexpireLinks); older
// shells can't, and canOpenLinks() is false there, so the page shows the
// address as text instead of a button that does nothing.

type W = { ReactNativeWebView?: { postMessage?: (d: string) => void }; __prexpireLinks?: number };
const win = (): W | null => (Platform.OS === 'web' && typeof window !== 'undefined' ? (window as unknown as W) : null);

export function canOpenLinks(): boolean {
  const w = win();
  if (!w) return false;
  return !w.ReactNativeWebView || !!w.__prexpireLinks;
}

export function openLink(url: string) {
  const w = win();
  if (!w) return;
  if (w.ReactNativeWebView) {
    if (!w.__prexpireLinks) return;
    try {
      w.ReactNativeWebView.postMessage?.(JSON.stringify({ type: 'open-link', url }));
    } catch {}
    return;
  }
  if (url.startsWith('mailto:')) window.location.href = url;
  else window.open(url, '_blank', 'noopener');
}
