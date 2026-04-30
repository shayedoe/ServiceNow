const { getDb } = require('../database');

const COLS = [
  'id','session_id','number','short_description','description','category',
  'tier','priority','impact','urgency','state','assignment_group',
  'correct_action','correct_group','expected_keywords','correct_steps',
  'required_events','response_deadline_minutes','partial_groups',
  'rationale','source','sn_sys_id','scenario_id','hints_used',
  'notes','caller_label','subcategory','business_service','cmdb_ci',
  'tool_clues','learning_objectives',
  'expected_priority','expected_impact','expected_urgency','expected_assignment_group',
  'created_at','resolved_at','resolution'
];

function insertTicket(t) {
  const db = getDb();
  const ser = (v, fallback) => {
    if (v === undefined || v === null) return typeof fallback === 'object' ? JSON.stringify(fallback) : (fallback ?? null);
    return typeof v === 'object' ? JSON.stringify(v) : v;
  };
  db.prepare(`
    INSERT OR REPLACE INTO tickets (${COLS.join(',')})
    VALUES (${COLS.map(() => '?').join(',')})
  `).run(
    t.id, t.session_id, t.number,
    t.short_description || '', t.description || '', t.category || '',
    t.tier || 1, t.priority || 3, t.impact || 3, t.urgency || 3,
    t.state || 'New', t.assignment_group || '',
    t.correct_action || '', t.correct_group || '',
    ser(t.expected_keywords, []), ser(t.correct_steps, []),
    ser(t.required_events, []), t.response_deadline_minutes || null,
    ser(t.partial_groups, {}), t.rationale || '',
    t.source || 'offline', t.sn_sys_id || null, t.scenario_id || null,
    t.hints_used || 0, ser(t.notes, []),
    t.caller_label || '', t.subcategory || '', t.business_service || '', t.cmdb_ci || '',
    ser(t.tool_clues, {}), ser(t.learning_objectives, []),
    t.expected_priority ?? null, t.expected_impact ?? null, t.expected_urgency ?? null,
    t.expected_assignment_group || '',
    t.created_at || new Date().toISOString(),
    t.resolved_at || null, ser(t.resolution, null)
  );
}

function getTicketById(id) {
  return hydrate(getDb().prepare('SELECT * FROM tickets WHERE id = ?').get(id));
}

function getTicketByNumber(number, session_id) {
  const row = session_id
    ? getDb().prepare('SELECT * FROM tickets WHERE number = ? AND session_id = ?').get(number, session_id)
    : getDb().prepare('SELECT * FROM tickets WHERE number = ? ORDER BY rowid DESC LIMIT 1').get(number);
  return hydrate(row);
}

function getSessionTickets(session_id) {
  return getDb().prepare('SELECT * FROM tickets WHERE session_id = ? ORDER BY rowid').all(session_id).map(hydrate);
}

function updateTicket(id, updates) {
  const db = getDb();
  const allowed = ['state','assignment_group','impact','urgency','priority','notes','hints_used','resolved_at','resolution'];
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!allowed.includes(k)) continue;
    sets.push(`${k} = ?`);
    vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
  }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function hydrate(row) {
  if (!row) return null;
  const jp = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
  return {
    ...row,
    expected_keywords: jp(row.expected_keywords, []),
    correct_steps: jp(row.correct_steps, []),
    required_events: jp(row.required_events, []),
    partial_groups: jp(row.partial_groups, {}),
    notes: jp(row.notes, []),
    tool_clues: jp(row.tool_clues, {}),
    learning_objectives: jp(row.learning_objectives, []),
    resolution: jp(row.resolution, null)
  };
}

module.exports = { insertTicket, getTicketById, getTicketByNumber, getSessionTickets, updateTicket };
