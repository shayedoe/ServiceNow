/** Lookup services for users, groups, CIs with in-memory TTL cache. */
const { snGet } = require('./client');
const { normalizeUser, normalizeGroup, normalizeCI } = require('./mapper');

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const cache = new Map();

function memoize(key, fetcher) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.data);
  return fetcher().then(data => { cache.set(key, { data, at: Date.now() }); return data; });
}

function listGroups(limit = 200) {
  return memoize('groups', async () => {
    const r = await snGet(`/api/now/table/sys_user_group?sysparm_limit=${limit}&sysparm_fields=sys_id,name,manager,email&sysparm_display_value=true&sysparm_query=active=true^ORDERBYname`);
    return (r.result || []).map(normalizeGroup);
  });
}

function listUsers(limit = 300) {
  return memoize('users', async () => {
    const r = await snGet(`/api/now/table/sys_user?sysparm_limit=${limit}&sysparm_fields=sys_id,name,email,user_name,department&sysparm_display_value=true&sysparm_query=active=true^ORDERBYname`);
    return (r.result || []).map(normalizeUser);
  });
}

function listCIs(limit = 200) {
  return memoize('cis', async () => {
    const r = await snGet(`/api/now/table/cmdb_ci?sysparm_limit=${limit}&sysparm_fields=sys_id,name,sys_class_name,ip_address&sysparm_display_value=true&sysparm_query=install_status=1^ORDERBYname`);
    return (r.result || []).map(normalizeCI);
  });
}

function clearCache() { cache.clear(); }

module.exports = { listGroups, listUsers, listCIs, clearCache };
