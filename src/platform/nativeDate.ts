// The iOS date wheels for the save form. Inside the iOS app (builds that set
// window.__prexpireNativeDate before the page loads) the expiry date is
// picked on the app's own native sheet, the same SwiftUI wheels the scanner
// uses; the page asks with a pick-date message and gets the answer back as a
// prexpire:date-picked event. Everywhere else the form keeps its steppers.

type ShellWindow = Window & {
  __prexpireNativeDate?: unknown;
  ReactNativeWebView?: { postMessage?: (data: string) => void };
};

export type PickedDate = { iso: string; precision: 'day' | 'month' };

export function nativeDatePicker(): boolean {
  return typeof window !== 'undefined' && !!(window as ShellWindow).__prexpireNativeDate && !!(window as ShellWindow).ReactNativeWebView?.postMessage;
}

let seq = 0;

// Resolves with the picked date, or null when the user cancels.
export function pickNativeDate(current: PickedDate): Promise<PickedDate | null> {
  seq += 1;
  const requestId = `d${seq}`;
  return new Promise((resolve) => {
    const onPicked = (e: Event) => {
      const d = (e as CustomEvent<{ requestId?: string; iso?: string; precision?: string }>).detail;
      if (d?.requestId !== requestId) return;
      window.removeEventListener('prexpire:date-picked', onPicked);
      resolve(d.iso && /^\d{4}-\d{2}-\d{2}$/.test(d.iso) ? { iso: d.iso, precision: d.precision === 'month' ? 'month' : 'day' } : null);
    };
    window.addEventListener('prexpire:date-picked', onPicked);
    (window as ShellWindow).ReactNativeWebView?.postMessage?.(JSON.stringify({ type: 'pick-date', requestId, iso: current.iso, precision: current.precision }));
  });
}
