/**
 * Incident lifecycle + alerting. A service that fails FAIL_THRESHOLD
 * consecutive checks gets one open incident and one "outage" alert (email +
 * socket + dashboard). Recovery closes the incident and raises a "recovery"
 * alert. SSL expiry warnings are raised at most once per day per service.
 */
const { Incident, Alert } = require('../../models');
const config = require('../../config');
const socket = require('../../services/socket');
const { sendAlertEmail, alertTemplate } = require('../../services/mailer');
const { hoursBetween } = require('../../utils/dates');
const log = require('../../utils/logger')('incidents');

/** Called when a check fails and consecutiveFails just reached the threshold. */
async function openIncident(service, checkResult) {
  const existing = await Incident.findOne({ service: service._id, status: 'open' });
  if (existing) return existing;

  const incident = await Incident.create({
    service: service._id,
    status: 'open',
    severity: 'down',
    startedAt: new Date(),
    failedChecks: service.state.consecutiveFails,
    lastError: checkResult.error || '',
  });
  log.warn(`OPEN incident for ${service.name}: ${checkResult.error}`);

  const alert = await raiseAlert({
    type: 'outage',
    severity: 'critical',
    title: `${service.name} is DOWN`,
    message:
      `${service.name} (${service.url}) failed ${service.state.consecutiveFails} ` +
      `consecutive checks. Last error: ${checkResult.error || 'unknown'}.`,
    service,
    incident,
    emailSubject: `DOWN: ${service.name}`,
    emailHtml: alertTemplate({
      heading: `Service DOWN: ${service.name}`,
      lines: [
        ['URL', service.url],
        ['Department', service.department],
        ['Consecutive failures', String(service.state.consecutiveFails)],
        ['Last error', checkResult.error || 'unknown'],
        ['Detected at', new Date().toLocaleString('en-IN', { timeZone: config.timezone })],
      ],
    }),
  });

  incident.alerts.openedEmailAt = alert.email.attempted ? new Date() : undefined;
  await incident.save();
  socket.emit('incident:opened', {
    incidentId: incident._id,
    serviceId: service._id,
    serviceName: service.name,
    startedAt: incident.startedAt,
    error: incident.lastError,
  });
  return incident;
}

/** Called when a previously failing service passes a check. */
async function resolveIncident(service) {
  const incident = await Incident.findOne({ service: service._id, status: 'open' });
  if (!incident) return null;

  incident.status = 'resolved';
  incident.resolvedAt = new Date();
  incident.durationHours = hoursBetween(incident.startedAt, incident.resolvedAt);
  await incident.save();
  log.info(`RESOLVED incident for ${service.name} after ${incident.durationHours}h`);

  await raiseAlert({
    type: 'recovery',
    severity: 'info',
    title: `${service.name} has recovered`,
    message: `${service.name} is responding again after ${incident.durationHours}h of downtime.`,
    service,
    incident,
    emailSubject: `RECOVERED: ${service.name}`,
    emailHtml: alertTemplate({
      heading: `Service recovered: ${service.name}`,
      color: '#27ae60',
      lines: [
        ['URL', service.url],
        ['Downtime', `${incident.durationHours} hours`],
        ['Down since', incident.startedAt.toLocaleString('en-IN', { timeZone: config.timezone })],
        ['Recovered at', incident.resolvedAt.toLocaleString('en-IN', { timeZone: config.timezone })],
      ],
    }),
  });

  socket.emit('incident:closed', {
    incidentId: incident._id,
    serviceId: service._id,
    serviceName: service.name,
    durationHours: incident.durationHours,
  });
  return incident;
}

/** Warn (once a day per service) when a certificate is close to expiry. */
async function checkSslExpiry(service) {
  const ssl = service.state.ssl;
  if (!ssl || !ssl.validTo || ssl.daysRemaining === undefined) return;
  if (ssl.daysRemaining > config.monitor.sslWarnDays) return;

  const since = new Date(Date.now() - 86400000);
  const recent = await Alert.findOne({
    type: 'ssl_expiry',
    service: service._id,
    createdAt: { $gte: since },
  });
  if (recent) return;

  await raiseAlert({
    type: 'ssl_expiry',
    severity: ssl.daysRemaining <= 7 ? 'critical' : 'warning',
    title: `SSL certificate for ${service.name} expires in ${ssl.daysRemaining} day(s)`,
    message: `${service.url} certificate (issuer: ${ssl.issuer || 'unknown'}) expires on ${ssl.validTo.toDateString()}.`,
    service,
    emailSubject: `SSL expiring: ${service.name} (${ssl.daysRemaining}d)`,
    emailHtml: alertTemplate({
      heading: `SSL certificate expiring: ${service.name}`,
      color: '#e67e22',
      lines: [
        ['URL', service.url],
        ['Issuer', ssl.issuer || 'unknown'],
        ['Expires', ssl.validTo.toDateString()],
        ['Days remaining', String(ssl.daysRemaining)],
      ],
    }),
  });
}

/**
 * Persist an Alert, emit it on the socket, and (optionally) email it.
 * All platform alerts flow through here.
 */
async function raiseAlert({
  type,
  severity,
  title,
  message,
  service,
  incident,
  department,
  emailSubject,
  emailHtml,
}) {
  const alert = new Alert({
    type,
    severity,
    title,
    message,
    service: service ? service._id : undefined,
    incident: incident ? incident._id : undefined,
    department: department || (service ? service.department : undefined),
  });
  if (emailSubject && emailHtml) {
    alert.email = await sendAlertEmail(emailSubject, emailHtml);
  }
  await alert.save();
  socket.emit('alert:new', {
    id: alert._id,
    type,
    severity,
    title,
    message,
    createdAt: alert.createdAt,
  });
  return alert;
}

module.exports = { openIncident, resolveIncident, checkSslExpiry, raiseAlert };
