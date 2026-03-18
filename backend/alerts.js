'use strict';

const https = require('https');

// ─── Thresholds (override via environment variables) ─────────────────────────
const THRESHOLDS = {
  errorCount:      parseInt(process.env.ALERT_ERROR_COUNT  || '5'),
  critCount:       parseInt(process.env.ALERT_CRIT_COUNT   || '1'),
  warnCount:       parseInt(process.env.ALERT_WARN_COUNT   || '10'),
  oomCount:        parseInt(process.env.ALERT_OOM_COUNT    || '1'),
  sslIssues:       parseInt(process.env.ALERT_SSL_COUNT    || '1'),
  catalogFailures: parseInt(process.env.ALERT_CATALOG_COUNT|| '2'),
};

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL || '';

// ─── Alert definitions ────────────────────────────────────────────────────────
function checkAlerts(result) {
  const alerts = [];
  const { counts, topPatterns, puppet } = result;

  const errorTotal = (counts.ERROR || 0) + (counts.CRIT || 0);

  if ((counts.CRIT || 0) >= THRESHOLDS.critCount) {
    alerts.push({
      level:   'CRITICAL',
      message: `${counts.CRIT} CRITICAL log event(s) detected — immediate action required.`,
      rule:    'crit_count',
    });
  }

  if (errorTotal >= THRESHOLDS.errorCount) {
    alerts.push({
      level:   'HIGH',
      message: `High error rate: ${errorTotal} errors found (threshold: ${THRESHOLDS.errorCount}).`,
      rule:    'error_count',
    });
  }

  if ((counts.WARN || 0) >= THRESHOLDS.warnCount) {
    alerts.push({
      level:   'MEDIUM',
      message: `Elevated warnings: ${counts.WARN} warnings (threshold: ${THRESHOLDS.warnCount}).`,
      rule:    'warn_count',
    });
  }

  const oomPattern = topPatterns.find(p => p.label === 'OOM event');
  if (oomPattern && oomPattern.count >= THRESHOLDS.oomCount) {
    alerts.push({
      level:   'CRITICAL',
      message: `Out-of-memory event(s) detected (${oomPattern.count}x). Risk of service crashes.`,
      rule:    'oom_event',
    });
  }

  if (puppet.sslIssues >= THRESHOLDS.sslIssues) {
    alerts.push({
      level:   'HIGH',
      message: `SSL/certificate issue(s) detected in Puppet logs (${puppet.sslIssues} occurrence(s)).`,
      rule:    'ssl_issues',
    });
  }

  const catalogFail = topPatterns.find(p => p.label === 'Catalog retrieval failure');
  if (catalogFail && catalogFail.count >= THRESHOLDS.catalogFailures) {
    alerts.push({
      level:   'HIGH',
      message: `Puppet catalog retrieval failed ${catalogFail.count}x. Nodes may be running stale catalogs.`,
      rule:    'catalog_failure',
    });
  }

  const transactionAbort = topPatterns.find(p => p.label === 'Transaction aborted');
  if (transactionAbort) {
    alerts.push({
      level:   'CRITICAL',
      message: `Puppet transaction aborted ${transactionAbort.count}x — catalog apply incomplete.`,
      rule:    'transaction_abort',
    });
  }

  // Fire-and-forget Slack notification for CRITICAL alerts
  if (SLACK_WEBHOOK && alerts.some(a => a.level === 'CRITICAL')) {
    sendSlackAlert(alerts.filter(a => a.level === 'CRITICAL'));
  }

  return alerts;
}

// ─── Slack webhook ─────────────────────────────────────────────────────────────
function sendSlackAlert(critAlerts) {
  const text = critAlerts.map(a => `*[${a.level}]* ${a.message}`).join('\n');
  const body = JSON.stringify({
    text: `:rotating_light: *Log Analyzer Alert*\n${text}`,
  });

  try {
    const url = new URL(SLACK_WEBHOOK);
    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(options);
    req.on('error', () => {}); // silent – alerting is best-effort
    req.write(body);
    req.end();
  } catch (_) {}
}

module.exports = { checkAlerts };
