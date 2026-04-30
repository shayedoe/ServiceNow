const { Router } = require('express');
const router = Router();

const ticketsRepo = require('../db/repositories/tickets.repo');
const attemptsRepo = require('../db/repositories/attempts.repo');
const syncLinksRepo = require('../db/repositories/syncLinks.repo');
const state = require('../state');
const { scoreTicket } = require('../../engine/scoring');
const { buildHints, HINT_PENALTY_PER_USE } = require('../../engine/hints');

// Helper: current session tickets as in-memory-compatible objects
function currentTickets() {
  const sid = state.getCurrentSession();
  return sid ? ticketsRepo.getSessionTickets(sid) : [];
}

// GET /api/tickets — list all tickets in current session
router.get('/tickets', (req, res) => {
  const sid = state.getCurrentSession();
  const tickets = sid ? ticketsRepo.getSessionTickets(sid) : [];
  res.json({ tickets, shiftScore: computeShiftScore(tickets) });
});

// GET /api/tickets/:number
router.get('/tickets/:number', (req, res) => {
  const sid = state.getCurrentSession();
  const t = ticketsRepo.getTicketByNumber(req.params.number, sid);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const events = attemptsRepo.getTicketEvents(t.id);
  res.json({ ...t, events });
});

// PATCH /api/tickets/:number — update fields
router.patch('/tickets/:number', (req, res) => {
  const sid = state.getCurrentSession();
  const t = ticketsRepo.getTicketByNumber(req.params.number, sid);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { assigned_group, priority, impact, urgency, note } = req.body || {};
  const updates = {};
  if (assigned_group !== undefined) updates.assignment_group = assigned_group;
  if (impact !== undefined) updates.impact = Number(impact);
  if (urgency !== undefined) updates.urgency = Number(urgency);
  if (note && String(note).trim()) {
    const notes = [...(t.notes || []), { at: new Date().toISOString(), text: String(note).trim() }];
    updates.notes = notes;
  }
  ticketsRepo.updateTicket(t.id, updates);
  const updated = ticketsRepo.getTicketByNumber(req.params.number, sid);
  res.json(updated);
});

// POST /api/tickets/:number/event — log an action event
router.post('/tickets/:number/event', (req, res) => {
  const sid = state.getCurrentSession();
  const t = ticketsRepo.getTicketByNumber(req.params.number, sid);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.state === 'Resolved') return res.status(400).json({ error: 'Ticket already resolved' });

  const { action_type, payload } = req.body || {};
  if (!action_type) return res.status(400).json({ error: 'action_type required' });

  // Side effects for specific actions
  if (action_type === 'set_impact_urgency' && payload) {
    const updates = {};
    if (payload.impact) updates.impact = Number(payload.impact);
    if (payload.urgency) updates.urgency = Number(payload.urgency);
    if (Object.keys(updates).length) ticketsRepo.updateTicket(t.id, updates);
  }

  if (action_type === 'set_priority' && payload?.priority) {
    ticketsRepo.updateTicket(t.id, { priority: Number(payload.priority) });
  }

  if (action_type === 'assign_group' && payload?.group) {
    ticketsRepo.updateTicket(t.id, { assignment_group: payload.group });
  }

  if ((action_type === 'add_work_note' || action_type === 'add_comment') && payload?.text) {
    const updated = ticketsRepo.getTicketByNumber(req.params.number, sid);
    const notes = [...(updated.notes || []), { at: new Date().toISOString(), text: String(payload.text) }];
    ticketsRepo.updateTicket(t.id, { notes });
  }

  attemptsRepo.logEvent({ session_id: sid, ticket_id: t.id, action_type, payload });
  const events = attemptsRepo.getTicketEvents(t.id);
  res.json({ ok: true, events_count: events.length, events });
});

