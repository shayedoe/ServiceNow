const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const router = Router();
const scenarioLoader = require('../../engine/scenarioLoader');

// Collect all known assignment groups from scenarios.json + authored packs
function getAllGroups() {
  const groups = new Set();

  // Legacy scenarios.json
  try {
    const legacyPath = path.join(__dirname, '..', '..', 'data', 'scenarios.json');
    const data = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    for (const cat of Object.values(data.categories || {})) {
      if (cat.assignment_group) groups.add(cat.assignment_group);
      for (const t of cat.templates || []) {
        if (t.correct_group) groups.add(t.correct_group);
        if (t.outage_correct_group) groups.add(t.outage_correct_group);
      }
    }
  } catch { /* ignore */ }

  // Authored scenario packs
  for (const s of scenarioLoader.loadAll()) {
    const g = s.expected?.assignment_group;
    if (g) groups.add(g);
  }

  return Array.from(groups).sort();
}

// GET /api/groups
router.get('/groups', (req, res) => {
  res.json({ groups: getAllGroups() });
});

// GET /api/scenarios — list all authored scenarios
router.get('/scenarios', (req, res) => {
  const tier = req.query.tier ? Number(req.query.tier) : null;
  const all = tier ? scenarioLoader.forTier(tier) : scenarioLoader.loadAll();
  res.json({
    scenarios: all.map(s => ({
      id: s.id, title: s.title, tier: s.tier,
      category: s.servicenow_seed?.category || '',
      assignment_group: s.expected?.assignment_group || ''
    }))
  });
});

// GET /api/scenarios/:id
router.get('/scenarios/:id', (req, res) => {
  const s = scenarioLoader.byId(req.params.id);
  if (!s) return res.status(404).json({ error: 'Scenario not found' });
  res.json(s);
});

module.exports = router;
