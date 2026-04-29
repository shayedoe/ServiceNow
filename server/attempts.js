/**
 * Attempt log — append-only JSONL at <userData>/attempts.jsonl.
 * One line per resolved ticket. Used for the shift summary screen
 * and any future progress tracking.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let userDataDir = path.join(os.homedir(), '.helpdesksim');

function setUserDataDir(dir) { userDataDir = dir; }

function logPath() { return path.join(userDataDir, 'attempts.jsonl'); }

function appendAttempt(record) {
  try {
    if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
    fs.appendFileSync(logPath(), JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    console.error('appendAttempt failed:', err.message);
  }
}

function readAttempts() {
  try {
    const raw = fs.readFileSync(logPath(), 'utf8');
    return raw.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

module.exports = { setUserDataDir, appendAttempt, readAttempts };