// POST /api/tickets/:number/hint
router.post('/tickets/:number/hint', (req, res) => {
  const sid = state.getCurrentSession();
  const t = ticketsRepo.getTicketByNumber(req.params.number, sid);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.state === 'Resolved') return res.status(400).json({ error: 'Already resolved' });

  const hints = buildHints(t);
  const newUsed = Math.min((t.hints_used || 0) + 1, hints.length);
  ticketsRepo.updateTicket(t.id, { hints_used: newUsed });
  attemptsRepo.logEvent({ session_id: sid, ticket_id: t.id, action_type: 'hint_used', payload: { level: newUsed } });

  const hint = hints[newUsed - 1];
  res.json({ hint, hints_used: newUsed, total: hints.length, penalty_per_use: HINT_PENALTY_PER_USE });
});

// POST /api/tickets/:number/resolve
router.post('/tickets/:number/resolve', (req, res) => {
  const sid = state.getCurrentSession();
  const t = ticketsRepo.getTicketByNumber(req.params.number, sid);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.state === 'Resolved') return res.status(400).json({ error: 'Already resolved' });

  const { action, assigned_group, priority, note } = req.body || {};

  if (note && String(note).trim()) {
    const notes = [...(t.notes || []), { at: new Date().toISOString(), text: String(note).trim() }];
    ticketsRepo.updateTicket(t.id, { notes });
  }
  if (assigned_group !== undefined) ticketsRepo.updateTicket(t.id, { assignment_group: assigned_group });

  // Log resolve/escalate event
  attemptsRepo.logEvent({ session_id: sid, ticket_id: t.id, action_type: action === 'escalate' ? 'escalate' : 'resolve', payload: {} });

  const fresh = ticketsRepo.getTicketByNumber(req.params.number, sid);
  const events = attemptsRepo.getTicketEvents(fresh.id);

  const userInput = {
    action,
    assigned_group: assigned_group || fresh.assignment_group,
    priority: priority !== undefined ? Number(priority) : fresh.priority,
    note: note || ''
  };

  const allTickets = currentTickets();
  const result = scoreTicket(fresh, userInput, allTickets, {
    opened_at: fresh.created_at,
    submitted_at: Date.now(),
    events
  });

  // Apply hint penalty
  const hintsUsed = fresh.hints_used || 0;
  if (hintsUsed > 0) {
    const penalty = Math.min(hintsUsed * HINT_PENALTY_PER_USE, result.pct);
    result.hint_penalty = penalty;
    result.hints_used = hintsUsed;
    result.pct_before_hints = result.pct;
    result.pct = Math.max(0, result.pct - penalty);
    result.score = `${result.pct}% (${result.correct}/${result.total} full credit, -${penalty}% hints)`;
  }
  result.events_performed = [...new Set(events.map(e => e.action_type))];

  const resolution = {
    action,
    submitted_at: new Date().toISOString(),
    ...result
  };

  ticketsRepo.updateTicket(fresh.id, {
    state: 'Resolved',
    resolved_at: new Date().toISOString(),
    resolution
  });

  attemptsRepo.saveRubricResult({
    session_id: sid,
    ticket_id: fresh.id,
    pct: result.pct,
    pct_before_hints: result.pct_before_hints ?? result.pct,
    earned: result.earned,
    total_weight: result.total_weight,
    hints_used: hintsUsed,
    hint_penalty: result.hint_penalty || 0,
    details: result.details
  });

  const resolvedTicket = ticketsRepo.getTicketByNumber(req.params.number, sid);
  const allFresh = currentTickets();
  const shiftScore = computeShiftScore(allFresh);

  res.json({ ticket: resolvedTicket, result, shiftScore, events });
});

function computeShiftScore(tickets) {
  const resolved = tickets.filter(t => t.state === 'Resolved' && t.resolution);
  const earned = resolved.reduce((s, t) => s + (t.resolution?.earned || 0), 0);
  const tw = resolved.reduce((s, t) => s + (t.resolution?.total_weight || 0), 0);
  return {
    resolved: resolved.length,
    correct: resolved.filter(t => (t.resolution?.pct || 0) >= 70).length,
    total: tickets.length,
    earned: Math.round(earned * 10) / 10,
    total_weight: Math.round(tw * 10) / 10
  };
}

module.exports = router;
