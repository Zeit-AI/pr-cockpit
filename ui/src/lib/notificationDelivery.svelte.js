// Last desktop delivery failure (claim or show), shown in Settings → Notifications;
// cleared by the next drain that completes.
export const notificationDelivery = $state({ error: null });
