const { getDb } = require('../database');

function logEvent({ session_id, ticket_id, action_type, payload }) {
  getDb().prepare(`
    INSERT INTO attempt_events (session_id, ticket_id, action_type, payload, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(session_id, ticket_id, action_type, JSON.stringify(payload || {}), new Date().toISOString());
}

function getTicketEvents(ticket_id) {
  return getDb()
    .prepare('SELECT * FROM attempt_events WHERE ticket_id = ? ORDER BY created_at')
    .all(ticket_id)
    .map(r => ({ ...r, payload: JSON.parse(r.payload || '{}') }));
}

function getSessionEvents(session_id) {
  return getDb()
    .prepare('SELECT * FROM attempt_events WHERE session_id = ? ORDER BY created_at')
    .all(session_id)
    .map(r => ({ ...r, payload: JSON.parse(r.payload || '{}') }));
}

function saveRubricResult({ session_id, ticket_id, pct, pct_before_hints, earned, total_weight, hints_used, hint_penalty, details }) {
  getDb().prepare(`
    INSERT INTO rubric_results
      (session_id, ticket_id, pct, pct_before_hints, earned, total_weight, hints_used, hint_penalty, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session_id, ticket_id, pct, pct_before_hints ?? pct,
    earned, total_weight, hints_used || 0, hint_penalty || 0,
    JSON.stringify(details || []), new Date().toISOString()
  );
}

function getLifetimeCount() {
  const r = getDb().prepare('SELECT COUNT(*) as cnt FROM rubric_results').get();
  return r ? r.cnt : 0;
}

module.exports = { logEvent, getTicketEvents, getSessionEvents, saveRubricResult, getLifetimeCount };
