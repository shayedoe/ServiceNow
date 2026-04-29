const BASE = (window.api && window.api.baseUrl) || 'http://localhost:3017';

const state = {
  session_id: null,
  tickets: [],
  groups: [],
  currentIndex: 0,
  shiftScore: { resolved: 0, correct: 0, total: 0 },
  finished: false,
  totalQuestions: 0,
  source: 'offline'
};

const ACTION_LABELS = {
  validate_caller: 'Validate Caller',
  check_scope: 'Check Scope',
  check_related_incidents: 'Check Related Incidents',
  set_impact_urgency: 'Set Impact/Urgency',
  assign_group: 'Assign Group',
  add_work_note: 'Add Work Note',
  add_comment: 'Add Caller Comment',
  link_parent: 'Link Parent Incident',
  hint_used: 'Hint Used',
  escalate: 'Escalate',
  resolve: 'Resolve'
};
function labelFor(at) { return ACTION_LABELS[at] || at.replace(/_/g, ' '); }

const $ = (sel) => document.querySelector(sel);
const shellEl = () => $('#examShell');

async function apiCall(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function loadGroups() {
  const data = await apiCall('/api/groups');
  state.groups = data.groups;
}

function updateScore() {
  const s = state.shiftScore;
  const pct = s.total_weight ? Math.round(((s.earned || 0) / s.total_weight) * 100) : 0;
  $('#shiftScore').textContent = `Shift: ${s.resolved}/${state.totalQuestions || 0} answered • ${pct}% avg`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function similarTickets(t) {
  return state.tickets.filter(x => x.short_description === t.short_description && x.number !== t.number);
}

function progressBar() {
  if (!state.tickets.length) return '';
  const dots = state.tickets.map((t, i) => {
    let cls = 'pdot';
    if (t.state === 'Resolved' && t.resolution) {
      const pct = t.resolution.result.pct;
      cls += pct >= 80 ? ' good' : pct >= 50 ? ' ok' : ' bad';
    } else if (i === state.currentIndex) {
      cls += ' current';
    }
    return `<span class="${cls}" title="${escapeHtml(t.short_description)}">${i + 1}</span>`;
  }).join('');
  const cur = Math.min(state.currentIndex + 1, state.tickets.length);
  return `<div class="progress">
    <div class="progress-text">Question ${cur} of ${state.tickets.length}</div>
    <div class="progress-dots">${dots}</div>
  </div>`;
}

function renderShell() {
  if (state.finished) return; // summary handles its own render
  if (!state.tickets.length) {
    shellEl().innerHTML = '<div class="empty large">Click "Start Shift" to begin a 10-question exam.</div>';
    return;
  }
  const t = state.tickets[state.currentIndex];
  if (!t) return;

  const similar = similarTickets(t);
  const banner = similar.length >= 2
    ? `<div class="banner">⚠ ${similar.length + 1} tickets share this description in the queue. This may be an outage — consider escalating.</div>`
    : '';

  const isResolved = t.state === 'Resolved';
  const groupOptions = ['<option value="">-- Select group --</option>']
    .concat(state.groups.map(g => `<option value="${escapeHtml(g)}" ${t.assigned_group===g?'selected':''}>${escapeHtml(g)}</option>`))
    .join('');

  const priorityChosen = t.priority_chosen != null ? t.priority_chosen : t.priority;
  const priorityOptions = [1,2,3,4,5].map(p =>
    `<option value="${p}" ${priorityChosen===p?'selected':''}>P${p}</option>`).join('');

  const notesHtml = t.notes && t.notes.length
    ? t.notes.map(n =>
        `<div class="note"><div class="at">${new Date(n.at).toLocaleString()}</div>${escapeHtml(n.text)}</div>`
      ).join('')
    : '<div class="empty">No notes yet.</div>';

  let resultHtml = '';
  if (isResolved && t.resolution) {
    const r = t.resolution.result;
    const items = r.details.map(d => {
      const cls = d.ok ? 'ok' : (d.fraction > 0 ? 'partial' : 'bad');
      const pts = (d.weight != null) ? ` <span class="pts">${d.earned}/${d.weight}</span>` : '';
      return `<li class="${cls}"><strong>${d.check}:</strong>${pts} ${escapeHtml(d.message)}` +
        (d.why ? `<div class="why">Why: ${escapeHtml(d.why)}</div>` : '') +
        `</li>`;
    }).join('');
    const steps = (r.correct_steps || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');
    const rationale = r.rationale ? `<div class="rationale"><strong>Rationale:</strong> ${escapeHtml(r.rationale)}</div>` : '';
    const isLast = state.currentIndex >= state.tickets.length - 1;
    resultHtml = `
      <div class="result-box">
        <h3>Result: ${r.score} <span class="tier-badge t${r.tier||1}">Tier ${r.tier||1}</span></h3>
        ${rationale}
        <ul class="result-list">${items}</ul>
        <div style="margin-top:10px;"><strong>Recommended steps:</strong>
          <ol class="steps-list">${steps}</ol>
        </div>
        <div class="toolbar" style="margin-top:14px;">
          <button id="btnNext" class="primary">${isLast ? 'Finish Shift & See Summary' : 'Next Ticket →'}</button>
        </div>
      </div>
    `;
  }

  shellEl().innerHTML = `
    ${progressBar()}
    ${banner}
    <h2 style="margin:0 0 4px;">${t.number} — ${escapeHtml(t.short_description)} <span class="tier-badge t${t.tier||1}">Tier ${t.tier||1}</span></h2>
    <div style="color:#64748b; font-size:12px; margin-bottom:12px;">Created ${new Date(t.created_at).toLocaleString()} • Default group: ${escapeHtml(t.assignment_group || '(none)')} • Category: ${t.category || ''}</div>

    <div class="detail-grid">
      <div class="field full">
        <label>Description</label>
        <div class="readonly">${escapeHtml(t.description)}</div>
      </div>

      <div class="field">
        <label>Assignment Group</label>
        <select id="fGroup" ${isResolved?'disabled':''}>${groupOptions}</select>
      </div>

      <div class="field">
        <label>Priority</label>
        <select id="fPriority" ${isResolved?'disabled':''}>${priorityOptions}</select>
      </div>

      <div class="field">
        <label>Default Priority</label>
        <div class="readonly">P${t.priority}</div>
      </div>

      <div class="field">
        <label>Impact</label>
        <select id="fImpact" ${isResolved?'disabled':''}>
          <option value="1" ${Number(t.impact)===1?'selected':''}>1 - High</option>
          <option value="2" ${Number(t.impact)===2?'selected':''}>2 - Medium</option>
          <option value="3" ${Number(t.impact)===3||!t.impact?'selected':''}>3 - Low</option>
        </select>
      </div>

      <div class="field">
        <label>Urgency</label>
        <select id="fUrgency" ${isResolved?'disabled':''}>
          <option value="1" ${Number(t.urgency)===1?'selected':''}>1 - High</option>
          <option value="2" ${Number(t.urgency)===2?'selected':''}>2 - Medium</option>
          <option value="3" ${Number(t.urgency)===3||!t.urgency?'selected':''}>3 - Low</option>
        </select>
      </div>

      <div class="field full">
        <label>Work Notes (document your steps)</label>
        <textarea id="fNote" ${isResolved?'disabled':''} placeholder="Describe what you did or would do..."></textarea>
      </div>

      <div class="field full">
        <label>Caller Comment (visible to caller)</label>
        <textarea id="fComment" ${isResolved?'disabled':''} placeholder="Optional message to send to the caller..."></textarea>
      </div>
    </div>

    ${renderActionPanel(t, isResolved)}

    <div class="toolbar">
      <button id="btnHint" class="hint-btn" ${isResolved||(t.hints_used||0)>=3?'disabled':''}>${(t.hints_used||0)>=3?'Hints exhausted':`Get Hint${(t.hints_used||0)>0?` (${t.hints_used} used, -${(t.hints_used||0)*5}%)`:''}`}</button>
      <button id="btnResolve" class="primary" ${isResolved?'disabled':''}>Submit as Resolve</button>
      <button id="btnEscalate" class="danger" ${isResolved?'disabled':''}>Submit as Escalate</button>
    </div>

    ${renderHintsPanel(t)}

    <div class="section-title">Work Notes</div>
    <div class="notes">${notesHtml}</div>

    <div class="section-title">Action Timeline</div>
    <div id="eventLog" class="event-log">${renderEventLog(t.events || [])}</div>

    ${resultHtml}
  `;

  if (!isResolved) {
    $('#btnResolve').addEventListener('click', () => submitResolution('resolve'));
    $('#btnEscalate').addEventListener('click', () => submitResolution('escalate'));
    if ((t.hints_used||0) < 3) $('#btnHint').addEventListener('click', requestHint);
    bindActionPanel(t);
  } else {
    const next = $('#btnNext');
    if (next) next.addEventListener('click', advanceQuestion);
  }
}

function renderActionPanel(t, isResolved) {
  if (isResolved) return '';
  const performed = new Set((t.events || []).map(e => e.action_type));
  const btn = (action, label) => {
    const did = performed.has(action);
    return `<button class="action-btn ${did?'done':''}" data-action="${action}" title="${did?'Already performed':label}">${did?'\u2713 ':''}${label}</button>`;
  };
  return `
    <div class="section-title">Investigation Actions</div>
    <div class="action-panel">
      ${btn('validate_caller', 'Validate Caller')}
      ${btn('check_scope', 'Check Scope')}
      ${btn('check_related_incidents', 'Check Related Incidents')}
      ${btn('set_impact_urgency', 'Set Impact/Urgency')}
      ${btn('assign_group', 'Assign Group')}
      ${btn('add_work_note', 'Add Work Note')}
      ${btn('add_comment', 'Send Caller Comment')}
      ${btn('link_parent', 'Link Parent Incident')}
    </div>
  `;
}

function bindActionPanel(t) {
  document.querySelectorAll('.action-panel .action-btn').forEach(b => {
    b.addEventListener('click', () => fireAction(t, b.dataset.action));
  });
}

async function fireAction(t, action) {
  let payload = {};
  if (action === 'set_impact_urgency') {
    payload = { impact: $('#fImpact').value, urgency: $('#fUrgency').value };
  } else if (action === 'assign_group') {
    const g = $('#fGroup').value;
    if (!g) return alert('Select an assignment group first.');
    payload = { group: g };
  } else if (action === 'add_work_note') {
    const text = ($('#fNote').value || '').trim();
    if (!text) return alert('Type a work note first.');
    payload = { text };
    $('#fNote').value = '';
  } else if (action === 'add_comment') {
    const text = ($('#fComment').value || '').trim();
    if (!text) return alert('Type a caller comment first.');
    payload = { text };
    $('#fComment').value = '';
  } else if (action === 'link_parent') {
    const parent = prompt('Parent incident number to link:');
    if (!parent) return;
    payload = { parent };
  }
  try {
    const data = await apiCall(`/api/tickets/${t.number}/event`, {
      method: 'POST',
      body: JSON.stringify({ action_type: action, payload })
    });
    t.events = data.events;
    // Refresh ticket fields after server-side side effects
    const fresh = await apiCall(`/api/tickets/${t.number}`);
    Object.assign(t, fresh, { events: data.events });
    renderShell();
  } catch (err) {
    alert('Action failed: ' + err.message);
  }
}

function renderEventLog(events) {
  if (!events || !events.length) return '<div class="empty">No actions recorded yet.</div>';
  return events.map(e => {
    const at = e.at ? new Date(e.at).toLocaleTimeString() : '';
    const summary = summarizePayload(e.action_type, e.payload);
    return `<div class="event-row"><span class="event-time">${at}</span><span class="event-action">${labelFor(e.action_type)}</span>${summary?`<span class="event-payload">${escapeHtml(summary)}</span>`:''}</div>`;
  }).join('');
}

function summarizePayload(action, p) {
  if (!p) return '';
  if (action === 'set_impact_urgency') return `I${p.impact} / U${p.urgency}`;
  if (action === 'assign_group') return p.group || '';
  if (action === 'add_work_note' || action === 'add_comment') return (p.text || '').slice(0, 80);
  if (action === 'link_parent') return p.parent || '';
  if (action === 'hint_used') return `level ${p.level}`;
  return '';
}

function renderHintsPanel(t) {
  const hints = t.hints_revealed || [];
  if (!hints.length) return '';
  const items = hints.map(h => `
    <div class="hint-card">
      <div class="hint-title">${escapeHtml(h.title)}</div>
      <div class="hint-body">${escapeHtml(h.body)}</div>
      <div class="hint-why"><strong>Why:</strong> ${escapeHtml(h.why)}</div>
    </div>
  `).join('');
  return `<div class="hints-panel"><div class="section-title">Hints (${hints.length} used)</div>${items}</div>`;
}

async function requestHint() {
  const t = state.tickets[state.currentIndex];
  if (!t) return;
  try {
    const data = await apiCall(`/api/tickets/${t.number}/hint`, { method: 'POST' });
    t.hints_used = data.hints_used;
    t.hints_revealed = t.hints_revealed || [];
    t.hints_revealed.push(data.hint);
    renderShell();
  } catch (err) {
    alert('Could not get hint: ' + err.message);
  }
}

function readForm() {
  return {
    assigned_group: $('#fGroup').value || null,
    priority: Number($('#fPriority').value),
    note: ($('#fNote') && $('#fNote').value) || ''
  };
}

async function submitResolution(action) {
  const t = state.tickets[state.currentIndex];
  if (!t) return;
  const f = readForm();
  try {
    const data = await apiCall(`/api/tickets/${t.number}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        assigned_group: f.assigned_group,
        priority: f.priority,
        note: f.note
      })
    });
    Object.assign(t, data.ticket);
    t.events = data.events || t.events || [];
    state.shiftScore = data.shiftScore;
    updateScore();
    renderShell();
  } catch (err) {
    alert('Could not submit: ' + err.message);
  }
}

async function advanceQuestion() {
  if (state.currentIndex < state.tickets.length - 1) {
    state.currentIndex += 1;
    await refreshCurrentTicketEvents();
    renderShell();
  } else {
    finishShift();
  }
}

async function finishShift() {
  try {
    const summary = await apiCall('/api/sessions/current/summary');
    state.finished = true;
    renderSummary(summary);
  } catch (err) {
    alert('Could not load summary: ' + err.message);
  }
}

function renderSummary(s) {
  const tierRows = Object.entries(s.tier_breakdown || {}).map(([k, v]) =>
    `<tr><td>${k}</td><td>${v.count}</td><td>${v.avg}%</td></tr>`).join('') || '<tr><td colspan="3" class="muted">—</td></tr>';
  const catRows = Object.entries(s.category_breakdown || {}).map(([k, v]) =>
    `<tr><td>${escapeHtml(k)}</td><td>${v.count}</td><td>${v.avg}%</td></tr>`).join('') || '<tr><td colspan="3" class="muted">—</td></tr>';
  const weakest = (s.weakest_categories || []).map(w =>
    `<li><strong>${escapeHtml(w.category)}</strong> — ${w.avg}% avg over ${w.count} ticket(s)</li>`).join('') ||
    '<li class="muted">No weak categories detected.</li>';
  const items = (s.items || []).map(it =>
    `<tr>
      <td>${escapeHtml(it.number)}</td>
      <td>T${it.tier}</td>
      <td>${escapeHtml(it.short_description)}</td>
      <td>${it.action} ${it.action !== it.expected_action ? `<span class="bad-inline">(expected ${it.expected_action})</span>` : ''}</td>
      <td>${it.hints_used || 0}</td>
      <td><strong>${it.pct}%</strong></td>
    </tr>`).join('');

  const grade = gradeLetter(s.avg_pct);

  shellEl().innerHTML = `
    <div class="summary">
      <h1>Shift Complete</h1>
      <div class="summary-score">
        <div class="big-pct">${s.avg_pct}%</div>
        <div class="grade-letter">${grade}</div>
        <div class="muted">Average across ${s.resolved} ticket${s.resolved===1?'':'s'}</div>
      </div>

      <div class="summary-grid">
        <div class="summary-card">
          <h3>By Tier</h3>
          <table><thead><tr><th>Tier</th><th>Count</th><th>Avg</th></tr></thead><tbody>${tierRows}</tbody></table>
        </div>
        <div class="summary-card">
          <h3>By Category</h3>
          <table><thead><tr><th>Category</th><th>Count</th><th>Avg</th></tr></thead><tbody>${catRows}</tbody></table>
        </div>
        <div class="summary-card">
          <h3>Focus Areas</h3>
          <ul class="focus-list">${weakest}</ul>
        </div>
      </div>

      <div class="section-title">Ticket-by-ticket</div>
      <table class="summary-table">
        <thead><tr><th>Ticket</th><th>Tier</th><th>Description</th><th>Your Action</th><th>Hints</th><th>Score</th></tr></thead>
        <tbody>${items}</tbody>
      </table>

      <div class="muted" style="margin-top:14px; font-size:12px;">Lifetime attempts logged: ${s.lifetime_attempts || 0}</div>

      <div class="toolbar" style="margin-top:18px;">
        <button id="btnNewShift" class="primary">Start New Shift</button>
      </div>
    </div>
  `;
  $('#btnNewShift').addEventListener('click', startShift);
}

function gradeLetter(pct) {
  if (pct >= 90) return 'A';
  if (pct >= 80) return 'B';
  if (pct >= 70) return 'C';
  if (pct >= 60) return 'D';
  return 'F';
}

async function startShift() {
  state.finished = false;
  state.currentIndex = 0;
  try {
    const live = document.getElementById('liveMode').checked;
    const authoredEl = document.getElementById('authoredMode');
    const authored = authoredEl && authoredEl.checked;
    let data;
    if (live) {
      const mode = document.getElementById('snMode').value || 'closed';
      data = await apiCall('/api/sn/shift/start', {
        method: 'POST',
        body: JSON.stringify({ mode, limit: 10 })
      });
      state.source = 'live';
    } else {
      const tier = Number(document.getElementById('tierSelect').value) || 1;
      const source = authored ? 'authored' : 'offline';
      data = await apiCall('/api/sessions/start', {
        method: 'POST',
        body: JSON.stringify({ tier, source, mode: 'exam' })
      });
      state.source = source;
    }
    state.session_id = data.session_id || null;
    state.tickets = (data.tickets || []).map(t => ({ ...t, events: t.events || [] }));
    state.shiftScore = data.shiftScore || { resolved: 0, correct: 0, total: 0 };
    state.totalQuestions = data.total_questions || state.tickets.length;
    await loadGroups();
    updateScore();
    await refreshCurrentTicketEvents();
    renderShell();
  } catch (e) {
    console.error('startShift error:', e);
    shellEl().innerHTML = `<div class="empty large">Error starting shift: ${escapeHtml(e.message)}</div>`;
  }
}

async function refreshCurrentTicketEvents() {
  const t = state.tickets[state.currentIndex];
  if (!t) return;
  try {
    const fresh = await apiCall(`/api/tickets/${t.number}`);
    Object.assign(t, fresh);
  } catch { /* ignore */ }
}

// ---- Settings modal ----
function showSettings(show) {
  document.getElementById('settingsModal').classList.toggle('hidden', !show);
}

async function loadSnConfig() {
  try {
    const c = await apiCall('/api/sn/config');
    document.getElementById('snInstance').value = c.instance || '';
    document.getElementById('snUser').value = c.username || '';
    document.getElementById('snStatus').textContent = c.configured ? 'Configured.' : 'Not configured.';
  } catch (e) { /* ignore */ }
}

async function saveSnConfig() {
  const body = {
    instance: document.getElementById('snInstance').value,
    username: document.getElementById('snUser').value,
    password: document.getElementById('snPass').value
  };
  try {
    await apiCall('/api/sn/config', { method: 'POST', body: JSON.stringify(body) });
    document.getElementById('snStatus').textContent = 'Saved.';
    document.getElementById('snPass').value = '';
  } catch (e) {
    document.getElementById('snStatus').textContent = 'Save failed: ' + e.message;
  }
}

async function testSnConnection() {
  const status = document.getElementById('snStatus');
  status.textContent = 'Testing...';
  try {
    const r = await apiCall('/api/sn/test');
    status.textContent = 'Connected. Sample user: ' + (r.sample?.user_name || '(ok)');
  } catch (e) {
    status.textContent = 'Failed: ' + e.message;
  }
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      await apiCall('/api/health');
      return true;
    } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error('Server did not respond');
}

(async function init() {
  $('#startShiftBtn').addEventListener('click', startShift);
  $('#settingsBtn').addEventListener('click', async () => { await loadSnConfig(); showSettings(true); });
  $('#snCloseBtn').addEventListener('click', () => showSettings(false));
  $('#snSaveBtn').addEventListener('click', saveSnConfig);
  $('#snTestBtn').addEventListener('click', testSnConnection);
  try {
    await waitForServer();
    await loadGroups();
    // Try to load existing tickets (e.g., refresh)
    const data = await apiCall('/api/tickets');
    state.tickets = data.tickets || [];
    state.shiftScore = data.shiftScore || state.shiftScore;
    state.totalQuestions = state.tickets.length;
    // resume at first unresolved
    const unresolvedIdx = state.tickets.findIndex(t => t.state !== 'Resolved');
    state.currentIndex = unresolvedIdx >= 0 ? unresolvedIdx : Math.max(0, state.tickets.length - 1);
    updateScore();
    renderShell();
  } catch (e) {
    console.error(e);
    shellEl().innerHTML = `<div class="empty large">Server error: ${escapeHtml(e.message)}</div>`;
  }
})();
