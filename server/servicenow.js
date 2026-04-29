/**
 * ServiceNow Table API client + local settings store.
 * Password is encrypted at rest if main.js wires up safeStorage via setCrypto().
 * Otherwise falls back to plaintext (with a flag) so dev still works.
 *
 * Includes 429 Retry-After handling per ServiceNow inbound rate-limit docs.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

let userDataDir = path.join(os.homedir(), '.helpdesksim');
let cfg = null;
let crypto = null; // { encrypt(str) -> b64, decrypt(b64) -> str }

function setUserDataDir(dir) { userDataDir = dir; cfg = null; }
function setCrypto(c) { crypto = c; cfg = null; }

function configPath() { return path.join(userDataDir, 'sn-config.json'); }

function loadConfig() {
  if (cfg) return cfg;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch { raw = { instance: '', username: '' }; }
  let password = '';
  if (raw.password_enc && crypto) {
    try { password = crypto.decrypt(raw.password_enc); } catch { password = ''; }
  } else if (raw.password) {
    password = raw.password;
  }
  cfg = {
    instance: raw.instance || '',
    username: raw.username || '',
    password,
    encrypted: Boolean(raw.password_enc)
  };
  return cfg;
}

function saveConfig(next) {
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
  const instance = String(next.instance || '').trim().replace(/\/+$/, '');
  const username = String(next.username || '').trim();
  const password = String(next.password || '');
  const out = { instance, username };
  if (password) {
    if (crypto) out.password_enc = crypto.encrypt(password);
    else out.password = password; // last-resort fallback
  } else {
    // preserve existing
    const prev = loadConfig();
    if (prev.password) {
      if (crypto) out.password_enc = crypto.encrypt(prev.password);
      else out.password = prev.password;
    }
  }
  fs.writeFileSync(configPath(), JSON.stringify(out, null, 2), 'utf8');
  cfg = null;
  return getPublicConfig();
}

function getPublicConfig() {
  const c = loadConfig();
  return {
    instance: c.instance,
    username: c.username,
    configured: Boolean(c.instance && c.username && c.password),
    encrypted: c.encrypted
  };
}

function authHeader() {
  const c = loadConfig();
  return 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64');
}

async function snFetch(pathAndQuery, opts = {}) {
  const c = loadConfig();
  if (!c.instance) throw new Error('ServiceNow instance not configured');
  const url = c.instance + pathAndQuery;
  const maxRetries = 4;
  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': authHeader(),
        ...(opts.headers || {})
      }
    });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (res.ok) return body;

    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      const retryAfter = Number(res.headers.get('Retry-After') || 0);
      const delay = retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
      await new Promise(r => setTimeout(r, delay));
      attempt += 1;
      continue;
    }
    const msg = body?.error?.message || body?.error || body?.raw || res.statusText;
    throw new Error(`ServiceNow ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
}

async function testConnection() {
  const r = await snFetch('/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=user_name');
  return { ok: true, sample: r.result && r.result[0] };
}

async function fetchIncidents({ limit = 10, mode = 'closed' } = {}) {
  const fields = [
    'number','short_description','description','priority','impact','urgency',
    'state','category','subcategory','assignment_group','assigned_to',
    'caller_id','opened_at','resolved_at','close_notes','close_code',
    'sys_id','sys_updated_on','sys_mod_count'
  ].join(',');
  const query = mode === 'open'
    ? 'active=true^ORDERBYDESCsys_created_on'
    : 'stateIN6,7^ORDERBYDESCresolved_at';
  const url = `/api/now/table/incident?sysparm_limit=${limit}` +
    `&sysparm_display_value=all` +
    `&sysparm_exclude_reference_link=true` +
    `&sysparm_query=${encodeURIComponent(query)}` +
    `&sysparm_fields=${fields}`;
  const r = await snFetch(url);
  return (r.result || []).map(normalizeIncident);
}

const ref = (f) => (f && typeof f === 'object') ? (f.value || null) : (f || null);
const disp = (f) => (f && typeof f === 'object') ? (f.display_value || f.value || null) : (f || null);

function normalizeIncident(inc) {
  const priorityNum = parseInt(String(disp(inc.priority) || '').match(/\d+/)?.[0] || '3', 10) || 3;
  const stateLabel = disp(inc.state) || 'New';
  const wasResolved = ['Resolved','Closed'].includes(stateLabel);
  const closeNotes = disp(inc.close_notes) || '';
  const closeCode = disp(inc.close_code) || '';
  return {
    number: disp(inc.number),
    short_description: disp(inc.short_description),
    description: disp(inc.description) || disp(inc.short_description),
    priority: priorityNum,
    category: disp(inc.category) || 'inquiry',
    subcategory: disp(inc.subcategory) || '',
    tier: inferTier(priorityNum, disp(inc.assignment_group)),
    assignment_group: disp(inc.assignment_group) || '',
    correct_action: wasResolved ? 'resolve' : 'escalate',
    correct_group: disp(inc.assignment_group) || '',
    correct_steps: parseSteps(closeNotes),
    expected_keywords: deriveKeywords(closeNotes, disp(inc.short_description)),
    rationale: closeNotes
      ? `Real resolution: ${truncate(closeNotes, 240)}`
      : 'No close notes on this incident — scoring uses field values only.',
    state: 'New',
    assigned_group: null,
    notes: [],
    created_at: disp(inc.opened_at) || new Date().toISOString(),
    sn: {
      sys_id: ref(inc.sys_id),
      caller_id: ref(inc.caller_id),
      caller_label: disp(inc.caller_id),
      assignment_group_id: ref(inc.assignment_group),
      original_state: stateLabel,
      close_code: closeCode,
      close_notes: closeNotes,
      resolved_at: disp(inc.resolved_at),
      sys_updated_on: disp(inc.sys_updated_on),
      sys_mod_count: disp(inc.sys_mod_count)
    },
    is_live: true
  };
}

function inferTier(priorityNum, groupLabel) {
  const g = String(groupLabel || '').toLowerCase();
  if (priorityNum <= 2 || /engineering|tier 3|database/.test(g)) return 3;
  if (/tier 2|network|application|security/.test(g)) return 2;
  return 1;
}

function parseSteps(text) {
  if (!text) return [];
  return String(text)
    .split(/\r?\n|;|\u2022/)
    .map(s => s.replace(/^[-*\d.\s]+/, '').trim())
    .filter(s => s.length > 3)
    .slice(0, 6);
}

function deriveKeywords(closeNotes, shortDesc) {
  const src = `${closeNotes} ${shortDesc}`.toLowerCase();
  const stop = new Set(['the','and','for','with','that','this','have','from','user','users','was','were','been','will','please','issue','ticket','incident','their','they']);
  const words = src.match(/[a-z][a-z0-9-]{3,}/g) || [];
  const freq = new Map();
  for (const w of words) if (!stop.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a,b) => b[1]-a[1]).slice(0, 5).map(([w]) => w);
}

function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

module.exports = {
  setUserDataDir,
  setCrypto,
  loadConfig,
  saveConfig,
  getPublicConfig,
  testConnection,
  fetchIncidents
};
