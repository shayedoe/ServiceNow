const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

let db = null;
let userDataDir = path.join(os.homedir(), '.helpdesksim');

function setUserDataDir(dir) {
  userDataDir = dir;
  db = null; // reset so next getDb() re-inits against new path
}

function getDb() {
  if (db) return db;
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, 'helpdesk.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // Lightweight migrations: add columns to existing DBs that pre-date them
  const ensureCol = (table, col, decl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
    if (!cols.includes(col)) {
      try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); } catch (e) { console.warn('migration', col, e.message); }
    }
  };
  ensureCol('tickets', 'caller_label', "TEXT DEFAULT ''");
  ensureCol('tickets', 'subcategory', "TEXT DEFAULT ''");
  ensureCol('tickets', 'business_service', "TEXT DEFAULT ''");
  ensureCol('tickets', 'cmdb_ci', "TEXT DEFAULT ''");
  ensureCol('tickets', 'tool_clues', "TEXT DEFAULT '{}'");
  ensureCol('tickets', 'learning_objectives', "TEXT DEFAULT '[]'");
  return db;
}

module.exports = { getDb, setUserDataDir };
