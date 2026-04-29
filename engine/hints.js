/**
 * Hint generation. Builds up to 3 progressive hints from a ticket's
 * answer key. The renderer requests them one at a time; each one
 * costs the agent a 5% scoring penalty when they finally resolve.
 */

const HINT_PENALTY_PER_USE = 5; // percentage points off the final pct

function buildHints(ticket) {
  const action = ticket.correct_action || 'resolve';
  const group = ticket.correct_group || ticket.assignment_group || '';
  const steps = ticket.correct_steps || [];
  const tier = ticket.tier || 1;
  const cat = ticket.category || 'incident';
  const escalate = action === 'escalate';

  const hint1 = {
    level: 1,
    title: 'Hint 1 — Frame the problem',
    body: `This is a ${cat} ticket. It looks like a Tier ${tier} issue. ` +
      (escalate
        ? `Ask yourself: does fixing this require permissions, tools, or knowledge a Tier ${tier} agent has? If not, it should escalate.`
        : `A Tier ${tier} agent is expected to own this end-to-end \u2014 don\u2019t reflexively escalate.`),
    why: escalate
      ? 'Triage starts by asking who actually has the rights and access to resolve this.'
      : 'Escalating early breaks SLA and trains the queue to over-rely on senior tiers.'
  };

  const firstStep = steps[0];
  const hint2 = {
    level: 2,
    title: 'Hint 2 — Direction',
    body: (firstStep
        ? `Start here: "${firstStep}". `
        : `Look at the description for a single observable signal you can verify. `) +
      (escalate
        ? `Once verified, escalate with evidence \u2014 don\u2019t hand off cold.`
        : `Then work the standard playbook for this category before resolving.`),
    why: ticket.rationale ||
      (escalate
        ? 'Escalations land faster when they include reproducible evidence and a clear ask.'
        : 'Following a checked playbook avoids skipped diagnostics and re-opens.')
  };

  const hint3 = {
    level: 3,
    title: 'Hint 3 — Specifics (full reveal)',
    body: `Action: ${action}. ` +
      (group ? `Assignment group: ${group}. ` : '') +
      (ticket.priority ? `Priority: P${ticket.priority}. ` : '') +
      (steps.length ? `Steps: ${steps.slice(0, 3).join('; ')}.` : ''),
    why: ticket.rationale ||
      'This is the answer key. Each used hint takes 5% off your final score for this ticket.'
  };

  return [hint1, hint2, hint3];
}

module.exports = { buildHints, HINT_PENALTY_PER_USE };
