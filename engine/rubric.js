/**
 * Rubric DSL — weighted, partial-credit grader.
 *
 * Rule types:
 *   exact       — string equality with optional partial{} map
 *   oneOff      — numeric, ±1 = 50% credit
 *   keywords    — keyword coverage: ≥80%=full, ≥50%=60%, >0%=20%
 *   timing      — response time vs deadline
 *   eventExists — was a specific action_type in the event timeline?
 *   eventBefore — did action A occur before action B?
 */

const { eventExists, eventBefore } = require('./checklist');

function gradeRule(rule, attempt) {
  const w = Number(rule.weight) || 0;
  const ans = attempt[rule.key];

  if (rule.type === 'exact') {
    if (ans != null && String(ans).toLowerCase() === String(rule.expected).toLowerCase()) {
      return res(rule, 1, true, `Correct: ${rule.expected}.`, rule.why_correct);
    }
    if (rule.partial && ans != null) {
      const k = Object.keys(rule.partial).find(
        x => x.toLowerCase() === String(ans).toLowerCase()
      );
      if (k != null) {
        const frac = Number(rule.partial[k]) || 0;
        return res(rule, frac, false,
          `Partial credit (${Math.round(frac * 100)}%) — "${ans}" is adjacent to "${rule.expected}".`,
          rule.why_wrong || `An adjacent answer earns partial credit, but the precise expected value is "${rule.expected}".`);
      }
    }
    return res(rule, 0, false,
      `You chose "${ans ?? '(none)'}" — expected "${rule.expected}".`,
      rule.why_wrong);
  }

  if (rule.type === 'oneOff') {
    const a = Number(ans), e = Number(rule.expected);
    if (Number.isFinite(a) && a === e) {
      return res(rule, 1, true, `Correct: P${e}.`, rule.why_correct);
    }
    if (Number.isFinite(a) && Math.abs(a - e) === 1) {
      return res(rule, 0.5, false,
        `Off by one (P${a} vs P${e}) — half credit.`,
        a < e ? 'Slight over-prioritization. Wastes attention vs real P1/P2s.'
              : 'Slight under-prioritization. Business impact justifies higher.');
    }
    return res(rule, 0, false,
      `You set P${ans || '?'} — expected P${e}.`, rule.why_wrong);
  }

  if (rule.type === 'keywords') {
    const text = String(attempt[rule.key] || '').toLowerCase();
    const kw = rule.keywords || [];
    if (!kw.length) return res(rule, 1, true, 'No keywords required.', '');
    const hit = kw.filter(k => text.includes(String(k).toLowerCase()));
    const missed = kw.filter(k => !hit.includes(k));
    const pct = hit.length / kw.length;
    let frac;
    if (pct >= 0.8) frac = 1;
    else if (pct >= 0.5) frac = 0.6;
    else if (pct > 0) frac = 0.2;
    else frac = 0;
    const ok = frac >= 1;
    return res(rule, frac, ok,
      `Notes cover ${hit.length}/${kw.length} expected steps${missed.length ? ` (missing: ${missed.join(', ')})` : ''}.`,
      ok ? 'Your work notes document the key actions a reviewer would expect.'
         : 'Document the actions you took in work notes so the next agent and the reviewer can follow your work.');
  }

  if (rule.type === 'eventExists') {
    const events = attempt._events || [];
    const found = eventExists(events, rule.event);
    return res(rule, found ? 1 : 0, found,
      found
        ? `Action "${rule.event}" was performed.`
        : `Required action "${rule.event}" was not performed.`,
      found ? rule.why_correct : (rule.why_wrong || `You must perform "${rule.event}" before resolving.`));
  }

  if (rule.type === 'eventBefore') {
    const events = attempt._events || [];
    const ok = eventBefore(events, rule.before, rule.after);
    return res(rule, ok ? 1 : 0, ok,
      ok
        ? `"${rule.before}" correctly occurred before "${rule.after}".`
        : `"${rule.before}" did not occur before "${rule.after}".`,
      ok ? rule.why_correct : (rule.why_wrong || `"${rule.before}" must be performed before "${rule.after}".`));
  }

  if (rule.type === 'timing') {
    const opened = toMs(rule.opened_at);
    const submitted = toMs(rule.submitted_at);
    const deadline = Number(rule.deadline_minutes) || 0;
    if (!opened || !submitted || !deadline) {
      return res(rule, 1, true, 'Timing not measured.', '');
    }
    const minutes = (submitted - opened) / 60000;
    if (minutes <= deadline) {
      return res(rule, 1, true,
        `Responded in ${minutes.toFixed(1)} min (target ${deadline} min).`,
        'You hit the SLA target.');
    }
    if (minutes <= deadline + 5) {
      return res(rule, 0.5, false,
        `Responded in ${minutes.toFixed(1)} min — ${(minutes - deadline).toFixed(1)} min over (half credit).`,
        'Marginal SLA breach. On a real queue this still counts against the team.');
    }
    return res(rule, 0, false,
      `Responded in ${minutes.toFixed(1)} min — well over ${deadline} min target.`,
      'Major SLA breach. Triage faster or escalate sooner.');
  }

  return res(rule, 0, false, 'Unknown rule type.', '');
}

function res(rule, fraction, ok, message, why) {
  const earned = (Number(rule.weight) || 0) * fraction;
  return { key: rule.key, label: rule.label || rule.key, weight: rule.weight || 0, earned, fraction, ok, message, why: why || '' };
}

function toMs(x) {
  if (!x) return 0;
  if (typeof x === 'number') return x;
  const t = Date.parse(String(x).replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
}

function gradeAttempt(rubric, attempt) {
  const details = (rubric.rules || []).map(r => gradeRule(r, attempt));
  const totalWeight = (rubric.rules || []).reduce((s, r) => s + (Number(r.weight) || 0), 0) || 1;
  const earned = details.reduce((s, d) => s + d.earned, 0);
  const pct = Math.round((earned / totalWeight) * 100);
  return { earned, totalWeight, pct, details };
}

module.exports = { gradeAttempt, gradeRule };
