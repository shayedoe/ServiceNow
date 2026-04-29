const { snGet, snPost, snPatch } = require('./client');
const { normalizeIncident } = require('./mapper');

const INC_FIELDS = [
  'number','short_description','description','priority','impact','urgency',
  'state','category','subcategory','business_service','service_offering',
  'cmdb_ci','contact_type','assignment_group','assigned_to',
  'caller_id','opened_at','resolved_at','close_notes','close_code',
  'sys_id','sys_updated_on','sys_updated_by','parent_incident'
].join(',');

const LIST_FIELDS = [
  'sys_id','number','opened_at','short_description','caller_id','priority',
  'state','category','assignment_group','assigned_to','sys_updated_on','sys_updated_by'
].join(',');

function display(f) {
  if (!f) return '';
  if (typeof f === 'object') return f.display_value || f.value || '';
  return String(f);
}

function refValue(f) {
  if (!f) return '';
  if (typeof f === 'object') return f.value || '';
  return String(f);
}

/** Normalize a record into a flat shape for the SN-style form. */
function flattenIncident(inc) {
  return {
    sys_id: refValue(inc.sys_id),
    number: display(inc.number),
    opened_at: display(inc.opened_at),
    short_description: display(inc.short_description),
    description: display(inc.description),
    caller_id: refValue(inc.caller_id),
    caller_label: display(inc.caller_id),
    category: refValue(inc.category),
    subcategory: refValue(inc.subcategory),
    business_service: refValue(inc.business_service),
    business_service_label: display(inc.business_service),
    service_offering: refValue(inc.service_offering),
    service_offering_label: display(inc.service_offering),
    cmdb_ci: refValue(inc.cmdb_ci),
    cmdb_ci_label: display(inc.cmdb_ci),
    channel: refValue(inc.contact_type),
    state: refValue(inc.state),
    state_label: display(inc.state),
    impact: refValue(inc.impact),
    urgency: refValue(inc.urgency),
    priority: refValue(inc.priority),
    priority_label: display(inc.priority),
    assignment_group: refValue(inc.assignment_group),
    assignment_group_label: display(inc.assignment_group),
    assigned_to: refValue(inc.assigned_to),
    assigned_to_label: display(inc.assigned_to),
    sys_updated_on: display(inc.sys_updated_on),
    sys_updated_by: display(inc.sys_updated_by),
    close_code: display(inc.close_code),
    close_notes: display(inc.close_notes)
  };
}

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

async function listIncidentRows({ limit = 25, mode = 'open' } = {}) {
  const query = mode === 'closed'
    ? 'stateIN6,7^ORDERBYDESCresolved_at'
    : 'active=true^ORDERBYDESCopened_at';
  const url = `/api/now/table/incident?sysparm_limit=${limit}` +
    `&sysparm_display_value=all&sysparm_exclude_reference_link=true` +
    `&sysparm_query=${encodeURIComponent(query)}&sysparm_fields=${LIST_FIELDS}`;
  const r = await snGet(url);
  return (r.result || []).map(row => ({
    sys_id: refValue(row.sys_id),
    number: display(row.number),
    opened_at: display(row.opened_at),
    short_description: display(row.short_description),
    caller: display(row.caller_id),
    priority: display(row.priority),
    state: display(row.state),
    category: display(row.category),
    assignment_group: display(row.assignment_group),
    assigned_to: display(row.assigned_to),
    updated: display(row.sys_updated_on),
    updated_by: display(row.sys_updated_by)
  }));
}

async function getIncidentFlat(sysId) {
  const r = await snGet(`/api/now/table/incident/${sysId}?sysparm_display_value=all&sysparm_fields=${INC_FIELDS}`);
  return r.result ? flattenIncident(r.result) : null;
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
  const r = await snGet(`/api/now/table/task_sla?sysparm_query=${q}&sysparm_fields=sla,stage,has_breached,time_left,business_time_left,business_percentage,start_time,end_time&sysparm_display_value=true`);
  return r.result || [];
}

async function fetchChildIncidents(incidentSysId) {
  const q = encodeURIComponent(`parent_incident=${incidentSysId}`);
  const r = await snGet(`/api/now/table/incident?sysparm_query=${q}&sysparm_fields=number,short_description,state,assignment_group,sys_id&sysparm_display_value=true`);
  return r.result || [];
}

async function fetchAffectedCis(incidentSysId) {
  const q = encodeURIComponent(`task=${incidentSysId}`);
  const r = await snGet(`/api/now/table/task_ci?sysparm_query=${q}&sysparm_fields=ci_item,sys_id&sysparm_display_value=true`);
  return r.result || [];
}

async function fetchActivity(incidentSysId, limit = 30) {
  const q = encodeURIComponent(`element_id=${incidentSysId}^ORDERBYDESCsys_created_on`);
  const r = await snGet(`/api/now/table/sys_journal_field?sysparm_query=${q}&sysparm_fields=sys_created_on,sys_created_by,element,value&sysparm_display_value=true&sysparm_limit=${limit}`);
  return (r.result || []).map(row => ({
    at: display(row.sys_created_on),
    by: display(row.sys_created_by),
    field: display(row.element),
    text: display(row.value)
  }));
}

module.exports = {
  listIncidents, listIncidentRows, getIncident, getIncidentFlat,
  createIncident, patchIncident,
  addWorkNote, addCallerComment, assignIncident, setImpactUrgency,
  resolveIncident, linkParentIncident, fetchRelatedIncidents,
  fetchTaskSla, fetchChildIncidents, fetchAffectedCis, fetchActivity
};
