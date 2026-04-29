PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT PRIMARY KEY,
  started_at       TEXT NOT NULL,
  finished_at      TEXT,
  tier             INTEGER,
  source           TEXT DEFAULT 'offline',
  mode             TEXT,
  total_questions  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tickets (
  id                        TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL,
  number                    TEXT NOT NULL,
  short_description         TEXT NOT NULL DEFAULT '',
  description               TEXT DEFAULT '',
  category                  TEXT DEFAULT '',
  tier                      INTEGER DEFAULT 1,
  priority                  INTEGER DEFAULT 3,
  impact                    INTEGER DEFAULT 3,
  urgency                   INTEGER DEFAULT 3,
  state                     TEXT DEFAULT 'New',
  assignment_group          TEXT DEFAULT '',
  correct_action            TEXT DEFAULT '',
  correct_group             TEXT DEFAULT '',
  expected_keywords         TEXT DEFAULT '[]',
  correct_steps             TEXT DEFAULT '[]',
  required_events           TEXT DEFAULT '[]',
  response_deadline_minutes INTEGER,
  partial_groups            TEXT DEFAULT '{}',
  rationale                 TEXT DEFAULT '',
  source                    TEXT DEFAULT 'offline',
  sn_sys_id                 TEXT,
  scenario_id               TEXT,
  hints_used                INTEGER DEFAULT 0,
  notes                     TEXT DEFAULT '[]',
  caller_label              TEXT DEFAULT '',
  subcategory               TEXT DEFAULT '',
  business_service          TEXT DEFAULT '',
  cmdb_ci                   TEXT DEFAULT '',
  tool_clues                TEXT DEFAULT '{}',
  learning_objectives       TEXT DEFAULT '[]',
  created_at                TEXT NOT NULL,
  resolved_at               TEXT,
  resolution                TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempt_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL,
  ticket_id    TEXT NOT NULL,
  action_type  TEXT NOT NULL,
  payload      TEXT DEFAULT '{}',
  created_at   TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rubric_results (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT NOT NULL,
  ticket_id        TEXT NOT NULL,
  pct              INTEGER DEFAULT 0,
  pct_before_hints INTEGER DEFAULT 0,
  earned           REAL DEFAULT 0,
  total_weight     REAL DEFAULT 0,
  hints_used       INTEGER DEFAULT 0,
  hint_penalty     INTEGER DEFAULT 0,
  details          TEXT DEFAULT '[]',
  created_at       TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS servicenow_sync_links (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id      TEXT NOT NULL,
  sn_sys_id      TEXT NOT NULL,
  sn_number      TEXT,
  sync_mode      TEXT DEFAULT 'pull',
  last_synced_at TEXT,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lookup_cache (
  cache_key  TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  cached_at  TEXT NOT NULL,
  ttl_seconds INTEGER DEFAULT 3600
);
