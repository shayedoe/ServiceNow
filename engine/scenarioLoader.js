/**
 * Loads authored scenario packs from data/scenarios/tier{1,2,3}/.
 * Each file is a JSON object matching the scenario schema.
 */
const fs = require('fs');
const path = require('path');

const SCENARIOS_DIR = path.join(__dirname, '..', 'data', 'scenarios');

function loadAll() {
  const all = [];
  for (const tier of ['tier1', 'tier2', 'tier3']) {
    const dir = path.join(SCENARIOS_DIR, tier);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        all.push(raw);
      } catch (err) {
        console.warn(`scenarioLoader: failed to parse ${tier}/${f}:`, err.message);
      }
    }
  }
  return all;
}

function forTier(tierLevel) {
  return loadAll().filter(s => s.tier <= tierLevel);
}

function byId(id) {
  return loadAll().find(s => s.id === id) || null;
}

module.exports = { loadAll, forTier, byId };
