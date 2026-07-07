/**
 * SLA rules, modelled on PGMS Delhi norms: 7 days for first response,
 * 30 days for resolution, and 3 days end-to-end for SOS-priority grievances
 * (PGMS treats urgent/SOS petitions on a 2-3 day clock).
 */
const config = require('../../config');
const { addDays } = require('../../utils/dates');

/** Compute SLA deadlines for a grievance at registration time. */
function computeDeadlines(registeredAt, priority = 'normal') {
  if (priority === 'sos') {
    const due = addDays(registeredAt, config.sla.sosDays);
    return { responseDueAt: due, resolutionDueAt: due };
  }
  const factor = priority === 'urgent' ? 0.5 : 1; // urgent halves both clocks
  return {
    responseDueAt: addDays(registeredAt, Math.ceil(config.sla.responseDays * factor)),
    resolutionDueAt: addDays(registeredAt, Math.ceil(config.sla.resolutionDays * factor)),
  };
}

/**
 * Evaluate breach flags for a grievance doc (mutates and returns the flags).
 * A response breach: no first response before responseDueAt.
 * A resolution breach: not resolved before resolutionDueAt.
 */
function evaluateBreaches(g, now = new Date()) {
  const flags = { responseBreached: false, resolutionBreached: false };
  if (g.sla && g.sla.responseDueAt) {
    const respondedAt = g.firstResponseAt || g.resolvedAt;
    flags.responseBreached = respondedAt
      ? respondedAt > g.sla.responseDueAt
      : now > g.sla.responseDueAt;
  }
  if (g.sla && g.sla.resolutionDueAt) {
    flags.resolutionBreached = g.resolvedAt
      ? g.resolvedAt > g.sla.resolutionDueAt
      : now > g.sla.resolutionDueAt && g.status !== 'rejected';
  }
  return flags;
}

module.exports = { computeDeadlines, evaluateBreaches };
