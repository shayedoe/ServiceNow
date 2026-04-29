/**
 * Low-level ServiceNow HTTP client.
 * Config is injected via setConfigProvider() from server/servicenow.js.
 * Handles 429 Retry-After and 5xx exponential backoff.
 */

const MAX_RETRIES = 4;
let _getConfig = null;

function setConfigProvider(fn) { _getConfig = fn; }

function authHeader() {
  const c = _getConfig();
  return 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64');
}

async function snRequest(method, pathAndQuery, body) {
  const c = _getConfig();
  if (!c || !c.instance) throw new Error('ServiceNow instance not configured');
  const url = c.instance + pathAndQuery;
  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': authHeader()
      },
      body: body != null ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { _raw: text }; }

    if (res.ok) return parsed;

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('Retry-After') || 0);
      const delay = retryAfter > 0
        ? retryAfter * 1000
        : Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
      await new Promise(r => setTimeout(r, delay));
      attempt++;
      continue;
    }

    const msg = parsed?.error?.message || parsed?.error || parsed?._raw || res.statusText;
    throw new Error(`ServiceNow ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
}

const snGet = (path) => snRequest('GET', path, null);
const snPost = (path, body) => snRequest('POST', path, body);
const snPatch = (path, body) => snRequest('PATCH', path, body);

module.exports = { setConfigProvider, snGet, snPost, snPatch };
