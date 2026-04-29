/**
 * Scoring — builds a rubric from the ticket's answer key and grades the attempt
 * via the rubric DSL. Keeps the original "pattern detection" behavior:
 * 3+ tickets sharing a short_description forces escalate.
 */
const { gradeAttempt } = require('./rubric');

function detectPatternEscalation(ticket, allTickets) {
  if (!allTickets) return false;
  const same = allTickets.filter(t =>
    t.short_description === ticket.short_description &&
    t.number !== ticket.number
  );
  return same.length >= 2;
}

function buildRubric(ticket, opts = {}) {
  const patternForcesEscalate = opts.patternForcesEscalate;
  const expectedAction = patternForcesEscalate ? 'escalate' : ticket.correct_action;
  const expectedGroup = ticket.correct_group || ticket.assignment_group || '';

  const rules = [];

  rules.push({
    key: 'action',
    label: 'Action',
    weight: 30,
    type: 'exact',
    expected: expectedAction,
    why_correct: ticket.rationale ||
      (expectedAction === 'escalate'
        ? 'This is outside this tier\u2019s scope; escalation is required.'
        : 'This can be resolved at this tier with standard steps.') +
      (patternForcesEscalate ? ' Pattern of duplicates indicates an outage.' : ''),
    why_wrong: patternForcesEscalate
      ? 'Multiple tickets share this description \u2014 outage pattern, must escalate.'
      : (ticket.rationale || 'Review the recommended steps for the right call.')
  });

  rules.push({
    key: 'assigned_group',
    label: 'Assignment Group',
    weight: 25,
    type: 'exact',
    expected: expectedGroup,
    partial: ticket.partial_groups || {},
    why_correct: 'Routing to the right team avoids ping-pong and SLA breaches.',
    why_wrong: 'The assignment group must own the system that can actually fix this.'
  });

  rules.push({
    key: 'priority',
    label: 'Priority',
    weight: 20,
    type: 'oneOff',
    expected: ticket.priority,
    why_correct: 'Priority drives SLA timers; matching it correctly keeps reporting clean.',
    why_wrong: 'Priority drives SLA timers; mis-priority distorts queue triage.'
  });

  if (ticket.expected_keywords && ticket.expected_keywords.length) {
    rules.push({
      key: 'note',
      label: 'Troubleshooting Steps',
      weight: 15,
      type: 'keywords',
      keywords: ticket.expected_keywords
    });
  }

  if (ticket.response_deadline_minutes && opts.opened_at && opts.submitted_at) {
    rules.push({
      key: '__timing',
      label: 'Response Time',
      weight: 10,
      type: 'timing',
      deadline_minutes: ticket.response_deadline_minutes,
      opened_at: opts.opened_at,
      submitted_at: opts.submitted_at,
      why_correct: 'Hitting SLA targets keeps the team green.',
      why_wrong: 'SLA breach. Triage faster or escalate sooner.'
    });
  }

  return { rules };
}

function scoreTicket(ticket, userInput, allTickets, opts = {}) {
  const patternForcesEscalate = detectPatternEscalation(ticket, allTickets);
  const expectedAction = patternForcesEscalate ? 'escalate' : ticket.correct_action;
  const expectedGroup = ticket.correct_group || ticket.assignment_group || '';

  const rubric = buildRubric(ticket, {
    patternForcesEscalate,
    opened_at: opts.opened_at || ticket.created_at,
    submitted_at: opts.submitted_at || Date.now()
  });

  const attempt = {
    action: userInput.action,
    assigned_group: userInput.assigned_group,
    priority: Number(userInput.priority),
    note: [
      ...(ticket.notes || []).map(n => n.text || ''),
      userInput.note || ''
    ].join(' \n ')
  };

  const graded = gradeAttempt(rubric, attempt);

  const details = graded.details.map(d => ({
    check: d.label,
    ok: d.ok,
    fraction: d.fraction,
    earned: Math.round(d.earned * 10) / 10,
    weight: d.weight,
    message: d.message,
    why: d.why
  }));

  const correct = details.filter(d => d.ok).length;
  const total = details.length;

  return {
    score: `${graded.pct}% (${correct}/${total} full credit)`,
    pct: graded.pct,
    earned: Math.round(graded.earned * 10) / 10,
    total_weight: graded.totalWeight,
    correct,
    total,
    tier: ticket.tier || 1,
    pattern_detected: patternForcesEscalate,
    effective_action: expectedAction,
    effective_group: expectedGroup,
    correct_steps: ticket.correct_steps,
    rationale: ticket.rationale || '',
    details
  };
}

module.exports = { scoreTicket, detectPatternEscalation, buildRubric };
