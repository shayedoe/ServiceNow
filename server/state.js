// Holds the active session ID in memory. Single-user desktop app — one session at a time.
let currentSessionId = null;

function setCurrentSession(id) { currentSessionId = id; }
function getCurrentSession() { return currentSessionId; }

module.exports = { setCurrentSession, getCurrentSession };
