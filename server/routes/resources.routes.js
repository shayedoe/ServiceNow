const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const router = Router();

const RESOURCES_PATH = path.join(__dirname, '..', '..', 'data', 'resources', 'helpdesk_resources.json');

let cached = null;
function loadResources() {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(RESOURCES_PATH, 'utf8'));
  } catch (err) {
    console.warn('resources load failed:', err.message);
    cached = {};
  }
  return cached;
}

// GET /api/resources — full training resources doc
router.get('/resources', (req, res) => {
  res.json(loadResources());
});

module.exports = router;
