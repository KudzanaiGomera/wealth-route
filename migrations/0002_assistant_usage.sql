CREATE TABLE IF NOT EXISTS assistant_usage (
  uid TEXT NOT NULL,
  day TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, day)
);