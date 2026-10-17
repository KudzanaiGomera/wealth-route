CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX passkeys_by_uid ON passkeys(uid);

CREATE TABLE passkey_challenges (
  challenge_id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  uid TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  expires_at INTEGER NOT NULL
);

CREATE INDEX passkey_challenges_expiry ON passkey_challenges(expires_at);