// ============================================================
// Help Desk Simulator — ServiceNow-style cockpit renderer
// ============================================================
const BASE = (window.api && window.api.baseUrl) || 'http://localhost:3017';

const state = {
  view: 'welcome',           // 'welcome' | 'queue' | 'incident' | 'summary'
  session_id: null,
  source: 'offline',
  mode: null,
  tickets: [],               // local tickets (offline/authored/live wrappers)
  currentTicket: null,
  currentTab: 'notes',       // 'notes' | 'related_records' | 'resolution'
  currentRelated: 'task_slas',
  meta: null,                // sys_choice metadata (live mode)
  services: [],
  groups: [],
  users: [],
  cis: [],
  shiftScore: { resolved: 0, correct: 0, total: 0 }
};

// ----- Action labels -----
const ACTION_LABELS = {
  validate_caller: 'Validate Caller',
  check_scope: 'Check Scope',
  check_related_incidents: 'Check Related Incidents',
  check_known_outage: 'Check Known Outage',
  collect_evidence: 'Collect Evidence',
  set_impact_urgency: 'Set Impact/Urgency',
  assign_group: 'Assign Group',
  add_work_note: 'Add Work Note',
  add_comment: 'Add Caller Comment',
  link_parent: 'Link Parent Incident',
  link_parent_incident: 'Link Parent Incident',
  hint_used: 'Hint Used',
  escalate: 'Escalate',
  resolve: 'Resolve'
};
function labelFor(at) { return ACTION_LABELS[at] || (at || '').replace(/_/g, ' '); }

// ----- Default choices (offline / authored fallback) -----
const FALLBACK_META = {
  category: [
    { value: 'inquiry', label: 'Inquiry / Help' },
    { value: 'software', label: 'Software' },
    { value: 'hardware', label: 'Hardware' },
    { value: 'network', label: 'Network' },
    { value: 'database', label: 'Database' },
    { value: 'security', label: 'Security' }
  ],
  subcategory: [
    { value: 'antivirus', label: 'Antivirus', dependent_value: 'inquiry' },
    { value: 'email', label: 'Email', dependent_value: 'inquiry' },
    { value: 'internal_application', label: 'Internal Application', dependent_value: 'inquiry' },
    { value: 'email', label: 'Email', dependent_value: 'software' },
    { value: 'os', label: 'Operating System', dependent_value: 'software' },
    { value: 'cpu', label: 'CPU', dependent_value: 'hardware' },
    { value: 'disk', label: 'Disk', dependent_value: 'hardware' },
    { value: 'keyboard', label: 'Keyboard', dependent_value: 'hardware' },
    { value: 'memory', label: 'Memory', dependent_value: 'hardware' },
    { value: 'monitor', label: 'Monitor', dependent_value: 'hardware' },
    { value: 'mouse', label: 'Mouse', dependent_value: 'hardware' },
    { value: 'dhcp', label: 'DHCP', dependent_value: 'network' },
    { value: 'dns', label: 'DNS', dependent_value: 'network' },
    { value: 'ip_address', label: 'IP Address', dependent_value: 'network' },
    { value: 'wireless', label: 'Wireless', dependent_value: 'network' },
    { value: 'vpn', label: 'VPN', dependent_value: 'network' },
    { value: 'db2', label: 'DB2', dependent_value: 'database' },
    { value: 'mssql', label: 'MS SQL Server', dependent_value: 'database' },
    { value: 'oracle', label: 'Oracle', dependent_value: 'database' }
  ],
  impact: [
    { value: '1', label: '1 - High' },
    { value: '2', label: '2 - Medium' },
    { value: '3', label: '3 - Low' }
  ],
  urgency: [
    { value: '1', label: '1 - High' },
    { value: '2', label: '2 - Medium' },
    { value: '3', label: '3 - Low' }
  ],
  priority: [
    { value: '1', label: '1 - Critical' },
    { value: '2', label: '2 - High' },
    { value: '3', label: '3 - Moderate' },
    { value: '4', label: '4 - Low' },
    { value: '5', label: '5 - Planning' }
  ],
  state: [
    { value: '1', label: 'New' },
    { value: '2', label: 'In Progress' },
    { value: '3', label: 'On Hold' },
    { value: '6', label: 'Resolved' },
    { value: '7', label: 'Closed' },
    { value: '8', label: 'Canceled' }
  ],
  contact_type: [
    { value: 'phone', label: 'Phone' },
    { value: 'email', label: 'Email' },
    { value: 'self-service', label: 'Self-service' },
    { value: 'walk-in', label: 'Walk-in' }
  ]
};

// ----- DOM helpers -----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// ----- API helper -----
async function apiCall(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { body = { error: res.statusText }; }
    throw new Error(body.error || `${res.status}`);
  }
  return res.json();
}

