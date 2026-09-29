import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./env";

/**
 * One SQLite file next to the uploads. The web app is the only writer —
 * workers and the summary agent reach the data through the HTTP API — so
 * there is no need for a database server.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id          TEXT PRIMARY KEY,          -- OpenSax sub
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    last_login  INTEGER NOT NULL
  );
  -- Snapshot of LernSax memberships from the last login.
  CREATE TABLE user_groups (
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL,
    name     TEXT NOT NULL,
    kind     TEXT NOT NULL CHECK (kind IN ('school', 'class')),
    PRIMARY KEY (user_id, group_id)
  );
  CREATE TABLE sessions (
    id_hash    TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE units (
    id            TEXT PRIMARY KEY,
    owner_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    subject       TEXT NOT NULL DEFAULT '',
    held_on       TEXT,                    -- YYYY-MM-DD
    notes         TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    -- Bumped whenever anything a summary is built from changes. A summary
    -- is due while summary_rev < material_rev.
    material_rev  INTEGER NOT NULL DEFAULT 0,
    summary_md    TEXT,
    summary_rev   INTEGER NOT NULL DEFAULT 0,
    summary_at    INTEGER,
    summary_by    TEXT CHECK (summary_by IN ('api', 'manual')),
    share_scope   TEXT NOT NULL DEFAULT 'private' CHECK (share_scope IN ('private', 'school', 'lernsax')),
    share_school  TEXT,                    -- group_id of the school for share_scope = 'school'
    share_materials INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX units_owner ON units(owner_id, held_on DESC);
  CREATE INDEX units_shared ON units(share_scope, share_school);
  CREATE TABLE files (
    id          TEXT PRIMARY KEY,
    unit_id     TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('audio', 'document', 'image', 'other')),
    name        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    size        INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    -- Audio: language / speaker hints for the transcription.
    options     TEXT NOT NULL DEFAULT '{}',
    extracted_text TEXT,
    extract_meta   TEXT
  );
  CREATE INDEX files_unit ON files(unit_id, created_at);
  CREATE TABLE transcripts (
    file_id    TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    language   TEXT,
    duration   REAL,
    model      TEXT,
    diarized   INTEGER NOT NULL DEFAULT 0,
    segments   TEXT NOT NULL,              -- JSON [{start,end,speaker,text}]
    speakers   TEXT NOT NULL DEFAULT '{}', -- JSON {"SPEAKER_00": "Lehrkraft"}
    created_at INTEGER NOT NULL
  );
  CREATE TABLE jobs (
    id           TEXT PRIMARY KEY,
    file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('transcribe', 'extract')),
    status       TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    attempts     INTEGER NOT NULL DEFAULT 0,
    worker_id    TEXT,
    lease_until  INTEGER,
    error        TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX jobs_status ON jobs(status, created_at);
  CREATE TABLE api_tokens (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER
  );
  `,
];

function open(): Database.Database {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(join(config.dataDir, "lessionsummary.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

let instance: Database.Database | null = null;

/** Opened on first use, not at import, so `vite build` never touches disk. */
export function db(): Database.Database {
  instance ??= open();
  return instance;
}
