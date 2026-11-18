CREATE TABLE IF NOT EXISTS notification_push_subscriptions (
  endpoint_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  preferences TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS notification_push_subscriptions_uid
  ON notification_push_subscriptions(uid);

CREATE TABLE IF NOT EXISTS notification_push_reminders (
  uid TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  type TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (uid, reminder_id)
);

CREATE INDEX IF NOT EXISTS notification_push_reminders_due
  ON notification_push_reminders(due_at, expires_at);

CREATE TABLE IF NOT EXISTS notification_push_deliveries (
  uid TEXT NOT NULL,
  reminder_id TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (uid, reminder_id, endpoint_hash)
);
