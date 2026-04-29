const { Router } = require('express');
const router = Router();

const sessionsRepo = require('../db/repositories/sessions.repo');
const ticketsRepo = require('../db/repositories/tickets.repo');
const attemptsRepo = require('../db/repositories/attempts.repo');
const state = require('../state');
const { generateTickets } = require('../../engine/generator');
const scenarioLoader = require('../../engine/scenarioLoader');

/**
 * Convert an authored scenario pack into a local ticket object.
 */
function scenarioToTicket(scenario, idx, session_id) {
  const seed = scenario.servicenow_seed || {};
  const exp = scenario.expected || {};
  const id = `${session_id}_t${String(idx + 1).padStart(3, '0')}`;
  return {
    id,
    session_id,
    number: `TKT${String(1000 + idx + 1)}`,
    short_description: seed.short_description || scenario.title || '',
    description: seed.description || '',
    category: seed.category || 'general',
    subcategory: seed.subcategory || '',
    business_service: seed.business_service || '',
    cmdb_ci: seed.cmdb_ci || '',
    caller_label: seed.caller_id || 'Training User',
    tier: scenario.tier || 1,
    priority: Number(exp.priority) || 3,
    impact: Number(seed.impact) || 3,
    urgency: Number(seed.urgency) || 3,
    state: 'New',
    assignment_group: exp.assignment_group || '',
    correct_action: exp.action || 'resolve',
    correct_group: exp.assignment_group || '',
    expected_keywords: exp.required_note_keywords || [],
    correct_steps: scenario.correct_steps || [],
    required_events: exp.required_events || [],
    response_deadline_minutes: scenario.response_deadline_minutes || null,
    partial_groups: scenario.partial_groups || {},
    rationale: scenario.rationale || '',
    tool_clues: scenario.tool_clues || {},
    learning_objectives: scenario.learning_objectives || [],
    source: 'authored',
    scenario_id: scenario.id,
    hints_used: 0,
    notes: [],
    created_at: new Date().toISOString()
  };
}

/**
 * Convert a generator ticket into a DB-storable ticket.
 */
function generatorToTicket(t, idx, session_id) {
  const id = `${session_id}_t${String(idx + 1).padStart(3, '0')}`;
  return { ...t, id, session_id, notes: t.notes || [], hints_used: 0 };
}