// ============================================================
// VIEW: incident queue
// ============================================================
function renderQueue() {
  state.view = 'queue';
  state.currentTicket = null;
  $('#recordPill').textContent = 'Incident Queue';
  const rows = state.tickets.map((t, idx) => {
    const isResolved = t.state === 'Resolved' && t.resolution;
    const pct = isResolved ? t.resolution.pct : null;
    const scoreCls = pct == null ? '' : pct >= 80 ? 'good' : pct >= 50 ? 'ok' : 'bad';
    const pri = Number(t.priority) || 3;
    return `
      <tr data-idx="${idx}" class="${isResolved ? 'resolved' : ''}">
        <td class="num-cell">${escapeHtml(t.number)}</td>
        <td>${escapeHtml(formatDate(t.created_at || t.opened_at))}</td>
        <td>${escapeHtml(t.short_description || '')}</td>
        <td>${escapeHtml(t.caller_label || t.sn?.caller_label || '(training user)')}</td>
        <td><span class="priority-pill p${pri}">${pri} - ${priorityLabel(pri)}</span></td>
        <td>${escapeHtml(t.state || 'New')}</td>
        <td>${escapeHtml(t.category || '')}</td>
        <td>${escapeHtml(t.assignment_group || '')}</td>
        <td>${escapeHtml(t.assigned_to_label || t.sn?.assigned_to_label || '')}</td>
        <td class="score-cell ${scoreCls}">${pct != null ? pct + '%' : ''}</td>
      </tr>`;
  }).join('') || `<tr><td colspan="10" class="empty" style="padding:20px;text-align:center;">No incidents in queue. Click <strong>Start Training Shift</strong>.</td></tr>`;

  $('#viewContainer').innerHTML = `
    <div class="queue-header">
      <h2>Incidents</h2>
      <span class="breadcrumb">Service Desk &raquo; All Incidents</span>
      <div style="margin-left:auto;color:var(--sn-muted);font-size:12px;">${state.tickets.length} record${state.tickets.length === 1 ? '' : 's'} &middot; source: <strong>${state.source}</strong></div>
    </div>
    <table class="queue-table">
      <thead>
        <tr>
          <th>Number</th>
          <th>Opened</th>
          <th>Short description</th>
          <th>Caller</th>
          <th>Priority</th>
          <th>State</th>
          <th>Category</th>
          <th>Assignment group</th>
          <th>Assigned to</th>
          <th>Score</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  $$('.queue-table tbody tr[data-idx]').forEach(tr => {
    // Click handled by delegation, but keep cursor cue here
    tr.style.cursor = 'pointer';
  });
}

// ============================================================
// VIEW: training resources (knowledge base)
// ============================================================
let _resourcesCache = null;
async function renderResources() {
  state.view = 'resources';
  state.currentTicket = null;
  $('#recordPill').textContent = 'Training Resources';
  $('#viewContainer').innerHTML = '<div class="empty-large"><h2>Loading resources\u2026</h2></div>';
  try {
    if (!_resourcesCache) _resourcesCache = await apiCall('/api/resources');
  } catch (err) {
    $('#viewContainer').innerHTML = `<div class="empty-large"><h2>Could not load resources</h2><p>${escapeHtml(err.message)}</p></div>`;
    return;
  }
  const r = _resourcesCache;

  const ivr = r.incident_vs_request || {};
  const ivrCard = ivr.incident || ivr.service_request ? `
    <div class="res-grid">
      <div class="res-card">
        <div class="res-card-h">Incident</div>
        <p>${escapeHtml(ivr.incident?.definition || '')}</p>
        <ul>${(ivr.incident?.examples || []).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      </div>
      <div class="res-card">
        <div class="res-card-h">Service Request</div>
        <p>${escapeHtml(ivr.service_request?.definition || '')}</p>
        <ul>${(ivr.service_request?.examples || []).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      </div>
    </div>
    ${ivr.key_difference ? `<p class="res-note"><strong>Key difference:</strong> ${escapeHtml(ivr.key_difference)}</p>` : ''}` : '';

  const triage = (r.triage_flow || []).map(s => `
    <div class="res-card">
      <div class="res-card-h">${s.step}. ${escapeHtml(s.name)}</div>
      <ul>${(s.questions || []).map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>
    </div>`).join('');

  const playbooks = Object.entries(r.troubleshooting_playbooks || {}).map(([k, pb]) => {
    const steps = Array.isArray(pb) ? pb : (pb && pb.steps) || [];
    const title = (pb && pb.title) || k.replace(/_/g, ' / ');
    const when = (pb && pb.when_to_use) ? `<div class="res-when"><em>When:</em> ${escapeHtml(pb.when_to_use)}</div>` : '';
    return `
    <div class="res-card">
      <div class="res-card-h">${escapeHtml(title)}</div>
      ${when}
      <ol>${steps.map(s => `<li>${escapeHtml(typeof s === 'string' ? s : (s.text || JSON.stringify(s)))}</li>`).join('')}</ol>
    </div>`;
  }).join('');

  // common_commands can be either an array of {platform,command,purpose} OR a dict of group -> [{cmd,what}]
  let commands = '';
  const cc = r.common_commands;
  if (Array.isArray(cc)) {
    commands = `<table class="res-table"><thead><tr><th>Platform</th><th>Command</th><th>Purpose</th></tr></thead><tbody>
      ${cc.map(c => `<tr><td>${escapeHtml(c.platform || '')}</td><td><code>${escapeHtml(c.command || c.cmd || '')}</code></td><td>${escapeHtml(c.purpose || c.what || '')}</td></tr>`).join('')}
    </tbody></table>`;
  } else if (cc && typeof cc === 'object') {
    commands = Object.entries(cc).map(([group, list]) => `
      <div class="res-card">
        <div class="res-card-h">${escapeHtml(group.replace(/_/g, ' ').toUpperCase())}</div>
        <table class="res-table"><thead><tr><th>Command</th><th>Purpose</th></tr></thead><tbody>
          ${(list || []).map(c => `<tr><td><code>${escapeHtml(c.cmd || c.command || '')}</code></td><td>${escapeHtml(c.what || c.purpose || '')}</td></tr>`).join('')}
        </tbody></table>
      </div>`).join('');
    if (commands) commands = `<div class="res-grid">${commands}</div>`;
  }

  const tips = `<ol class="res-list">${(r.coaching_tips || []).map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ol>`;

  const priority = `<table class="res-table"><thead><tr><th>Priority</th><th>Impact</th><th>Urgency</th><th>Use when</th></tr></thead><tbody>
    ${(r.priority_matrix || []).map(p => `<tr>
      <td><strong>${escapeHtml(p.priority)}</strong></td>
      <td>${escapeHtml(p.impact)}</td>
      <td>${escapeHtml(p.urgency)}</td>
      <td>${escapeHtml(p.use_when)}</td>
    </tr>`).join('')}
  </tbody></table>`;

  const routing = `<table class="res-table"><thead><tr><th>Category</th><th>Subcategory</th><th>Group</th><th>Route when</th><th>Escalate when</th><th>Escalate to</th></tr></thead><tbody>
    ${(r.routing_matrix || []).map(p => `<tr>
      <td>${escapeHtml(p.category)}</td>
      <td>${escapeHtml(p.subcategory || '')}</td>
      <td><strong>${escapeHtml(p.group)}</strong></td>
      <td>${escapeHtml(p.route_when)}</td>
      <td>${escapeHtml(p.escalate_when || '')}</td>
      <td>${escapeHtml(p.escalation_group || '')}</td>
    </tr>`).join('')}
  </tbody></table>`;

  const tplBlock = (title, obj) => `
    <div class="res-card">
      <div class="res-card-h">${escapeHtml(title)}</div>
      ${Object.entries(obj || {}).map(([k, v]) => `
        <div class="tpl-row">
          <div class="tpl-key">${escapeHtml(k.replace(/_/g, ' '))}</div>
          <div class="tpl-val">${escapeHtml(v)}</div>
        </div>`).join('')}
    </div>`;

  const triggers = `<ul class="res-list">${(r.escalation_triggers || []).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;
  const closure = `<ul class="res-list">${(r.closure_checklist || []).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`;

  $('#viewContainer').innerHTML = `
    <div class="queue-header">
      <h2>Training Resources</h2>
      <span class="breadcrumb">Service Desk &raquo; Knowledge</span>
    </div>
    <div class="res-page">
      <input id="resourcesFilter" class="res-filter" placeholder="Filter resources (e.g. 'phishing', 'dns', 'priority')" />
      ${ivrCard ? `<section class="res-section" data-section><h3>Incident vs Service Request</h3>${ivrCard}</section>` : ''}
      <section class="res-section" data-section>
        <h3>Triage flow</h3>
        <div class="res-grid">${triage}</div>
      </section>
      <section class="res-section" data-section>
        <h3>Priority matrix</h3>
        ${priority}
      </section>
      <section class="res-section" data-section>
        <h3>Routing matrix</h3>
        ${routing}
      </section>
      ${playbooks ? `<section class="res-section" data-section>
        <h3>Troubleshooting playbooks</h3>
        <div class="res-grid">${playbooks}</div>
      </section>` : ''}
      <section class="res-section" data-section>
        <h3>Templates</h3>
        <div class="res-grid">
          ${tplBlock('Work note templates', r.work_note_templates)}
          ${tplBlock('Caller comment templates', r.caller_comment_templates || r.customer_comment_templates)}
        </div>
      </section>
      <section class="res-section" data-section>
        <h3>Escalation triggers</h3>
        ${triggers}
      </section>
      <section class="res-section" data-section>
        <h3>Closure checklist</h3>
        ${closure}
      </section>
      ${(r.common_commands || []).length ? `<section class="res-section" data-section>
        <h3>Common commands</h3>
        ${commands}
      </section>` : ''}
      ${(r.coaching_tips || []).length ? `<section class="res-section" data-section>
        <h3>Coaching tips</h3>
        ${tips}
      </section>` : ''}
    </div>
  `;

  const filter = document.getElementById('resourcesFilter');
  if (filter) {
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      document.querySelectorAll('[data-section]').forEach(sec => {
        const text = sec.textContent.toLowerCase();
        sec.style.display = !q || text.includes(q) ? '' : 'none';
      });
    });
  }
}

// ============================================================
// VIEW: incident form
// ============================================================
async function openIncident(idx) {
  state.view = 'incident';
  state.currentTab = 'notes';
  state.currentRelated = 'task_slas';
  const t = state.tickets[idx];
  if (!t) return;
  state.currentTicket = t;

  // Refresh from DB so events/notes/state are fresh
  try {
    const fresh = await apiCall(`/api/tickets/${t.number}`);
    Object.assign(t, fresh);
  } catch { /* ignore */ }

  // Pull authored scenario detail (tool_clues + learning_objectives)
  if (t.scenario_id && !t.scenario_detail) {
    try {
      const s = await apiCall(`/api/scenarios/${t.scenario_id}`);
      t.scenario_detail = s;
      t.tool_clues = s.tool_clues || {};
      t.learning_objectives = s.learning_objectives || [];
    } catch { /* ignore */ }
  }

  // For live tickets, fetch the full SN record once
  if (state.source === 'live' && t.sn?.sys_id && !t.sn_loaded) {
    try {
      const live = await apiCall(`/api/sn/incidents/${t.sn.sys_id}`);
      t.live_form = live;
      t.sn_loaded = true;
    } catch (err) {
      console.warn('Could not fetch live incident:', err.message);
    }
  }

  renderIncidentView(t);
  renderTrainingPanel(t);
}

function renderIncidentView(t) {
  $('#recordPill').textContent = `Incident - ${t.number}`;
  const meta = state.meta || FALLBACK_META;
  const isResolved = t.state === 'Resolved';
  const live = t.live_form || {};

  // Field values: prefer live SN values, fall back to local ticket
  const v = {
    number: t.number,
    caller: live.caller_label || t.caller_label || (t.sn?.caller_label) || '',
    caller_id: live.caller_id || '',
    category: live.category || t.category || '',
    subcategory: live.subcategory || t.subcategory || '',
    business_service: live.business_service_label || '',
    service_offering: live.service_offering_label || '',
    cmdb_ci: live.cmdb_ci_label || '',
    short_description: live.short_description || t.short_description || '',
    description: live.description || t.description || '',
    channel: live.channel || 'phone',
    state_val: live.state || t.state || 'New',
    impact: String(live.impact || t.impact || 3),
    urgency: String(live.urgency || t.urgency || 3),
    priority: String(live.priority || t.priority || 3),
    assignment_group: live.assignment_group_label || t.assignment_group || '',
    assigned_to: live.assigned_to_label || ''
  };

  const subOpts = (meta.subcategory || []).filter(s => !s.dependent_value || s.dependent_value === v.category);
  const groupOpts = state.groups.length
    ? state.groups.map(g => ({ value: g, label: g }))
    : [{ value: v.assignment_group, label: v.assignment_group || '(none)' }];

  $('#viewContainer').innerHTML = `
    <header class="incident-header">
      <button class="back-btn" id="btnBack" title="Back to queue">&lsaquo;</button>
      <div>
        <div class="label">Incident</div>
        <h1>${escapeHtml(t.number)} &middot; ${escapeHtml(v.short_description)}</h1>
      </div>
      <div class="actions">
        <button class="sn-btn" id="btnUpdate" ${isResolved?'disabled':''}>Update</button>
        <button class="sn-btn success" id="btnResolve" ${isResolved?'disabled':''}>Resolve</button>
        <button class="sn-btn danger" id="btnEscalate" ${isResolved?'disabled':''}>Escalate</button>
      </div>
    </header>

    ${similarTickets(t).length >= 2 ? `<div class="banner">&#9888; ${similarTickets(t).length + 1} tickets share this description in the queue. This may be an outage \u2014 consider escalating.</div>` : ''}

    <section class="incident-form">
      <div class="form-grid">
        <div class="left-col">
          ${field({ id:'fNumber', label:'Number', value:v.number, readonly:true })}
          ${field({ id:'fCaller', label:'Caller', value:v.caller, required:true, readonly:true })}
          ${selectField({ id:'fCategory', label:'Category', value:v.category, options:meta.category, disabled:isResolved })}
          ${selectField({ id:'fSubcategory', label:'Subcategory', value:v.subcategory, options:subOpts, disabled:isResolved })}
          ${field({ id:'fService', label:'Service', value:v.business_service, readonly:true })}
          ${field({ id:'fServiceOffering', label:'Service offering', value:v.service_offering, readonly:true })}
          ${field({ id:'fCi', label:'Configuration item', value:v.cmdb_ci, readonly:true })}
          ${field({ id:'fShort', label:'Short description', value:v.short_description, required:true, readonly:true })}
          ${textareaField({ id:'fDescription', label:'Description', value:v.description, readonly:true })}
        </div>
        <div class="right-col">
          ${selectField({ id:'fChannel', label:'Channel', value:v.channel, options:meta.contact_type, disabled:isResolved })}
          ${field({ id:'fState', label:'State', value:v.state_val, readonly:true })}
          ${selectField({ id:'fImpact', label:'Impact', value:v.impact, options:meta.impact, disabled:isResolved })}
          ${selectField({ id:'fUrgency', label:'Urgency', value:v.urgency, options:meta.urgency, disabled:isResolved })}
          ${selectField({ id:'fPriority', label:'Priority', value:v.priority, options:meta.priority, disabled:isResolved })}
          ${selectField({ id:'fGroup', label:'Assignment group', value:v.assignment_group, options:groupOpts, disabled:isResolved })}
          ${field({ id:'fAssignedTo', label:'Assigned to', value:v.assigned_to, readonly:true })}
        </div>
      </div>
    </section>

    ${renderToolClues(t)}

    <div class="tabs" id="tabBar">
      <button data-tab="notes" class="${state.currentTab==='notes'?'active':''}">Notes</button>
      <button data-tab="related_records" class="${state.currentTab==='related_records'?'active':''}">Related Records</button>
      <button data-tab="resolution" class="${state.currentTab==='resolution'?'active':''}">Resolution Information</button>
    </div>
    <div class="tab-content" id="tabContent">${renderTab(t)}</div>

    <div class="related-lists" id="relatedBar">
      <button data-rel="task_slas" class="${state.currentRelated==='task_slas'?'active':''}">Task SLAs</button>
      <button data-rel="affected_cis" class="${state.currentRelated==='affected_cis'?'active':''}">Affected CIs</button>
      <button data-rel="impacted_services" class="${state.currentRelated==='impacted_services'?'active':''}">Impacted Services/CIs</button>
      <button data-rel="child_incidents" class="${state.currentRelated==='child_incidents'?'active':''}">Child Incidents</button>
    </div>
    <div class="related-content" id="relatedContent">${renderRelatedList(t)}</div>

    ${isResolved ? renderResultBox(t) : ''}
  `;

  // Wire up via event delegation below — nothing to wire here directly
}

function field({ id, label, value, required, readonly }) {
  const req = required ? '<span class="required">*</span>' : '';
  return `<div class="field-row ${readonly?'readonly':''}">
    <label for="${id}">${req}${escapeHtml(label)}</label>
    <input id="${id}" value="${escapeHtml(value)}" ${readonly?'readonly':''} />
  </div>`;
}
function textareaField({ id, label, value, readonly }) {
  return `<div class="field-row ${readonly?'readonly':''}">
    <label for="${id}">${escapeHtml(label)}</label>
    <textarea id="${id}" ${readonly?'readonly':''}>${escapeHtml(value)}</textarea>
  </div>`;
}
function selectField({ id, label, value, options, disabled, required }) {
  const req = required ? '<span class="required">*</span>' : '';
  // Match by value OR label
  const opts = (options || []).map(o => {
    const sel = String(o.value) === String(value) || String(o.label) === String(value);
    return `<option value="${escapeHtml(o.value)}" ${sel?'selected':''}>${escapeHtml(o.label)}</option>`;
  }).join('');
  return `<div class="field-row">
    <label for="${id}">${req}${escapeHtml(label)}</label>
    <select id="${id}" ${disabled?'disabled':''}>
      <option value="">-- None --</option>
      ${opts}
    </select>
  </div>`;
}

function similarTickets(t) {
  return state.tickets.filter(x => x.short_description === t.short_description && x.number !== t.number);
}

// ----- Tool clues / simulated evidence -----
const TOOL_LABELS = {
  ad: 'Active Directory',
  intune: 'Intune / MDM',
  print_server: 'Print Server',
  vpn_logs: 'VPN Logs',
  vpn: 'VPN Logs',
  dns: 'DNS Lookup',
  service_health: 'Service Health',
  cmdb: 'CMDB CI',
  known_issue: 'Known Issue / Change',
  change: 'Change Record',
  dhcp: 'DHCP Scope',
  sso: 'SSO / IdP Logs',
  email: 'Mail Flow',
  database: 'Database',
  db: 'Database',
  endpoint: 'Endpoint',
  network: 'Network Monitoring',
  security: 'Security Tool',
  catalog: 'Service Catalog'
};
function renderToolClues(t) {
  const clues = t.tool_clues || {};
  const keys = Object.keys(clues);
  if (!keys.length) return '';
  const rows = keys.map(k => `
    <div class="clue-row">
      <span class="clue-tool">${escapeHtml(TOOL_LABELS[k] || k.replace(/_/g, ' '))}</span>
      <span class="clue-text">${escapeHtml(clues[k])}</span>
    </div>`).join('');
  return `<section class="evidence-panel">
    <div class="evidence-header"><strong>Simulated Evidence</strong> <span class="muted">(read what the tools would show before you act)</span></div>
    ${rows}
  </section>`;
}

// ----- Tabs -----
function renderTab(t) {
  if (state.currentTab === 'notes') {
    const notes = (t.notes || []).map(n => `
      <div class="activity-item work_notes">
        <div class="meta"><span class="who">${escapeHtml(n.by || 'You')}</span><span>Work notes &middot; ${escapeHtml(formatDate(n.at))}</span></div>
        <div class="body">${escapeHtml(n.text)}</div>
      </div>`).join('');
    return `
      <div>
        <label style="font-size:12px;color:var(--sn-muted);">Work notes</label>
        <textarea id="taWorkNote" placeholder="Type a work note (visible to agents only)\u2026"></textarea>
        <div class="post-row">
          <button class="sn-btn" id="btnPostNote">Post Work Note</button>
        </div>
      </div>
      <div>
        <label style="font-size:12px;color:var(--sn-muted);">Customer comment</label>
        <textarea id="taComment" placeholder="Type a message to the caller\u2026"></textarea>
        <div class="post-row">
          <button class="sn-btn" id="btnPostComment">Send Caller Comment</button>
        </div>
      </div>
      <div class="activity-stream">
        <div style="font-size:11px;text-transform:uppercase;color:var(--sn-muted);font-weight:700;margin-bottom:6px;">Activity (${(t.notes||[]).length})</div>
        ${notes || '<div class="empty">No activity yet.</div>'}
      </div>
    `;
  }
  if (state.currentTab === 'related_records') {
    return `<div class="empty">Parent incident, problem, change, request \u2014 not yet wired in this build.</div>`;
  }
  if (state.currentTab === 'resolution') {
    if (t.resolution) {
      const r = t.resolution;
      return `
        <div><strong>Action submitted:</strong> ${escapeHtml(r.action)}</div>
        <div><strong>Submitted at:</strong> ${escapeHtml(formatDate(r.submitted_at))}</div>
        <div style="margin-top:8px;"><strong>Score:</strong> ${escapeHtml(r.score || (r.pct + '%'))}</div>
        ${r.rationale ? `<div style="margin-top:8px;"><strong>Rationale:</strong> ${escapeHtml(r.rationale)}</div>` : ''}
      `;
    }
    return `<div class="empty">Resolve or escalate the incident to populate this tab.</div>`;
  }
  return '';
}

function wireTab(_ignored) { /* no-op — handled via delegation */ }

// ----- Related lists (fetched live for SN tickets) -----
function renderRelatedList(t) {
  if (state.source === 'live' && t.sn?.sys_id) {
    return '<div class="empty">Loading\u2026</div>';
  }
  // Authored / offline: render synthetic related lists from local data
  return renderAuthoredRelatedList(t);
}

function renderAuthoredRelatedList(t) {
  const rel = state.currentRelated;
  if (rel === 'task_slas') {
    const dl = t.response_deadline_minutes;
    if (!dl) return '<div class="empty">No SLA defined for this ticket.</div>';
    return `<table class="related-table"><thead><tr><th>SLA</th><th>Target</th><th>Stage</th><th>Status</th></tr></thead><tbody>
      <tr><td>Initial response</td><td>${dl} min</td><td>${escapeHtml(t.state || 'In Progress')}</td><td>${t.state === 'Resolved' ? 'Met' : 'In progress'}</td></tr>
    </tbody></table>`;
  }
  if (rel === 'affected_cis' || rel === 'impacted_services') {
    const ci = (t.scenario_detail?.servicenow_seed?.cmdb_ci) || '';
    const svc = (t.scenario_detail?.servicenow_seed?.business_service) || '';
    const rows = [];
    if (ci) rows.push(`<tr><td>${escapeHtml(ci)}</td><td>Configuration Item</td></tr>`);
    if (svc) rows.push(`<tr><td>${escapeHtml(svc)}</td><td>Business Service</td></tr>`);
    if (!rows.length) return '<div class="empty">No CIs linked.</div>';
    return `<table class="related-table"><thead><tr><th>Item</th><th>Type</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  if (rel === 'child_incidents') {
    const sims = similarTickets(t);
    if (!sims.length) return '<div class="empty">No child or related incidents in this queue.</div>';
    const rows = sims.map(s => `<tr><td>${escapeHtml(s.number)}</td><td>${escapeHtml(s.short_description)}</td><td>${escapeHtml(s.state || 'New')}</td><td>${escapeHtml(s.assignment_group || '')}</td></tr>`).join('');
    return `<table class="related-table"><thead><tr><th>Number</th><th>Short description</th><th>State</th><th>Assignment group</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return '<div class="empty">No data.</div>';
}

async function renderRelatedListAsync(t) {
  if (state.source !== 'live' || !t.sn?.sys_id) {
    return renderAuthoredRelatedList(t);
  }
  const sysId = t.sn.sys_id;
  try {
    if (state.currentRelated === 'task_slas') {
      const r = await apiCall(`/api/sn/incidents/${sysId}/slas`);
      if (!r.slas.length) return '<div class="empty">No SLAs.</div>';
      const rows = r.slas.map(s => `
        <tr>
          <td>${escapeHtml(s.sla)}</td>
          <td>${escapeHtml(s.stage)}</td>
          <td>${escapeHtml(s.business_time_left || s.time_left)}</td>
          <td>${escapeHtml(s.business_percentage || '')}</td>
          <td>${escapeHtml(s.has_breached === 'true' ? 'BREACHED' : 'OK')}</td>
        </tr>`).join('');
      return `<table class="related-table"><thead><tr><th>SLA</th><th>Stage</th><th>Time left</th><th>%</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    if (state.currentRelated === 'child_incidents') {
      const r = await apiCall(`/api/sn/incidents/${sysId}/child-incidents`);
      if (!r.children.length) return '<div class="empty">No child incidents.</div>';
      const rows = r.children.map(c => `
        <tr><td>${escapeHtml(c.number)}</td><td>${escapeHtml(c.short_description)}</td><td>${escapeHtml(c.state)}</td><td>${escapeHtml(c.assignment_group)}</td></tr>
      `).join('');
      return `<table class="related-table"><thead><tr><th>Number</th><th>Short description</th><th>State</th><th>Assignment group</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    if (state.currentRelated === 'affected_cis' || state.currentRelated === 'impacted_services') {
      const r = await apiCall(`/api/sn/incidents/${sysId}/affected-cis`);
      if (!r.cis.length) return '<div class="empty">No affected CIs.</div>';
      const rows = r.cis.map(c => `<tr><td>${escapeHtml(c.ci_item)}</td></tr>`).join('');
      return `<table class="related-table"><thead><tr><th>CI</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
  } catch (err) {
    return `<div class="empty">Failed to load: ${escapeHtml(err.message)}</div>`;
  }
  return '<div class="empty">No data.</div>';
}

// ============================================================
// Actions
// ============================================================
async function fireEvent(t, action_type, payload) {
  try {
    const data = await apiCall(`/api/tickets/${t.number}/event`, {
      method: 'POST',
      body: JSON.stringify({ action_type, payload: payload || {} })
    });
    t.events = data.events;
    const fresh = await apiCall(`/api/tickets/${t.number}`);
    Object.assign(t, fresh, { events: data.events });
    renderTrainingPanel(t);
  } catch (err) {
    console.warn('Event log failed:', err.message);
  }
}

async function onImpactUrgencyChange() {
  const t = state.currentTicket;
  if (!t) return;
  const impact = $('#fImpact').value;
  const urgency = $('#fUrgency').value;
  await fireEvent(t, 'set_impact_urgency', { impact, urgency });
}

async function onGroupChange() {
  const t = state.currentTicket;
  if (!t) return;
  const group = $('#fGroup').value;
  if (!group) return;
  await fireEvent(t, 'assign_group', { group });
}

async function postWorkNote(t) {
  const ta = $('#taWorkNote');
  const text = (ta.value || '').trim();
  if (!text) return;
  await fireEvent(t, 'add_work_note', { text });
  // For live tickets, also push to SN
  if (state.source === 'live' && t.sn?.sys_id) {
    try { await apiCall(`/api/sn/incidents/${t.sn.sys_id}/work-note`, { method: 'POST', body: JSON.stringify({ note: text }) }); }
    catch (err) { console.warn('SN work_note push failed:', err.message); }
  }
  ta.value = '';
  renderIncidentView(state.currentTicket);
  renderTrainingPanel(state.currentTicket);
}

async function postCallerComment(t) {
  const ta = $('#taComment');
  const text = (ta.value || '').trim();
  if (!text) return;
  await fireEvent(t, 'add_comment', { text });
  if (state.source === 'live' && t.sn?.sys_id) {
    try { await apiCall(`/api/sn/incidents/${t.sn.sys_id}/comment`, { method: 'POST', body: JSON.stringify({ comment: text }) }); }
    catch (err) { console.warn('SN comment push failed:', err.message); }
  }
  ta.value = '';
  renderIncidentView(state.currentTicket);
  renderTrainingPanel(state.currentTicket);
}

async function updateIncident() {
  const t = state.currentTicket;
  if (!t) return;
  const impact = $('#fImpact')?.value;
  const urgency = $('#fUrgency')?.value;
  const group = $('#fGroup')?.value;
  const priority = $('#fPriority')?.value;

  // Local update
  try {
    await apiCall(`/api/tickets/${t.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ assigned_group: group, impact, urgency })
    });
  } catch (err) { console.warn('local update failed:', err.message); }

  // Live SN PATCH
  if (state.source === 'live' && t.sn?.sys_id) {
    try {
      await apiCall(`/api/sn/incidents/${t.sn.sys_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ impact, urgency, priority })
      });
    } catch (err) { alert('SN update failed: ' + err.message); }
  }
  // Refresh
  if (state.source === 'live' && t.sn?.sys_id) {
    try { t.live_form = await apiCall(`/api/sn/incidents/${t.sn.sys_id}`); } catch {}
  }
  renderIncidentView(t);
}

async function submitResolution(action) {
  const t = state.currentTicket;
  if (!t) return;
  const group = $('#fGroup')?.value || t.assignment_group;
  const priority = Number($('#fPriority')?.value) || t.priority;
  const note = ($('#taWorkNote')?.value || '').trim();

  try {
    const data = await apiCall(`/api/tickets/${t.number}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ action, assigned_group: group, priority, note })
    });
    Object.assign(t, data.ticket);
    t.events = data.events || t.events || [];
    state.shiftScore = data.shiftScore;
    updateScoreDisplay();
    renderIncidentView(t);
    renderTrainingPanel(t);
  } catch (err) {
    alert('Submit failed: ' + err.message);
  }
}

// ============================================================
// Result box (shown inside incident view after resolve)
// ============================================================
function renderResultBox(t) {
  const r = t.resolution;
  if (!r) return '';
  const items = (r.details || []).map(d => {
    const cls = d.ok ? 'ok' : (d.fraction > 0 ? 'partial' : 'bad');
    const pts = d.weight != null ? `<span class="pts"> ${d.earned}/${d.weight}</span>` : '';
    return `<li class="${cls}"><strong>${escapeHtml(d.check)}:</strong>${pts} ${escapeHtml(d.message)}${d.why ? `<div class="why">Why: ${escapeHtml(d.why)}</div>` : ''}</li>`;
  }).join('');
  const grade = gradeLetter(r.pct);
  const gradeCls = r.pct >= 80 ? 'good' : r.pct >= 60 ? 'ok' : 'bad';
  return `
    <div class="result-box">
      <h3><span class="grade-letter ${gradeCls}">${grade}</span>${escapeHtml(r.score || (r.pct + '%'))}</h3>
      ${r.rationale ? `<div style="margin:8px 0;"><strong>Rationale:</strong> ${escapeHtml(r.rationale)}</div>` : ''}
      <ul class="result-list">${items}</ul>
    </div>
  `;
}

// ============================================================
// Right rail: training checklist + coach + event log
// ============================================================
function renderTrainingPanel(t) {
  if (!t) return;
  const required = t.required_events || [];
  const performed = new Set((t.events || []).map(e => e.action_type));
  const manual = new Set(t.manual_checks || []);
  const items = required.map(e => {
    const auto = performed.has(e);
    const checked = auto || manual.has(e);
    return `
    <div class="checklist-item ${checked ? 'done' : ''} ${auto && !manual.has(e) ? 'auto' : ''}" data-check="${e}" title="${auto ? 'Recorded automatically — click to override' : 'Click to mark complete'}">
      <div class="check">${checked ? '&#10003;' : ''}</div>
      <div class="label">${labelFor(e)}</div>
    </div>`;
  }).join('') || '<div class="empty">No required actions defined for this ticket.</div>';
  $('#checklist').innerHTML = items;

  // Quick action buttons
  const isResolved = t.state === 'Resolved';
  const QUICK = [
    { id: 'qaValidate', action: 'validate_caller', label: 'Validate Caller' },
    { id: 'qaScope', action: 'check_scope', label: 'Check Scope' },
    { id: 'qaRelated', action: 'check_related_incidents', label: 'Check Related Incidents' },
    { id: 'qaOutage', action: 'check_known_outage', label: 'Check Known Outage' },
    { id: 'qaEvidence', action: 'collect_evidence', label: 'Collect Evidence' },
    { id: 'qaParent', action: 'link_parent', label: 'Link Parent Incident' }
  ];
  const qaHtml = QUICK.map(q => {
    const done = performed.has(q.action);
    return `<button class="qa-btn ${done ? 'done' : ''}" data-action="${q.action}" ${isResolved ? 'disabled' : ''}>
      ${done ? '&#10003; ' : ''}${q.label}
    </button>`;
  }).join('');
  $('#quickActions').innerHTML = qaHtml;
  $('#quickActions').classList.remove('empty');

  // Learning objectives
  const objs = t.learning_objectives || [];
  const loEl = $('#learningObjectives');
  if (objs.length) {
    loEl.innerHTML = `<div class="lo-title">Learning objectives</div><ul class="lo-list">${objs.map(o => `<li>${escapeHtml(o)}</li>`).join('')}</ul>`;
    loEl.classList.remove('empty');
  } else {
    loEl.innerHTML = '';
    loEl.classList.add('empty');
  }

  // Coach panel: hint button + revealed hints
  const hintsRevealed = t.hints_revealed || [];
  $('#coachPanel').innerHTML = hintsRevealed.length
    ? hintsRevealed.map(h => `<div class="hint-card"><div class="hint-title">${escapeHtml(h.title)}</div><div>${escapeHtml(h.body)}</div><div class="hint-why"><strong>Why:</strong> ${escapeHtml(h.why)}</div></div>`).join('')
    : '<div class="empty">Stuck? Click Get Hint (-5% per hint).</div>';

  const btn = $('#btnHint');
  const used = t.hints_used || 0;
  btn.disabled = isResolved || used >= 3;
  btn.textContent = used >= 3 ? 'Hints exhausted' : `Get Hint (${used} used, -${used*5}%)`;
  btn.onclick = () => requestHint(t);

  // Event log
  $('#eventLog').innerHTML = renderEventLog(t.events || []);
}

async function requestHint(t) {
  try {
    const data = await apiCall(`/api/tickets/${t.number}/hint`, { method: 'POST' });
    t.hints_used = data.hints_used;
    t.hints_revealed = t.hints_revealed || [];
    t.hints_revealed.push(data.hint);
    renderTrainingPanel(t);
  } catch (err) {
    alert('Hint failed: ' + err.message);
  }
}

function renderEventLog(events) {
  if (!events.length) return '<div class="empty">No actions recorded yet.</div>';
  return events.map(e => {
    const at = e.at ? new Date(e.at).toLocaleTimeString() : '';
    const summary = summarizePayload(e.action_type, e.payload);
    return `<div class="event-row">
      <span class="event-time">${at}</span>
      <span class="event-action">${labelFor(e.action_type)}</span>
      ${summary ? `<span class="event-payload">${escapeHtml(summary)}</span>` : ''}
    </div>`;
  }).join('');
}

function summarizePayload(action, p) {
  if (!p) return '';
  if (action === 'set_impact_urgency') return `I${p.impact}/U${p.urgency}`;
  if (action === 'assign_group') return p.group || '';
  if (action === 'add_work_note' || action === 'add_comment') return (p.text || '').slice(0, 60);
  if (action === 'link_parent') return p.parent || '';
  if (action === 'hint_used') return `level ${p.level}`;
  return '';
}

// ============================================================
// Shift lifecycle
// ============================================================
async function startShift() {
  const source = $('#sourceSelect').value || 'offline';
  state.source = source;
  $('#viewContainer').innerHTML = '<div class="empty-large"><h2>Loading shift\u2026</h2></div>';
  try {
    let data;
    if (source === 'live') {
      const mode = $('#snMode').value || 'open';
      data = await apiCall('/api/sn/shift/start', { method: 'POST', body: JSON.stringify({ mode, limit: 25 }) });
      state.mode = mode;
    } else {
      const tier = Number($('#tierSelect').value) || 1;
      data = await apiCall('/api/sessions/start', { method: 'POST', body: JSON.stringify({ tier, source, mode: 'training' }) });
      state.mode = 'training';
    }
    state.session_id = data.session_id || null;
    state.tickets = (data.tickets || []).map(t => ({ ...t, events: t.events || [] }));
    state.shiftScore = data.shiftScore || { resolved: 0, correct: 0, total: 0 };

    // Load metadata in parallel (best effort)
    await Promise.all([
      loadGroups(),
      source === 'live' ? loadLiveMetadata() : Promise.resolve()
    ]);

    setConnStatus(source === 'live' ? `Live: ${state.mode}` : `${source} mode`, source === 'live' ? 'live' : '');
    updateScoreDisplay();
    renderQueue();
  } catch (err) {
    setConnStatus('Error: ' + err.message, 'error');
    $('#viewContainer').innerHTML = `<div class="empty-large"><h2>Could not start shift</h2><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function loadGroups() {
  try {
    const data = await apiCall('/api/groups');
    state.groups = data.groups || [];
  } catch { state.groups = []; }
}

async function loadLiveMetadata() {
  try {
    state.meta = await apiCall('/api/sn/choices/incident');
  } catch (err) {
    console.warn('sys_choice load failed, using fallback:', err.message);
    state.meta = FALLBACK_META;
  }
  try {
    const s = await apiCall('/api/sn/services');
    state.services = s.services || [];
  } catch { state.services = []; }
}

async function finishShift() {
  if (!state.tickets.length) {
    alert('No active shift. Start a training shift first.');
    return;
  }
  try {
    const summary = await apiCall('/api/sessions/current/summary');
    state.view = 'summary';
    renderSummary(summary);
  } catch (err) {
    alert('Summary failed: ' + err.message);
  }
}

function renderSummary(s) {
  $('#recordPill').textContent = 'Shift Debrief';
  const tierRows = Object.entries(s.tier_breakdown || {}).map(([k,v]) =>
    `<tr><td>${k}</td><td>${v.count}</td><td>${v.avg}%</td></tr>`).join('') || '<tr><td colspan="3" class="empty">\u2014</td></tr>';
  const catRows = Object.entries(s.category_breakdown || {}).map(([k,v]) =>
    `<tr><td>${escapeHtml(k)}</td><td>${v.count}</td><td>${v.avg}%</td></tr>`).join('') || '<tr><td colspan="3" class="empty">\u2014</td></tr>';
  const weakest = (s.weakest_categories || []).map(w =>
    `<li><strong>${escapeHtml(w.category)}</strong> \u2014 ${w.avg}% over ${w.count} ticket${w.count===1?'':'s'}</li>`).join('') || '<li class="empty">No weak categories.</li>';
  const items = (s.items || []).map(it =>
    `<tr>
      <td>${escapeHtml(it.number)}</td>
      <td>T${it.tier}</td>
      <td>${escapeHtml(it.short_description)}</td>
      <td>${escapeHtml(it.action)} ${it.action !== it.expected_action ? `<span style="color:var(--sn-red);">(expected ${escapeHtml(it.expected_action)})</span>` : ''}</td>
      <td>${it.hints_used||0}</td>
      <td><strong>${it.pct}%</strong></td>
    </tr>`).join('');
  const grade = gradeLetter(s.avg_pct);
  const gradeCls = s.avg_pct >= 80 ? 'good' : s.avg_pct >= 60 ? 'ok' : 'bad';
  $('#viewContainer').innerHTML = `
    <div class="incident-form">
      <h1 style="margin:0 0 10px;">Shift Debrief</h1>
      <div style="display:flex;align-items:center;gap:14px;margin:14px 0;">
        <div class="grade-letter ${gradeCls}" style="width:64px;height:64px;line-height:64px;font-size:32px;">${grade}</div>
        <div>
          <div style="font-size:32px;font-weight:700;">${s.avg_pct}%</div>
          <div style="color:var(--sn-muted);">Average across ${s.resolved} resolved ticket${s.resolved===1?'':'s'}</div>
        </div>
      </div>
      <div class="summary-grid">
        <div class="summary-card"><h3>By Tier</h3><table><thead><tr><th>Tier</th><th>Count</th><th>Avg</th></tr></thead><tbody>${tierRows}</tbody></table></div>
        <div class="summary-card"><h3>By Category</h3><table><thead><tr><th>Category</th><th>Count</th><th>Avg</th></tr></thead><tbody>${catRows}</tbody></table></div>
        <div class="summary-card"><h3>Focus Areas</h3><ul>${weakest}</ul></div>
      </div>
      <div style="font-size:11px;text-transform:uppercase;color:var(--sn-muted);font-weight:700;margin:14px 0 6px;">Ticket-by-ticket</div>
      <table class="related-table">
        <thead><tr><th>Ticket</th><th>Tier</th><th>Description</th><th>Your Action</th><th>Hints</th><th>Score</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
      <div style="margin-top:14px;color:var(--sn-muted);font-size:11px;">Lifetime attempts logged: ${s.lifetime_attempts || 0}</div>
      <div style="margin-top:14px;"><button class="sn-btn primary" id="btnNewShift">Start New Shift</button></div>
    </div>
  `;
  $('#btnNewShift').addEventListener('click', startShift);
}

// ============================================================
// Settings modal
// ============================================================
function showSettings(show) {
  $('#settingsModal').classList.toggle('hidden', !show);
}
async function loadSnConfig() {
  try {
    const c = await apiCall('/api/sn/config');
    $('#snInstance').value = c.instance || '';
    $('#snUser').value = c.username || '';
    setSnStatus(c.configured ? 'Configured.' : 'Not configured.', c.configured ? 'ok' : '');
  } catch { /* ignore */ }
}
async function saveSnConfig() {
  const body = {
    instance: $('#snInstance').value,
    username: $('#snUser').value,
    password: $('#snPass').value
  };
  try {
    await apiCall('/api/sn/config', { method: 'POST', body: JSON.stringify(body) });
    setSnStatus('Saved.', 'ok');
    $('#snPass').value = '';
  } catch (err) {
    setSnStatus('Save failed: ' + err.message, 'error');
  }
}
async function testSnConnection() {
  setSnStatus('Testing\u2026', '');
  try {
    const r = await apiCall('/api/sn/test');
    setSnStatus(`Connected. Sample: ${r.sample?.user_name || '(ok)'}`, 'ok');
  } catch (err) {
    setSnStatus('Failed: ' + err.message, 'error');
  }
}
function setSnStatus(text, cls) {
  const el = $('#snStatus');
  el.textContent = text;
  el.className = 'sn-status ' + (cls || '');
}

// ============================================================
// Misc
// ============================================================
function setConnStatus(text, cls) {
  const el = $('#connStatus');
  el.textContent = text;
  el.className = 'conn-status ' + (cls || '');
}
function updateScoreDisplay() {
  const s = state.shiftScore;
  const total = state.tickets.length || 0;
  const tw = s.total_weight || 0;
  const pct = tw ? Math.round(((s.earned||0) / tw) * 100) : 0;
  $('#shiftScore').textContent = total ? `Shift: ${s.resolved||0}/${total} answered \u2022 ${pct}% avg` : 'No active shift';
}
function formatDate(s) {
  if (!s) return '';
  const d = typeof s === 'number' ? new Date(s) : new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString();
}
function priorityLabel(p) {
  return ['', 'Critical', 'High', 'Moderate', 'Low', 'Planning'][Number(p)] || '';
}

function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}
function gradeLetter(pct) {
  if (pct >= 90) return 'A';
  if (pct >= 80) return 'B';
  if (pct >= 70) return 'C';
  if (pct >= 60) return 'D';
  return 'F';
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { await apiCall('/api/health'); return true; }
    catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error('Server did not respond');
}

// ============================================================
// Init
// ============================================================
(async function init() {
  // Global error trapping so any runtime error is visible
  window.addEventListener('error', e => {
    console.error('[renderer error]', e.error || e.message);
    setConnStatus('JS error: ' + (e.message || 'see DevTools'), 'error');
  });
  window.addEventListener('unhandledrejection', e => {
    console.error('[unhandled promise]', e.reason);
  });

  // ----- Static event delegation: left nav -----
  document.querySelector('.sn-left-nav').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    if (btn.id === 'btnStartShift') return startShift();
    if (btn.id === 'btnFinishShift') return finishShift();
    if (btn.id === 'settingsBtn') { await loadSnConfig(); return showSettings(true); }
    if (btn.dataset.view) {
      document.querySelectorAll('.sn-left-nav .nav-btn[data-view]').forEach(x => x.classList.toggle('active', x === btn));
    }
    if (btn.dataset.view === 'queue') {
      if (state.tickets.length) renderQueue();
      else startShift();
    }
    if (btn.dataset.view === 'resources') return renderResources();
  });

  // ----- Settings modal delegation -----
  document.getElementById('settingsModal').addEventListener('click', async (e) => {
    if (e.target === e.currentTarget) return showSettings(false);
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'snCloseBtn') return showSettings(false);
    if (btn.id === 'snSaveBtn') return saveSnConfig();
    if (btn.id === 'snTestBtn') return testSnConnection();
  });

  // ----- View container delegation: handles ALL dynamic buttons -----
  document.getElementById('viewContainer').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    if (btn.id === 'btnBack') return renderQueue();
    if (btn.id === 'btnUpdate') return updateIncident();
    if (btn.id === 'btnResolve') return submitResolution('resolve');
    if (btn.id === 'btnEscalate') return submitResolution('escalate');
    if (btn.id === 'btnPostNote') return postWorkNote(state.currentTicket);
    if (btn.id === 'btnPostComment') return postCallerComment(state.currentTicket);
    if (btn.id === 'btnNewShift') return startShift();

    // Tab switch
    if (btn.dataset.tab && btn.parentElement?.id === 'tabBar') {
      state.currentTab = btn.dataset.tab;
      document.querySelectorAll('#tabBar button').forEach(x => x.classList.toggle('active', x.dataset.tab === state.currentTab));
      document.getElementById('tabContent').innerHTML = renderTab(state.currentTicket);
      return;
    }
    // Related list switch
    if (btn.dataset.rel && btn.parentElement?.id === 'relatedBar') {
      state.currentRelated = btn.dataset.rel;
      document.querySelectorAll('#relatedBar button').forEach(x => x.classList.toggle('active', x.dataset.rel === state.currentRelated));
      const rc = document.getElementById('relatedContent');
      rc.innerHTML = '<div class="empty">Loading\u2026</div>';
      rc.innerHTML = await renderRelatedListAsync(state.currentTicket);
      return;
    }
    // Queue row click is handled via delegation on tr below
  });

  // Queue row click via delegation
  document.getElementById('viewContainer').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-idx]');
    if (tr) openIncident(Number(tr.dataset.idx));
  });

  // Form change delegation (impact/urgency/group/category)
  document.getElementById('viewContainer').addEventListener('change', (e) => {
    if (!state.currentTicket) return;
    const id = e.target.id;
    if (id === 'fImpact' || id === 'fUrgency') return onImpactUrgencyChange();
    if (id === 'fGroup') return onGroupChange();
    if (id === 'fCategory') return renderIncidentView(state.currentTicket);
  });

  // Right-rail (training panel) hint button + quick actions + checklist toggle
  document.getElementById('trainingPanel').addEventListener('click', (e) => {
    if (e.target.id === 'btnHint' && state.currentTicket) return requestHint(state.currentTicket);

    // Manual checklist toggle
    const chk = e.target.closest('.checklist-item');
    if (chk && chk.dataset.check && state.currentTicket) {
      const t = state.currentTicket;
      t.manual_checks = t.manual_checks || [];
      const k = chk.dataset.check;
      const i = t.manual_checks.indexOf(k);
      if (i >= 0) t.manual_checks.splice(i, 1); else t.manual_checks.push(k);
      renderTrainingPanel(t);
      return;
    }

    const qa = e.target.closest('.qa-btn');
    if (qa && state.currentTicket && !qa.disabled) {
      const action = qa.dataset.action;
      if (!action) return;
      const t = state.currentTicket;
      const payload = action === 'check_related_incidents'
        ? { count: similarTickets(t).length + 1 }
        : action === 'link_parent'
          ? { parent: prompt('Parent incident number (e.g. INC0001000):', '') || '' }
          : {};
      if (action === 'link_parent' && !payload.parent) return;
      // Visual feedback: collect_evidence highlights evidence panel; check_related_incidents flashes banner
      if (action === 'collect_evidence') {
        const ep = document.querySelector('.evidence-panel');
        if (ep) { ep.scrollIntoView({ behavior: 'smooth', block: 'center' }); ep.classList.add('flash'); setTimeout(()=>ep.classList.remove('flash'), 1200); }
        else showToast('No simulated evidence on this ticket.');
      } else if (action === 'check_known_outage') {
        const note = (t.tool_clues && (t.tool_clues.service_health || t.tool_clues.known_issue || t.tool_clues.change)) || 'No active outages or recent changes affect this CI.';
        showToast('Known outage check: ' + note);
      } else if (action === 'check_related_incidents') {
        const n = similarTickets(t).length;
        showToast(n ? `${n} related ticket(s) share this short description.` : 'No related incidents found in queue.');
      } else if (action === 'validate_caller') {
        showToast('Caller verified: ' + (t.caller_label || '(training user)'));
      } else if (action === 'check_scope') {
        showToast('Scope check logged. Capture: how many users, devices, locations.');
      }
      return fireEvent(t, action, payload);
    }
  });

  try {
    await waitForServer();
    await loadGroups();
    setConnStatus('Connected to local API', '');
    // Try to resume an existing session
    try {
      const data = await apiCall('/api/tickets');
      if (data.tickets && data.tickets.length) {
        state.tickets = data.tickets.map(t => ({ ...t, events: t.events || [] }));
        state.shiftScore = data.shiftScore || state.shiftScore;
        updateScoreDisplay();
        renderQueue();
      }
    } catch { /* no active session */ }
  } catch (err) {
    setConnStatus('Server error: ' + err.message, 'error');
  }
})();
