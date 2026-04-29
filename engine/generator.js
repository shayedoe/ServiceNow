const fs = require('fs');
const path = require('path');

const scenariosPath = path.join(__dirname, '..', 'data', 'scenarios.json');

function loadScenarios() {
  return JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));
}

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pad(n, len = 7) {
  return String(n).padStart(len, '0');
}

let counter = 1000;
function nextNumber() {
  counter += 1;
  return 'INC' + pad(counter);
}

function fillTemplate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] || '');
}

function buildTicket(category, group, template, vars, overrides = {}) {
  const base = {
    number: nextNumber(),
    short_description: fillTemplate(template.short_description, vars),
    description: fillTemplate(template.description, vars),
    priority: template.priority,
    category,
    tier: template.tier || 1,
    assignment_group: group,
    correct_action: template.correct_action,
    correct_group: template.correct_group || group,
    correct_steps: template.correct_steps.slice(),
    expected_keywords: (template.expected_keywords || []).slice(),
    rationale: template.rationale || '',
    state: 'New',
    assigned_group: null,
    notes: [],
    created_at: new Date().toISOString()
  };
  return Object.assign(base, overrides);
}

function generateOutageBatch(category, group, template, vars) {
  const count = 3 + Math.floor(Math.random() * 3); // 3-5
  const outageVars = Object.assign({}, vars);
  const outageOverrides = {
    short_description: fillTemplate(template.outage_short_description, outageVars),
    description: fillTemplate(template.outage_description, outageVars),
    correct_action: template.outage_correct_action || 'escalate',
    correct_group: template.outage_correct_group || group,
    priority: 1,
    is_outage: true,
    rationale: 'Multiple tickets share this description. This is an outage pattern — the correct action is to escalate (or link to a parent INC), not to resolve individually.',
    outage_id: 'OUT-' + Date.now() + '-' + Math.floor(Math.random() * 1000)
  };
  const tickets = [];
  for (let i = 0; i < count; i++) {
    tickets.push(buildTicket(category, group, template, outageVars, outageOverrides));
  }
  return tickets;
}

function templatesForTier(scenarios, tier) {
  // Tier 1 = only tier-1; Tier 2 = tier 1 + 2; Tier 3 = all
  const out = [];
  for (const c of Object.keys(scenarios.categories)) {
    for (const t of scenarios.categories[c].templates) {
      const tt = t.tier || 1;
      if (tt <= tier) out.push({ category: c, template: t });
    }
  }
  return out;
}

function generateTickets(total = 10, opts = {}) {
  const tier = Number(opts.tier) || 1;
  const scenarios = loadScenarios();
  const tickets = [];
  const pool = templatesForTier(scenarios, tier);
  if (!pool.length) return tickets;

  // Decide if there's an outage (~60% chance), only from outage-capable templates in tier
  const includeOutage = Math.random() < 0.6;
  if (includeOutage) {
    const outageCandidates = pool.filter(p => p.template.outage_capable);
    if (outageCandidates.length) {
      const pick = rand(outageCandidates);
      const group = scenarios.categories[pick.category].assignment_group;
      const vars = { floor: rand(scenarios.floors) };
      const batch = generateOutageBatch(pick.category, group, pick.template, vars);
      tickets.push(...batch);
    }
  }

  while (tickets.length < total) {
    const pick = rand(pool);
    const cat = scenarios.categories[pick.category];
    const vars = { floor: rand(scenarios.floors) };
    tickets.push(buildTicket(pick.category, cat.assignment_group, pick.template, vars));
  }

  // Shuffle
  for (let i = tickets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tickets[i], tickets[j]] = [tickets[j], tickets[i]];
  }

  return tickets.slice(0, total);
}

module.exports = { generateTickets };
