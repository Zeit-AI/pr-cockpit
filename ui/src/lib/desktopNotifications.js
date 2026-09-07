import { claimNotifications } from "./api.js";

// The server hands out at most this many per claim; a full batch means more may be pending.
export const NOTIFICATION_CLAIM_LIMIT = 20;

// Settings raises this after the user explicitly grants permission (or asks for a retry)
// so the single delivery owner in App drains immediately instead of at the next event.
export const NOTIFICATION_DRAIN_EVENT = "cockpit:notifications-drain";

export function notificationPermission() {
  return typeof Notification === "function" ? Notification.permission : "unsupported";
}

// Delivery needs both the server-side opt-in and a permission the user granted from Settings;
// nothing here ever prompts.
export function canDeliverNotifications(enabled, permission = notificationPermission()) {
  return enabled === true && permission === "granted";
}

export function notificationHref(notification) {
  return `#/pr/${notification.repo}/${notification.number}`;
}

export function openNotificationTarget(notification) {
  const hash = notificationHref(notification);
  if (window.cockpitShell?.openWindow) window.cockpitShell.openWindow(hash);
  else {
    location.hash = hash;
    window.focus();
  }
}

export function showDesktopNotification(notification) {
  const shown = new Notification(notification.title, { body: notification.body, tag: notification.id });
  shown.addEventListener("click", () => {
    shown.close();
    openNotificationTarget(notification);
  });
  return shown;
}

// `eligible` is re-read before every claim and every show: a claim is a one-shot hand-off,
// so a user who disabled notifications or revoked permission while a claim was in flight
// must not see its late results. Claims are atomic on the server, so overlapping drains
// from several windows never duplicate.
export async function drainNotifications({ eligible, claim = claimNotifications, show = showDesktopNotification }) {
  let delivered = 0;
  let batch;
  do {
    if (!eligible()) return delivered;
    batch = (await claim()).notifications;
    for (const notification of batch) {
      if (!eligible()) return delivered;
      show(notification);
      delivered++;
    }
  } while (batch.length >= NOTIFICATION_CLAIM_LIMIT);
  return delivered;
}
