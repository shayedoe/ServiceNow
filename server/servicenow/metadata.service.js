/**
 * ServiceNow metadata: choice fields (category, subcategory, impact, urgency,
 * priority, state) plus services / business services / CIs.
 *
 * Memoized for 1 hour to avoid hammering the instance.
 */
const { snGet } = require('./client');

const TTL = 60 * 60 * 1000;
const cache = new Map();

function memo(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);
  return fn().then(data => { cache.set(key, { data, at: Date.now() }); return data; });
}

function display(field) {
  if (!field) return '';
  if (typeof field === 'object') return field.display_value || field.value || '';
  return String(field);
}

async function listChoices(element) {
  const q = encodeURIComponent(`name=incident^element=${element}^inactive=false^ORDERBYsequence`);
  const path = `/api/now/table/sys_choice?sysparm_query=${q}` +
    `&sysparm_fields=label,value,dependent_value,sequence` +
    `&sysparm_display_value=true&sysparm_limit=200`;
  const data = await snGet(path);
  return (data.result || []).map(row => ({
    label: row.label,
    value: row.value,
    dependent_value: row.dependent_value || null,
    sequence: Number(row.sequence || 0)
  }));
}

async function getIncidentMetadata() {
  return memo('incident-meta', async () => {
    const [category, subcategory, impact, urgency, priority, state, contact_type] =
      await Promise.all([
        listChoices('category'),
        listChoices('subcategory'),
        listChoices('impact'),
        listChoices('urgency'),
        listChoices('priority'),
        listChoices('state'),
        listChoices('contact_type')
      ]);
    // Many PDIs have no sys_choice rows for the numeric fields; fall back so the form is usable.
    const DEFAULTS = {
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
    const pick = (live, def) => (Array.isArray(live) && live.length ? live : def);
    return {
      category,
      subcategory,
      impact: pick(impact, DEFAULTS.impact),
      urgency: pick(urgency, DEFAULTS.urgency),
      priority: pick(priority, DEFAULTS.priority),
      state: pick(state, DEFAULTS.state),
      contact_type: pick(contact_type, DEFAULTS.contact_type)
    };
  });
}

async function listServices(limit = 100) {
  return memo('services', async () => {
    const path = `/api/now/table/cmdb_ci_service?sysparm_query=ORDERBYname` +
      `&sysparm_fields=sys_id,name,sys_class_name,location,assigned_to` +
      `&sysparm_display_value=all&sysparm_exclude_reference_link=true` +
      `&sysparm_limit=${limit}`;
    const data = await snGet(path);
    let rows = (data.result || []);
    if (!rows.length) {
      // Fallback to cmdb_ci with class filter
      const q = encodeURIComponent(`sys_class_name=cmdb_ci_service^ORDERBYname`);
      const fb = await snGet(`/api/now/table/cmdb_ci?sysparm_query=${q}` +
        `&sysparm_fields=sys_id,name,sys_class_name,location,assigned_to` +
        `&sysparm_display_value=all&sysparm_exclude_reference_link=true&sysparm_limit=${limit}`);
      rows = fb.result || [];
    }
    return rows.map(row => ({
      sys_id: display(row.sys_id),
      name: display(row.name),
      class: display(row.sys_class_name),
      location: display(row.location),
      assigned_to: display(row.assigned_to)
    }));
  });
}

function clearCache() { cache.clear(); }

module.exports = { listChoices, getIncidentMetadata, listServices, clearCache };
