const { Router } = require('express');
const path = require('path');
const fs = require('fs');

const router = Router();

let cache = null;
function loadCatalog() {
  if (cache) return cache;
  try {
    const p = path.join(__dirname, '..', '..', 'data', 'callers.json');
    cache = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    cache = { items: {} };
  }
  return cache;
}

function fullName(c) {
  return `${c.first_name || ''} ${c.last_name || ''}`.trim();
}

function findByKey(key) {
  if (!key) return null;
  const items = loadCatalog().items || {};
  if (items[key]) return items[key];
  const lower = String(key).toLowerCase();
  if (items[lower]) return items[lower];
  for (const k of Object.keys(items)) {
    const c = items[k];
    if (k.toLowerCase() === lower) return c;
    if (fullName(c).toLowerCase() === lower) return c;
    if ((c.email || '').toLowerCase() === lower) return c;
  }
  return null;
}

router.get('/callers', (_req, res) => {
  const items = loadCatalog().items || {};
  res.json({ items: Object.values(items) });
});

router.get('/callers/:key', (req, res) => {
  const found = findByKey(decodeURIComponent(req.params.key || ''));
  if (found) return res.json(found);
  // Synthesize a minimal record so unknown callers still render in the modal
  const raw = decodeURIComponent(req.params.key || '');
  const parts = raw.split(/[\s.]+/).filter(Boolean);
  res.json({
    user_id: raw.toLowerCase().replace(/\s+/g, '.'),
    first_name: parts[0] || raw,
    last_name: parts.slice(1).join(' ') || '',
    title: '(not on file)',
    department: '(not on file)',
    email: '',
    business_phone: '',
    mobile_phone: '',
    time_zone: '',
    language: 'en',
    notification: '',
    locked_out: false,
    password_needs_reset: false,
    active: true,
    synthesized: true
  });
});

module.exports = router;
