const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { generateTickets } = require('../engine/generator');
const { scoreTicket } = require('../engine/scoring');
const { buildHints, HINT_PENALTY_PER_USE } = require('../engine/hints');
const sn = require('./servicenow');
const attempts = require('./attempts');

const dataPath = path.join(__dirname, '..', 'data', 'scenarios.json');

// In-memory ticket store for the current shift
let tickets = [];
let shiftScore = { resolved: 0, correct: 0, total: 0, earned: 0, total_weight: 0 };
let shiftId = null;
let shiftStartedAt = null;
let shiftMeta = { tier: 1, source: 'offline', mode: null };

function loadGroups() {
  const scenarios = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const groups = new Set();
  for (const cat of Object.values(scenarios.categories)) {
    groups.add(cat.assignment_group);
    for (const t of cat.templates) {
      if (t.correct_group) groups.add(t.correct_group);
      if (t.outage_correct_group) groups.add(t.outage_correct_group);
    }
  }
  return Array.from(groups).sort();
}

function startServer(port = 3017) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/groups', (_req, res) => {
    const groups = new Set(loadGroups());
    for (const t of tickets) {
      if (t.assignment_group) groups.add(t.assignment_group);
      if (t.correct_group) groups.add(t.correct_group);
    }
    res.json({ groups: Array.from(groups).sort() });
  });

  app.post('/api/shift/start', (req, res) => {
    try {
      const tier = Math.max(1, Math.min(3, Number((req.body || {}).tier) || 1));
      tickets = generateTickets(10, { tier });
      shiftId = `shift_${Date.now()}`;
      shiftStartedAt = new Date().toISOString();
      shiftMeta = { tier, source: 'offline', mode: null };
      shiftScore = { resolved: 0, correct: 0, total: 0, earned: 0, total_weight: 0, tier };
      res.json({ tickets, shiftScore, shift_id: shiftId, total_questions: tickets.length });
    } catch (err) {
      console.error('/api/shift/start error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ---- ServiceNow live mode ----
  app.get('/api/sn/config', (_req, res) => {
    res.json(sn.getPublicConfig());
  });

  app.post('/api/sn/config', (req, res) => {
    try {
      const next = sn.saveConfig(req.body || {});
      res.json(next);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/sn/test', async (_req, res) => {
    try {
      const r = await sn.testConnection();
      res.json(r);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.post('/api/sn/shift/start', async (req, res) => {
    try {
      const { mode = 'closed', limit = 10 } = req.body || {};
      const live = await sn.fetchIncidents({ mode, limit });
      tickets = live;
      shiftId = `shift_${Date.now()}`;
      shiftStartedAt = new Date().toISOString();
      shiftMeta = { tier: null, source: 'live', mode };
      shiftScore = { resolved: 0, correct: 0, total: 0, earned: 0, total_weight: 0, live: true, mode };
      res.json({ tickets, shiftScore, shift_id: shiftId, total_questions: tickets.length });
    } catch (err) {
      console.error('/api/sn/shift/start error:', err);
      res.status(502).json({ error: err.message });
    }
  });

  app.get('/api/tickets', (_req, res) => {
    res.json({ tickets, shiftScore });
  });

  app.get('/api/tickets/:number', (req, res) => {
    const t = tickets.find(x => x.number === req.params.number);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json(t);
  });

  app.patch('/api/tickets/:number', (req, res) => {
    const t = tickets.find(x => x.number === req.params.number);
    if (!t) return res.status(404).json({ error: 'Not found' });
    const { state, assigned_group, priority, note } = req.body || {};
    if (state) t.state = state;
    if (assigned_group !== undefined) t.assigned_group = assigned_group;
    if (priority !== undefined) t.priority_chosen = Number(priority);
    if (note && String(note).trim()) {
      t.notes.push({ at: new Date().toISOString(), text: String(note).trim() });
    }
    res.json(t);
  });

  app.post('/api/tickets/:number/hint', (req, res) => {
    const t = tickets.find(x => x.number === req.params.number);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.state === 'Resolved') return res.status(400).json({ error: 'Already resolved' });
    const hints = buildHints(t);
    t.hints_used = Math.min((t.hints_used || 0) + 1, hints.length);
    const hint = hints[t.hints_used - 1];
    res.json({ hint, hints_used: t.hints_used, total: hints.length, penalty_per_use: HINT_PENALTY_PER_USE });
  });

  app.post('/api/tickets/:number/resolve', (req, res) => {
    const t = tickets.find(x => x.number === req.params.number);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (t.state === 'Resolved') {
      return res.status(400).json({ error: 'Already resolved' });
    }
    const { action, assigned_group, priority, note } = req.body || {};
    if (note && String(note).trim()) {
      t.notes.push({ at: new Date().toISOString(), text: String(note).trim() });
    }
    if (assigned_group !== undefined) t.assigned_group = assigned_group;

    const userInput = {
      action,
      assigned_group: assigned_group || t.assigned_group,
      priority: priority !== undefined ? priority : t.priority_chosen,
      note: note || ''
    };

    const result = scoreTicket(t, userInput, tickets, {
      opened_at: t.created_at,
      submitted_at: Date.now()
    });
    const hintsUsed = t.hints_used || 0;
    if (hintsUsed > 0) {
      const penalty = Math.min(hintsUsed * HINT_PENALTY_PER_USE, result.pct);
      result.hint_penalty = penalty;
      result.hints_used = hintsUsed;
      result.pct_before_hints = result.pct;
      result.pct = Math.max(0, result.pct - penalty);
      result.score = `${result.pct}% (${result.correct}/${result.total} full credit, -${penalty}% hints)`;
    }
    t.state = 'Resolved';
    t.resolution = {
      action,
      submitted_at: new Date().toISOString(),
      result
    };

    shiftScore.resolved += 1;
    shiftScore.correct += result.correct;
    shiftScore.total += result.total;
    shiftScore.earned = (shiftScore.earned || 0) + (result.earned || 0);
    shiftScore.total_weight = (shiftScore.total_weight || 0) + (result.total_weight || 0);

    attempts.appendAttempt({
      shift_id: shiftId,
      shift_started_at: shiftStartedAt,
      submitted_at: t.resolution.submitted_at,
      ticket_number: t.number,
      short_description: t.short_description,
      category: t.category,
      tier: t.tier || 1,
      source: shiftMeta.source,
      hints_used: hintsUsed,
      pct: result.pct,
      pct_before_hints: result.pct_before_hints,
      earned: result.earned,
      total_weight: result.total_weight,
      correct: result.correct,
      total: result.total,
      action: t.resolution.action,
      expected_action: result.effective_action,
      assigned_group: userInput.assigned_group,
      expected_group: result.effective_group,
      priority_chosen: Number(priority) || null,
      expected_priority: t.priority,
      pattern_detected: result.pattern_detected
    });

    res.json({ ticket: t, result, shiftScore });
  });

  app.get('/api/shift/summary', (_req, res) => {
    const resolved = tickets.filter(t => t.state === 'Resolved' && t.resolution);
    const items = resolved.map(t => ({
      number: t.number,
      short_description: t.short_description,
      category: t.category,
      tier: t.tier || 1,
      pct: t.resolution.result.pct,
      hints_used: t.resolution.result.hints_used || 0,
      action: t.resolution.action,
      expected_action: t.resolution.result.effective_action
    }));
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

    res.json({
      shift_id: shiftId,
      shift_started_at: shiftStartedAt,
      shift_meta: shiftMeta,
      total_questions: tickets.length,
      resolved: items.length,
      remaining: tickets.length - items.length,
      avg_pct: avg,
      shift_score: shiftScore,
      tier_breakdown: tierBreakdown,
      category_breakdown: categoryBreakdown,
      weakest_categories: weakest,
      items,
      lifetime_attempts: attempts.readAttempts().length
    });
  });

  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Help Desk API listening on http://127.0.0.1:${port}`);
  });
  return server;
}

module.exports = startServer;

if (require.main === module) {
  startServer(Number(process.env.PORT) || 3017);
}
