/**
 * Checklist — evaluates whether required actions appeared in the attempt_events timeline.
 * Used by rubric rules of type 'eventExists' and 'eventBefore'.
 */

function eventExists(events, actionType) {
  return events.some(e => e.action_type === actionType);
}

/**
 * Returns true if actionA occurred before actionB in the timeline.
 * Both must have occurred for this to be true.
 */
function eventBefore(events, actionA, actionB) {
  const aIdx = events.findIndex(e => e.action_type === actionA);
  const bIdx = events.findIndex(e => e.action_type === actionB);
  return aIdx >= 0 && bIdx >= 0 && aIdx < bIdx;
}

function getPerformedActions(events) {
  return [...new Set(events.map(e => e.action_type))];
}

/**
 * Check which required events from the list were performed.
 * Returns { hit: [], missed: [], pct: number }
 */
function checkRequiredEvents(events, required) {
  if (!required || !required.length) return { hit: [], missed: [], pct: 1 };
  const performed = getPerformedActions(events);
  const hit = required.filter(r => performed.includes(r));
  const missed = required.filter(r => !performed.includes(r));
  return { hit, missed, pct: hit.length / required.length };
}

const ACTION_LABELS = {
  validate_caller: 'Validate Caller',
  check_scope: 'Check Scope',
  check_related_incidents: 'Check Related Incidents',
  set_impact_urgency: 'Set Impact/Urgency',
  assign_group: 'Assign Group',
  add_work_note: 'Add Work Note',
  add_comment: 'Add Caller Comment',
  link_parent: 'Link Parent Incident',
  escalate: 'Escalate',
  resolve: 'Resolve'
};

function labelFor(actionType) {
  return ACTION_LABELS[actionType] || actionType.replace(/_/g, ' ');
}

module.exports = { eventExists, eventBefore, getPerformedActions, checkRequiredEvents, labelFor };
