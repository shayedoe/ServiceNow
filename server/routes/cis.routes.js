const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const router = Router();

const CIS_PATH = path.join(__dirname, '..', '..', 'data', 'cis.json');

let cache = null;
function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(CIS_PATH, 'utf8'));
  } catch (err) {
    console.warn('cis load failed:', err.message);
    cache = { items: {} };
  }
  return cache;
}

function findCi(name) {
  if (!name) return null;
  const data = load();
  const items = data.items || {};
  const wanted = String(name).trim().toLowerCase();
  for (const k of Object.keys(items)) {
    if (k.toLowerCase() === wanted) return { ...items[k], _key: k };
  }
  // Fallback: synthesize a basic record
  return {
    _key: name,
    name,
    type: 'Configuration Item',
    owned_by: '(unknown)',
    criticality: '3 - low',
    operational_status: 'Operational',
    support_group: '(unassigned)',
    description: 'No detailed CI record on file. This is a synthesized placeholder.',
    depends_on: [],
    used_by: [],
    recent_changes: [],
    active_alerts: []
  };
}

router.get('/cis/:name', (req, res) => {
  const ci = findCi(req.params.name);
  res.json(ci);
});

router.get('/cis', (req, res) => {
  res.json(load());
});

module.exports = router;
