import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Bell, Check, Clock3, Trash2, X } from "lucide-react";
import type { InboxNotification } from "@/domain/types";
import { db } from "@/db/schema";
import { profileRecords } from "@/db/profileScope";
import { getProfileNotificationPreferences, updateProfileNotificationPreferences } from "@/db/repositories/profiles";
import {
  clearInboxNotifications,
  createTestInboxNotification,
  deleteInboxNotification,
  markAllInboxNotificationsRead,
  markInboxNotificationRead,
} from "@/db/repositories/notifications";
import { loadAppSettings, type NotificationPreferences } from "@/lib/settings";
import { t } from "@/lib/localization";

type Panel = "inbox" | "settings";
type CategoryKey = keyof NotificationPreferences["categories"];

const categoryRows: { key: CategoryKey; title: Parameters<typeof t>[0]; description: Parameters<typeof t>[0] }[] = [
  { key: "dailyCheckIn", title: "dailyCheckIn", description: "dailyCheckInDescription" },
  { key: "budgetAlerts", title: "budgetAlerts", description: "budgetAlertsDescription" },
  { key: "recurring", title: "recurringNotifications", description: "recurringNotificationsDescription" },
  { key: "debts", title: "debtNotifications", description: "debtNotificationsDescription" },
  { key: "goals", title: "goalNotifications", description: "goalNotificationsDescription" },
  { key: "receivables", title: "receivableNotifications", description: "receivableNotificationsDescription" },
];

function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function relativeTime(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  const language = loadAppSettings().language === "fil" ? "fil-PH" : "en";
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (minutes < 1) return formatter.format(0, "minute");
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.floor(hours / 24), "day");
}

