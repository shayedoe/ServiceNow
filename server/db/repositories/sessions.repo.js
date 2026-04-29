const { getDb } = require('../database');

function createSession({ tier, source, mode, total_questions }) {
  const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  getDb().prepare(`
    INSERT INTO sessions (id, started_at, tier, source, mode, total_questions)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, new Date().toISOString(), tier || null, source || 'offline', mode || null, total_questions || 0);
  return getSession(id);
}

function getSession(id) {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null;
}

function finishSession(id) {
  getDb().prepare('UPDATE sessions SET finished_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
  return getSession(id);
}

function listSessions(limit = 20) {
  return getDb().prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit);
}

module.exports = { createSession, getSession, finishSession, listSessions };
