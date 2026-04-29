const { Router } = require('express');
const router = Router();
const sn = require('../servicenow');
const incidentService = require('../servicenow/incident.service');
const lookupService = require('../servicenow/lookup.service');
const metadataService = require('../servicenow/metadata.service');
const ticketsRepo = require('../db/repositories/tickets.repo');
const syncLinksRepo = require('../db/repositories/syncLinks.repo');
const state = require('../state');
const sessionsRepo = require('../db/repositories/sessions.repo');

// GET /api/sn/config
router.get('/sn/config', (_req, res) => {
  res.json(sn.getPublicConfig());
});

// POST /api/sn/config
router.post('/sn/config', (req, res) => {
  try {
    const next = sn.saveConfig(req.body || {});
    res.json(next);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/sn/test
router.get('/sn/test', async (_req, res) => {
  try {
    const r = await sn.testConnection();
    res.json(r);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/sn/shift/start — pull live tickets into a new session
router.post('/sn/shift/start', async (req, res) => {
  try {
    const { mode = 'closed', limit = 10 } = req.body || {};
    const live = await incidentService.listIncidents({ mode, limit });

    const { createSession } = require('../db/repositories/sessions.repo');
    const session = createSession({ source: 'live', mode, total_questions: live.length });
    state.setCurrentSession(session.id);

    const tickets = live.map((t, i) => {
      const id = `${session.id}_t${String(i + 1).padStart(3, '0')}`;
      const stored = { ...t, id, session_id: session.id };
      ticketsRepo.insertTicket(stored);
      // Record sync link
      if (t.sn?.sys_id) syncLinksRepo.createLink({ ticket_id: id, sn_sys_id: t.sn.sys_id, sn_number: t.number, sync_mode: 'pull' });
      return stored;
    });

    res.json({ session_id: session.id, tickets, total_questions: tickets.length, shiftScore: { resolved: 0, correct: 0, total: 0 } });
  } catch (err) {
    console.error('/api/sn/shift/start error:', err);
    res.status(502).json({ error: err.message });
  }
});

// POST /api/sn/training/create — create a training incident in ServiceNow
router.post('/sn/training/create', async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await incidentService.createIncident(payload);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// PATCH /api/sn/incidents/:sysId — patch a SN incident
router.patch('/sn/incidents/:sysId', async (req, res) => {
  try {
    const result = await incidentService.patchIncident(req.params.sysId, req.body || {});
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/sn/incidents/:sysId/work-note
router.post('/sn/incidents/:sysId/work-note', async (req, res) => {
  try {
    const result = await incidentService.addWorkNote(req.params.sysId, req.body?.note || '');
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/sn/incidents/:sysId/comment
router.post('/sn/incidents/:sysId/comment', async (req, res) => {
  try {
    const result = await incidentService.addCallerComment(req.params.sysId, req.body?.comment || '');
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/sn/incidents/:sysId/resolve
router.post('/sn/incidents/:sysId/resolve', async (req, res) => {
  try {
    const { close_code, close_notes } = req.body || {};
    const result = await incidentService.resolveIncident(req.params.sysId, close_code, close_notes);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// POST /api/sn/incidents/:sysId/link-parent
router.post('/sn/incidents/:sysId/link-parent', async (req, res) => {
  try {
    const result = await incidentService.linkParentIncident(req.params.sysId, req.body?.parent_sys_id || '');
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/sn/groups
router.get('/sn/groups', async (_req, res) => {
  try {
    const groups = await lookupService.listGroups();
    res.json({ groups });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/sn/users
router.get('/sn/users', async (_req, res) => {
  try {
    const users = await lookupService.listUsers();
    res.json({ users });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/sn/cis
router.get('/sn/cis', async (_req, res) => {
  try {
    const cis = await lookupService.listCIs();
    res.json({ cis });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/sn/choices/incident — sys_choice metadata for the incident form
router.get('/sn/choices/incident', async (_req, res) => {
  try {
    const meta = await metadataService.getIncidentMetadata();
    res.json(meta);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/sn/services
router.get('/sn/services', async (_req, res) => {
  try {
    const services = await metadataService.listServices();
    res.json({ services });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/sn/incidents — list rows for the queue view
router.get('/sn/incidents', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 25;
    const mode = req.query.mode || 'open';
    const rows = await incidentService.listIncidentRows({ limit, mode });
    res.json({ rows });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/sn/incidents/:sysId — flat incident for the form view
router.get('/sn/incidents/:sysId', async (req, res) => {
  try {
    const inc = await incidentService.getIncidentFlat(req.params.sysId);
    if (!inc) return res.status(404).json({ error: 'Incident not found' });
    res.json(inc);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/sn/incidents/:sysId/slas
router.get('/sn/incidents/:sysId/slas', async (req, res) => {
  try {
    const slas = await incidentService.fetchTaskSla(req.params.sysId);
    res.json({ slas });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/sn/incidents/:sysId/child-incidents
router.get('/sn/incidents/:sysId/child-incidents', async (req, res) => {
  try {
    const children = await incidentService.fetchChildIncidents(req.params.sysId);
    res.json({ children });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/sn/incidents/:sysId/affected-cis
router.get('/sn/incidents/:sysId/affected-cis', async (req, res) => {
  try {
    const cis = await incidentService.fetchAffectedCis(req.params.sysId);
    res.json({ cis });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// GET /api/sn/incidents/:sysId/activity
router.get('/sn/incidents/:sysId/activity', async (req, res) => {
  try {
    const activity = await incidentService.fetchActivity(req.params.sysId);
    res.json({ activity });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
