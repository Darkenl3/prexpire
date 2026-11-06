// Native (non-web) builds of this web app don't schedule anything themselves:
// Prexpire runs as a website inside the iPhone app, and notifications.web.ts
// is the one in use there. These are the same functions as no-ops.

import type { PlannedReminder } from '../reminderPlan';

export type NotificationStatus = 'granted' | 'denied' | 'default' | 'unsupported' | 'insecure';

export const nativeReminders = (): boolean => false;

export function notificationStatus(): NotificationStatus {
  return 'unsupported';
}

export async function requestNotificationPermission(): Promise<NotificationStatus> {
  return 'unsupported';
}

export function scheduleReminders(_plan: PlannedReminder[]) {}

export async function sendTestNotification(): Promise<NotificationStatus> {
  return 'unsupported';
}

export function openNotificationSettings() {}

export function watchNotificationStatus(_onChange: () => void) {
  return () => {};
}
