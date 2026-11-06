// Notification permission and delivery.
//
// Inside the iPhone app (the shell sets window.__prexpireNotifications), real
// expiry reminders are LOCAL notifications scheduled by the app with iOS:
// this module asks the app for the permission, sends it the reminder plan
// (reminderPlan.ts), and can send a test notification.
//
// In a plain browser nothing is delivered in the background; it only reports
// and requests the browser's permission, as before.

import type { PlannedReminder } from '../reminderPlan';

export type NotificationStatus = 'granted' | 'denied' | 'default' | 'unsupported' | 'insecure';

type Shell = { postMessage?: (data: string) => void };
const shell = (): Shell | null => {
  if (typeof window === 'undefined') return null;
  const w = window as { __prexpireNotifications?: unknown; ReactNativeWebView?: Shell };
  return w.__prexpireNotifications && w.ReactNativeWebView?.postMessage ? w.ReactNativeWebView : null;
};
export const nativeReminders = (): boolean => !!shell();

// The iPhone app's answer, cached (the page asks for it when it loads).
let appStatus: NotificationStatus = 'default';
const listeners = new Set<() => void>();
const waiting: ((s: NotificationStatus) => void)[] = [];
function send(type: string, extra: Record<string, unknown> = {}) {
  try {
    shell()?.postMessage?.(JSON.stringify({ type, ...extra }));
  } catch {
    // The app went away; nothing to do.
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('prexpire:notif', (e: Event) => {
    const d = (e as CustomEvent<{ status?: NotificationStatus }>).detail;
    if (d?.status) {
      appStatus = d.status;
      waiting.splice(0).forEach((f) => f(appStatus));
      listeners.forEach((f) => f());
    }
  });
  if (shell()) send('notif-status');
}
const ask = (type: string) =>
  new Promise<NotificationStatus>((resolve) => {
    waiting.push(resolve);
    send(type);
    setTimeout(() => resolve(appStatus), 15000);
  });

export function notificationStatus(): NotificationStatus {
  if (shell()) return appStatus;
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationStatus> {
  if (shell()) return ask('notif-request');
  const status = notificationStatus();
  if (status !== 'default') return status;
  try {
    // Older Safari only supports the callback form.
    const result = await new Promise<NotificationPermission>((resolve, reject) => {
      const p = Notification.requestPermission(resolve);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
    return result;
  } catch {
    return notificationStatus();
  }
}

// iPhone app only: hands over the complete reminder plan (it replaces
// whatever was scheduled before), sends a test, or opens iPhone Settings.
export function scheduleReminders(plan: PlannedReminder[]) {
  if (shell()) send('notif-plan', { reminders: plan });
}
export function sendTestNotification(): Promise<NotificationStatus> {
  return shell() ? ask('notif-test') : Promise.resolve(notificationStatus());
}
export function openNotificationSettings() {
  send('notif-settings');
}

// Calls back when the permission may have changed outside the page (iPhone
// Settings, browser settings).
export function watchNotificationStatus(onChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  const recheck = () => {
    if (shell()) send('notif-status');
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener('focus', recheck);
  document.addEventListener('visibilitychange', recheck);
  let status: PermissionStatus | null = null;
  if (!shell())
    navigator.permissions
      ?.query({ name: 'notifications' as PermissionName })
      .then((s) => {
        status = s;
        s.onchange = onChange;
      })
      .catch(() => {});
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('focus', recheck);
    document.removeEventListener('visibilitychange', recheck);
    if (status) status.onchange = null;
  };
}
