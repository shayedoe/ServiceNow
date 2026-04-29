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
  return db;
}

module.exports = { getDb, setUserDataDir };
