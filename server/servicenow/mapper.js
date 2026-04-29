/** Normalize raw ServiceNow API records into local ticket/user/group shapes. */

const ref = (f) => (f && typeof f === 'object') ? (f.value || null) : (f || null);
const disp = (f) => (f && typeof f === 'object') ? (f.display_value || f.value || null) : (f || null);

function normalizeIncident(inc) {
  const priorityNum = parseInt(String(disp(inc.priority) || '').match(/\d+/)?.[0] || '3', 10) || 3;
  const stateLabel = disp(inc.state) || 'New';
  const wasResolved = ['Resolved', 'Closed'].includes(stateLabel);
  const closeNotes = disp(inc.close_notes) || '';
  const assignmentGroup = disp(inc.assignment_group) || '';

  return {
    number: disp(inc.number),
    short_description: disp(inc.short_description),
    description: disp(inc.description) || disp(inc.short_description),
    priority: priorityNum,
    impact: Number(disp(inc.impact)) || 3,
    urgency: Number(disp(inc.urgency)) || 3,
    category: disp(inc.category) || 'inquiry',
    subcategory: disp(inc.subcategory) || '',
    tier: inferTier(priorityNum, assignmentGroup),
    assignment_group: assignmentGroup,
    correct_action: wasResolved ? 'resolve' : 'escalate',
    correct_group: assignmentGroup,
    correct_steps: parseSteps(closeNotes),
    expected_keywords: deriveKeywords(closeNotes, disp(inc.short_description)),
    required_events: [],
    rationale: closeNotes
      ? `Real resolution: ${truncate(closeNotes, 240)}`
      : 'No close notes — scoring uses field values only.',
    state: 'New',
    notes: [],
    created_at: disp(inc.opened_at) || new Date().toISOString(),
    source: 'live',
    sn: {
      sys_id: ref(inc.sys_id),
      caller_id: ref(inc.caller_id),
      caller_label: disp(inc.caller_id),
      assignment_group_id: ref(inc.assignment_group),
      original_state: stateLabel,
      close_code: disp(inc.close_code),
      close_notes: closeNotes,
      resolved_at: disp(inc.resolved_at)
    }
  };
}

function normalizeUser(u) {
  return { sys_id: ref(u.sys_id), name: disp(u.name), email: disp(u.email), user_name: disp(u.user_name), department: disp(u.department) };
}

function normalizeGroup(g) {
  return { sys_id: ref(g.sys_id), name: disp(g.name), manager: disp(g.manager), email: disp(g.email) };
}

function normalizeCI(ci) {
  return { sys_id: ref(ci.sys_id), name: disp(ci.name), class: disp(ci.sys_class_name), ip_address: disp(ci.ip_address) };
}

function inferTier(priorityNum, groupLabel) {
  const g = String(groupLabel || '').toLowerCase();
  if (priorityNum <= 2 || /engineering|tier 3|database/.test(g)) return 3;
  if (/tier 2|network|application|security/.test(g)) return 2;
  return 1;
}

function parseSteps(text) {
  if (!text) return [];
  return String(text).split(/\r?\n|;|\u2022/)
    .map(s => s.replace(/^[-*\d.\s]+/, '').trim())
    .filter(s => s.length > 3).slice(0, 6);
}

function deriveKeywords(closeNotes, shortDesc) {
  const src = `${closeNotes} ${shortDesc}`.toLowerCase();
  const stop = new Set(['the','and','for','with','that','this','have','from','user','users','was','were','been','will','please','issue','ticket','incident','their','they']);
  const words = src.match(/[a-z][a-z0-9-]{3,}/g) || [];
  const freq = new Map();
  for (const w of words) if (!stop.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
}

function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

module.exports = { normalizeIncident, normalizeUser, normalizeGroup, normalizeCI };
