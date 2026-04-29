const { snGet, snPost, snPatch } = require('./client');
const { normalizeIncident } = require('./mapper');

const INC_FIELDS = [
  'number','short_description','description','priority','impact','urgency',
  'state','category','subcategory','assignment_group','assigned_to',
  'caller_id','opened_at','resolved_at','close_notes','close_code',
  'sys_id','sys_updated_on','parent_incident'
].join(',');

async function listIncidents({ limit = 10, mode = 'closed' } = {}) {
  const query = mode === 'open'
    ? 'active=true^ORDERBYDESCsys_created_on'
    : 'stateIN6,7^ORDERBYDESCresolved_at';
  const url = `/api/now/table/incident?sysparm_limit=${limit}` +
    `&sysparm_display_value=all&sysparm_exclude_reference_link=true` +
    `&sysparm_query=${encodeURIComponent(query)}&sysparm_fields=${INC_FIELDS}`;
  const r = await snGet(url);
  return (r.result || []).map(normalizeIncident);
}

async function getIncident(sysId) {
  const r = await snGet(`/api/now/table/incident/${sysId}?sysparm_display_value=all&sysparm_fields=${INC_FIELDS}`);
  return r.result ? normalizeIncident(r.result) : null;
}

async function createIncident(payload) {
  const r = await snPost('/api/now/table/incident', payload);
  return r.result || null;
}

async function patchIncident(sysId, payload) {
  const r = await snPatch(`/api/now/table/incident/${sysId}`, payload);
  return r.result || null;
}

async function addWorkNote(sysId, note) {
  return patchIncident(sysId, { work_notes: String(note) });
}

async function addCallerComment(sysId, comment) {
  return patchIncident(sysId, { comments: String(comment) });
}

async function assignIncident(sysId, groupSysId, agentSysId) {
  const payload = { assignment_group: groupSysId };
  if (agentSysId) payload.assigned_to = agentSysId;
  return patchIncident(sysId, payload);
}

async function setImpactUrgency(sysId, impact, urgency) {
  return patchIncident(sysId, { impact: String(impact), urgency: String(urgency) });
}

async function resolveIncident(sysId, closeCode, closeNotes) {
  return patchIncident(sysId, {
    state: '6',
    close_code: closeCode || 'Solved (Permanently)',
    close_notes: closeNotes || ''
  });
}

async function linkParentIncident(sysId, parentSysId) {
  return patchIncident(sysId, { parent_incident: parentSysId });
}

async function fetchRelatedIncidents(shortDescription, limit = 5) {
  const q = encodeURIComponent(`short_descriptionLIKE${shortDescription.slice(0, 60)}^ORDERBYDESCsys_created_on`);
  const r = await snGet(`/api/now/table/incident?sysparm_limit=${limit}&sysparm_display_value=all&sysparm_query=${q}&sysparm_fields=number,short_description,state,assignment_group,sys_id`);
  return r.result || [];
}

async function fetchTaskSla(incidentSysId) {
  const q = encodeURIComponent(`task=${incidentSysId}`);
  const r = await snGet(`/api/now/table/task_sla?sysparm_query=${q}&sysparm_fields=sla,stage,has_breached,time_left,start_time&sysparm_display_value=true`);
  return r.result || [];
}

module.exports = {
  listIncidents, getIncident, createIncident, patchIncident,
  addWorkNote, addCallerComment, assignIncident, setImpactUrgency,
  resolveIncident, linkParentIncident, fetchRelatedIncidents, fetchTaskSla
};
