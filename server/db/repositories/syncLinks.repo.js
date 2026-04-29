const { getDb } = require('../database');

function createLink({ ticket_id, sn_sys_id, sn_number, sync_mode }) {
  getDb().prepare(`
    INSERT OR REPLACE INTO servicenow_sync_links (ticket_id, sn_sys_id, sn_number, sync_mode, last_synced_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(ticket_id, sn_sys_id, sn_number || null, sync_mode || 'pull', new Date().toISOString());
}

function getLink(ticket_id) {
  return getDb().prepare('SELECT * FROM servicenow_sync_links WHERE ticket_id = ?').get(ticket_id) || null;
}

function updateLastSynced(ticket_id) {
  getDb().prepare('UPDATE servicenow_sync_links SET last_synced_at = ? WHERE ticket_id = ?')
    .run(new Date().toISOString(), ticket_id);
}

module.exports = { createLink, getLink, updateLastSynced };
