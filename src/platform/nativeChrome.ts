// Native glass header buttons. Inside the iOS app the round header buttons
// (menu, bell, back, search) are drawn by the app itself with Apple's liquid
// glass (expo-glass-effect, the same material as the scanner's top buttons
// and the bottom bar), floating exactly over where the page lays them out.
// The page keeps the buttons in its layout but invisible, reports where each
// one is every frame (position, icon, badge, and whether it is really on
// screen: not covered by a dialog or sheet, not faded out by a transition),
// and the app sends each tap back here.
//
// Only app builds that draw the buttons set window.__prexpireNativeChrome
// before the page loads; everywhere else (older builds, the open web) the
// buttons keep their CSS glass and nothing here runs.

type ShellWindow = Window & {
  __prexpireNativeChrome?: unknown;
  ReactNativeWebView?: { postMessage?: (data: string) => void };
};

export function nativeChrome(): boolean {
  return typeof window !== 'undefined' && !!(window as ShellWindow).__prexpireNativeChrome && !!(window as ShellWindow).ReactNativeWebView?.postMessage;
}

export type ChromeButton = {
  icon: string;
  iconSize: number;
  badge?: number;
  label: string;
  // A pill with this text beside the icon (Scan a label / Add manually),
  // instead of a round icon button.
  text?: string;
  // The icon in the app's green (the pills' leading glyph).
  accentIcon?: boolean;
  onPress: () => void;
  element: () => HTMLElement | null;
};

const buttons = new Map<string, ChromeButton>();
let counter = 0;
let frame = 0;
let last = '';

export function chromeId(): string {
  counter += 1;
  return `b${counter}`;
}

export function registerChrome(id: string, button: ChromeButton): () => void {
  buttons.set(id, button);
  start();
  return () => {
    buttons.delete(id);
    if (!buttons.size) report();
  };
}

export function updateChrome(id: string, button: ChromeButton) {
  if (buttons.has(id)) buttons.set(id, button);
}

// How visible an element really is: its own opacity times every ancestor's.
function opacityOf(el: HTMLElement): number {
  let o = 1;
  for (let n: HTMLElement | null = el; n && o > 0.01; n = n.parentElement) {
    const v = parseFloat(getComputedStyle(n).opacity);
    if (!Number.isNaN(v)) o *= v;
  }
  return o;
}

function snapshot() {
  const out: {
    id: string;
    icon: string;
    iconSize: number;
    badge: number;
    label: string;
    text?: string;
    accentIcon?: boolean;
    x: number;
    y: number;
    size: number;
    w: number;
    h: number;
    opacity: number;
  }[] = [];
  for (const [id, b] of buttons) {
    const el = b.element();
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.bottom < 0 || r.top > window.innerHeight) continue;
    // Covered by a dialog, sheet or scrim: the topmost element at its centre
    // is not the button.
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top || !el.contains(top)) continue;
    const opacity = opacityOf(el);
    if (opacity < 0.05) continue;
    out.push({
      id,
      icon: b.icon,
      iconSize: b.iconSize,
      badge: b.badge ?? 0,
      label: b.label,
      text: b.text,
      accentIcon: b.accentIcon,
      x: Math.round(r.left * 2) / 2,
      y: Math.round(r.top * 2) / 2,
      size: Math.round(r.width),
      w: Math.round(r.width),
      h: Math.round(r.height),
      opacity: Math.round(opacity * 20) / 20,
    });
  }
  return out;
}

function report() {
  const list = buttons.size ? snapshot() : [];
  const msg = JSON.stringify({ type: 'chrome', buttons: list });
  if (msg === last) return;
  last = msg;
  (window as ShellWindow).ReactNativeWebView?.postMessage?.(msg);
}

function start() {
  if (frame || !nativeChrome()) return;
  const tick = () => {
    report();
    frame = buttons.size ? requestAnimationFrame(tick) : 0;
  };
  frame = requestAnimationFrame(tick);
}

// Taps on the native buttons come back as prexpire:chrome-press events.
if (typeof window !== 'undefined') {
  window.addEventListener('prexpire:chrome-press', (e) => {
    const id = (e as CustomEvent<{ id?: string }>).detail?.id;
    const b = id ? buttons.get(id) : undefined;
    b?.onPress();
  });
}