function formatReminderTime(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString(loadAppSettings().language === "fil" ? "fil-PH" : "en", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupedNotifications(items: InboxNotification[]): { title: string; items: InboxNotification[] }[] {
  const today = new Date().toLocaleDateString();
  const current = items.filter((item) => new Date(item.created_at).toLocaleDateString() === today);
  const earlier = items.filter((item) => new Date(item.created_at).toLocaleDateString() !== today);
  return [
    ...(current.length ? [{ title: t("today"), items: current }] : []),
    ...(earlier.length ? [{ title: t("yesterday"), items: earlier }] : []),
  ];
}

export function NotificationsSheet({
  open,
  initialPanel,
  profileId,
  onClose,
  onNavigate,
}: {
  open: boolean;
  initialPanel: Panel;
  profileId: string;
  onClose: () => void;
  onNavigate: (route: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [preferences, setPreferences] = useState<NotificationPreferences>(() => loadAppSettings().notifications);
  const storedPreferences = useLiveQuery(
    () => getProfileNotificationPreferences(profileId),
    [profileId]
  );
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState("");
  const inbox = useLiveQuery(
    async () => {
      const items = await profileRecords(db.inboxNotifications, profileId).toArray();
      return items.sort((left, right) => right.created_at.localeCompare(left.created_at));
    },
    [profileId],
    []
  );
  const unreadCount = useMemo(() => inbox.filter((item) => !item.read_at).length, [inbox]);
  const groups = useMemo(() => groupedNotifications(inbox), [inbox]);

  useEffect(() => {
    if (!open) return;
    setPanel(initialPanel);
    if (storedPreferences) setPreferences(storedPreferences);
    setPermissionMessage("");
    setTimePickerOpen(false);
  }, [open, initialPanel, storedPreferences]);

  if (!open) return null;

  const save = async (patch: Partial<NotificationPreferences>) => {
    try {
      const updated = await updateProfileNotificationPreferences(profileId, patch);
      setPreferences(updated);
      window.dispatchEvent(new CustomEvent("kupit:settings-changed"));
    } catch (error) {
      console.error("Could not save notification preferences:", error);
      setPermissionMessage(t("unsupportedNotifications"));
    }
  };

  const enableNotifications = async () => {
    setPermissionMessage("");
    if (isIOS() && !isInstalled()) {
      setPermissionMessage(t("addToHomeScreen"));
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermissionMessage(t("unsupportedNotifications"));
      return;
    }
    if (Notification.permission === "denied") {
      setPermissionMessage(t("permissionDenied"));
      return;
    }
    let permission: NotificationPermission;
    try {
      permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    } catch (error) {
      console.error("Could not request notification permission:", error);
      setPermissionMessage(t("unsupportedNotifications"));
      return;
    }
    if (permission !== "granted") {
      setPermissionMessage(permission === "denied" ? t("permissionDenied") : t("unsupportedNotifications"));
      return;
    }
    await save({ enabled: true });
  };

  const toggleMaster = () => {
    if (preferences.enabled) void save({ enabled: false });
    else void enableNotifications();
  };

  const sendTest = async () => {
    try {
      await createTestInboxNotification(profileId);
    } catch (error) {
      console.error("Could not create test notification:", error);
      setPermissionMessage(t("unsupportedNotifications"));
    }
  };

  const openItem = async (item: InboxNotification) => {
    if (!item.read_at) await markInboxNotificationRead(item.id);
    onNavigate(item.route);
  };

  return (
    <>
      <div className="sheet-backdrop notifications-backdrop" onMouseDown={onClose}>
        <section className="account-sheet notifications-sheet" onMouseDown={(event) => event.stopPropagation()}>
          <header className="notifications-header">
            <button type="button" className="settings-back-button sheet-close-btn" aria-label={t("close")} onClick={onClose}>
              <ArrowLeft size={19} />
            </button>
            <h2>{t("notifications")}</h2>
            <span className="notifications-header-spacer" />
          </header>

          <div className="notifications-segmented" role="tablist">
            <button type="button" role="tab" aria-selected={panel === "inbox"} className={panel === "inbox" ? "active" : ""} onClick={() => setPanel("inbox")}>
              {t("notifications")}
              {unreadCount > 0 && <span>{unreadCount}</span>}
            </button>
            <button type="button" role="tab" aria-selected={panel === "settings"} className={panel === "settings" ? "active" : ""} onClick={() => setPanel("settings")}>
              {t("notificationSettings")}
            </button>
          </div>

          {panel === "settings" ? (
            <div className="notifications-content">
              <section className="notification-master-card">
                <div className="notification-master-row">
                  <div className="notification-icon"><Bell size={19} /></div>
                  <div className="notification-copy">
                    <strong>{t("notifications")}</strong>
                    <p>{t("notificationMasterDescription")}</p>
                  </div>
                  <button
                    type="button"
                    className={`kupit-toggle ${preferences.enabled ? "on" : ""}`}
                    role="switch"
                    aria-checked={preferences.enabled}
                    aria-label={t("notifications")}
                    onClick={toggleMaster}
                  ><span /></button>
                </div>
                <div className={`notification-nested-settings ${preferences.enabled ? "" : "disabled"}`}>
                  <button type="button" className="notification-time-row" disabled={!preferences.enabled} onClick={() => setTimePickerOpen(true)}>
                    <span><strong>{t("reminderTime")}</strong><small>{t("reminderShared")}</small></span>
                    <span className="notification-time-chip"><Clock3 size={15} />{formatReminderTime(preferences.reminderTime)}</span>
                  </button>
                </div>
              </section>

              <p className="notification-system-hint">
                {preferences.enabled ? t("systemAndInbox") : t("inboxAvailable")}
              </p>
              {permissionMessage && <div className="notification-permission-message" role="status">{permissionMessage}</div>}

              <div className={`notification-categories ${preferences.enabled ? "" : "disabled"}`}>
                {categoryRows.map((row) => (
                  <div className="notification-category-card" key={row.key}>
                    <div className="notification-copy">
                      <strong>{t(row.title)}</strong>
                      <p>{t(row.description)}</p>
                    </div>
                    <button
                      type="button"
                      className={`kupit-toggle ${preferences.categories[row.key] ? "on" : ""}`}
                      role="switch"
                      aria-checked={preferences.categories[row.key]}
                      aria-label={t(row.title)}
                      disabled={!preferences.enabled}
                      onClick={() => save({ categories: { ...preferences.categories, [row.key]: !preferences.categories[row.key] } })}
                    ><span /></button>
                  </div>
                ))}
              </div>
              {preferences.enabled && (
                <button type="button" className="notification-test-button" onClick={() => void sendTest()}>
                  <Bell size={17} />{t("sendTestNotification")}
                </button>
              )}
            </div>
          ) : (
            <div className="notifications-content notifications-inbox">
              <div className="notification-inbox-actions">
                <button type="button" disabled={!unreadCount} onClick={() => void markAllInboxNotificationsRead(profileId)}>{t("markAllRead")}</button>
                <button type="button" disabled={!inbox.length} onClick={() => void clearInboxNotifications(profileId)}>{t("clearAll")}</button>
              </div>
              {groups.length === 0 ? (
                <div className="notification-empty">
                  <div><Bell size={22} /></div>
                  <strong>{t("inboxEmpty")}</strong>
                  <p>{t("inboxEmptyDescription")}</p>
                </div>
              ) : groups.map((group) => (
                <section className="notification-group" key={group.title}>
                  <h3>{group.title}</h3>
                  {group.items.map((item) => (
                    <article className={`notification-inbox-card ${item.read_at ? "" : "unread"}`} key={item.id}>
                      <button type="button" className="notification-inbox-open" onClick={() => void openItem(item)}>
                        <span className="notification-unread-dot">{!item.read_at && <i />}</span>
                        <span className="notification-copy">
                          <strong>{item.title}</strong>
                          <p>{item.body}</p>
                          <small>{relativeTime(item.created_at)}</small>
                        </span>
                      </button>
                      <button type="button" className="notification-delete" aria-label={t("deleteNotification")} onClick={() => void deleteInboxNotification(item.id)}>
                        <Trash2 size={16} />
                      </button>
                    </article>
                  ))}
                </section>
              ))}
            </div>
          )}
        </section>
      </div>

      {timePickerOpen && (
        <div className="sheet-backdrop notification-time-backdrop" onMouseDown={() => setTimePickerOpen(false)}>
          <section className="notification-time-sheet" onMouseDown={(event) => event.stopPropagation()}>
            <header><h3>{t("chooseReminderTime")}</h3><button type="button" aria-label={t("close")} onClick={() => setTimePickerOpen(false)}><X size={19} /></button></header>
            <input
              type="time"
              value={preferences.reminderTime}
              onChange={(event) => save({ reminderTime: event.target.value })}
              aria-label={t("reminderTime")}
            />
            <button type="button" className="notification-time-done" onClick={() => setTimePickerOpen(false)}><Check size={17} />{t("close")}</button>
          </section>
        </div>
      )}
    </>
  );
}
