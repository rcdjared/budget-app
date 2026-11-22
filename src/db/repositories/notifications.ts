import { db } from "@/db/schema";
import { profileRecords } from "@/db/profileScope";
import type { InboxNotification } from "@/domain/types";
import { loadAppSettings, type NotificationPreferences } from "@/lib/settings";
import { computeDueNotifications, toInboxNotification, type NotificationData } from "@/lib/notificationEngine";
import { tForLanguage } from "@/lib/localization";
import { NOTIFICATION_THRESHOLDS } from "@/lib/notificationsConfig";

export async function notifySystem(item: InboxNotification): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(item.title, {
      body: item.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: item.dedupe_key,
      data: { route: item.route, notificationId: item.id },
    });
  } catch (error) {
    console.error("Could not show system notification:", error);
  }
}

export async function createTestInboxNotification(profileId: string): Promise<InboxNotification> {
  const now = new Date();
  const language = loadAppSettings().language;
  const item: InboxNotification = {
    id: crypto.randomUUID(),
    profileId,
    category: "dailyCheckIn",
    title: tForLanguage("testNotificationTitle", language),
    body: tForLanguage("testNotificationBody", language),
    created_at: now.toISOString(),
    read_at: null,
    route: "home",
    dedupe_key: `test:${crypto.randomUUID()}`,
  };
  await db.inboxNotifications.add(item);
  await pruneInbox(profileId, now);
  window.dispatchEvent(new CustomEvent("kupit:inbox-notification-created", { detail: item }));
  await notifySystem(item);
  return item;
}

export async function insertDueNotifications(
  profileId: string,
  data: NotificationData,
  settings: NotificationPreferences,
  now = new Date()
): Promise<InboxNotification[]> {
  const due = computeDueNotifications(now, data, settings, loadAppSettings().language);
  const created: InboxNotification[] = [];

  for (const candidate of due) {
    const existing = await db.inboxNotifications
      .where("[profileId+dedupe_key]")
      .equals([profileId, candidate.dedupe_key])
      .first();
    if (existing) continue;
    const notification = toInboxNotification(candidate, profileId, now.toISOString());
    try {
      await db.inboxNotifications.add(notification);
    } catch (error) {
      if (error instanceof DOMException && error.name === "ConstraintError") continue;
      throw error;
    }
    created.push(notification);
    window.dispatchEvent(new CustomEvent("kupit:inbox-notification-created", { detail: notification }));
    await notifySystem(notification);
  }

  await pruneInbox(profileId, now);
  return created;
}

async function pruneInbox(profileId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - NOTIFICATION_THRESHOLDS.retentionDays * 86_400_000).toISOString();
  await profileRecords(db.inboxNotifications, profileId)
    .filter((item) => item.created_at < cutoff)
    .delete();
  const profileItems = await profileRecords(db.inboxNotifications, profileId).toArray();
  profileItems.sort((left, right) => right.created_at.localeCompare(left.created_at));
  if (profileItems.length > NOTIFICATION_THRESHOLDS.maxInboxItems) {
    await db.inboxNotifications.bulkDelete(profileItems.slice(NOTIFICATION_THRESHOLDS.maxInboxItems).map((item) => item.id));
  }
}

export async function markInboxNotificationRead(id: string): Promise<void> {
  await db.inboxNotifications.update(id, { read_at: new Date().toISOString() });
}

export async function markAllInboxNotificationsRead(profileId: string): Promise<void> {
  const timestamp = new Date().toISOString();
  await profileRecords(db.inboxNotifications, profileId)
    .filter((item) => !item.read_at)
    .modify({ read_at: timestamp });
}

export async function clearInboxNotifications(profileId: string): Promise<void> {
  await profileRecords(db.inboxNotifications, profileId).delete();
}

export async function deleteInboxNotification(id: string): Promise<void> {
  await db.inboxNotifications.delete(id);
}