// POST /api/sessions/start
router.post('/sessions/start', (req, res) => {
  try {
    const { tier = 1, source = 'offline', mode } = req.body || {};
    const tierLevel = Math.max(1, Math.min(3, Number(tier)));

    let rawTickets;
    if (source === 'authored') {
      const scenarios = scenarioLoader.forTier(tierLevel);
      if (!scenarios.length) {
        return res.status(400).json({ error: 'No authored scenarios found for this tier.' });
      }
      // Shuffle and cap at 10
      const shuffled = scenarios.sort(() => Math.random() - 0.5).slice(0, 10);
      const session = sessionsRepo.createSession({ tier: tierLevel, source: 'authored', mode, total_questions: shuffled.length });
      state.setCurrentSession(session.id);
      const tickets = shuffled.map((s, i) => {
        const t = scenarioToTicket(s, i, session.id);
        ticketsRepo.insertTicket(t);
        return t;
      });
      return res.json({ session_id: session.id, tickets, total_questions: tickets.length, shiftScore: emptyScore(tierLevel) });
    }

    // Default: offline generator
    rawTickets = generateTickets(10, { tier: tierLevel });
    const session = sessionsRepo.createSession({ tier: tierLevel, source: 'offline', mode, total_questions: rawTickets.length });
    state.setCurrentSession(session.id);
    const tickets = rawTickets.map((t, i) => {
      const stored = generatorToTicket(t, i, session.id);
      ticketsRepo.insertTicket(stored);
      return stored;
    });
    res.json({ session_id: session.id, tickets, total_questions: tickets.length, shiftScore: emptyScore(tierLevel) });
  } catch (err) {
    console.error('/api/sessions/start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Keep backward-compat alias
router.post('/shift/start', (req, res, next) => {
  req.body = req.body || {};
  if (!req.body.source) req.body.source = 'offline';
  // re-dispatch to sessions/start logic by calling next handler inline
  res.locals._legacyShift = true;
  next();
}, (req, res) => {
  res.redirect(307, '/api/sessions/start');
});

// GET /api/sessions/current
router.get('/sessions/current', (req, res) => {
  const sid = state.getCurrentSession();
  if (!sid) return res.json({ session: null, tickets: [] });
  const session = sessionsRepo.getSession(sid);
  const tickets = ticketsRepo.getSessionTickets(sid);
  res.json({ session, tickets });
});

// GET /api/sessions/current/summary  (also handles legacy GET /api/shift/summary)
function buildSummary(sid) {
  const session = sessionsRepo.getSession(sid);
  if (!session) return null;
  const tickets = ticketsRepo.getSessionTickets(sid);
  const resolved = tickets.filter(t => t.state === 'Resolved' && t.resolution);

  const items = resolved.map(t => {
    const r = t.resolution;
    return {
      number: t.number,
      short_description: t.short_description,
      category: t.category,
      tier: t.tier || 1,
      pct: r.pct || 0,
      hints_used: r.hints_used || 0,
      action: r.action,
      expected_action: r.effective_action,
      events_performed: r.events_performed || []
    };
  });

  const avg = items.length
    ? Math.round(items.reduce((s, x) => s + x.pct, 0) / items.length)
    : 0;

  const byTier = {};
  const byCategory = {};
  for (const it of items) {
    const tk = `T${it.tier}`;
    byTier[tk] = byTier[tk] || { count: 0, sum: 0 };
    byTier[tk].count += 1; byTier[tk].sum += it.pct;
    byCategory[it.category] = byCategory[it.category] || { count: 0, sum: 0 };
    byCategory[it.category].count += 1; byCategory[it.category].sum += it.pct;
  }

  const tierBreakdown = Object.fromEntries(
    Object.entries(byTier).map(([k, v]) => [k, { count: v.count, avg: Math.round(v.sum / v.count) }])
  );
  const categoryBreakdown = Object.fromEntries(
    Object.entries(byCategory).map(([k, v]) => [k, { count: v.count, avg: Math.round(v.sum / v.count) }])
  );
  const weakest = Object.entries(categoryBreakdown)
    .sort((a, b) => a[1].avg - b[1].avg)
    .slice(0, 3)
    .map(([k, v]) => ({ category: k, avg: v.avg, count: v.count }));

  return {
    session,
    total_questions: tickets.length,
    resolved: items.length,
    remaining: tickets.length - items.length,
    avg_pct: avg,
    tier_breakdown: tierBreakdown,
    category_breakdown: categoryBreakdown,
    weakest_categories: weakest,
    items,
    lifetime_attempts: attemptsRepo.getLifetimeCount()
  };
}

router.get('/sessions/current/summary', (req, res) => {
  const sid = state.getCurrentSession();
  if (!sid) return res.status(404).json({ error: 'No active session.' });
  const s = buildSummary(sid);
  if (!s) return res.status(404).json({ error: 'Session not found.' });
  res.json(s);
});

// Legacy alias
router.get('/shift/summary', (req, res) => {
  const sid = state.getCurrentSession();
  if (!sid) return res.status(404).json({ error: 'No active session.' });
  const s = buildSummary(sid);
  if (!s) return res.status(404).json({ error: 'Session not found.' });
  res.json(s);
});

// GET /api/sessions — list session history
router.get('/sessions', (_req, res) => {
  res.json({ sessions: sessionsRepo.listSessions(30) });
});

function emptyScore(tier) {
  return { resolved: 0, correct: 0, total: 0, earned: 0, total_weight: 0, tier };
}

module.exports = router;
