const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  port: process.env.PORT || 3000,
  alertThresholds: {
    errorCount: parseInt(process.env.ALERT_ERROR_THRESHOLD) || 5,
    critCount:  parseInt(process.env.ALERT_CRIT_THRESHOLD)  || 1,
  },
  email: {
    enabled: process.env.EMAIL_ALERTS === 'true',
    host:    process.env.SMTP_HOST   || 'smtp.gmail.com',
    port:    parseInt(process.env.SMTP_PORT) || 587,
    user:    process.env.SMTP_USER   || '',
    pass:    process.env.SMTP_PASS   || '',
    to:      process.env.ALERT_EMAIL || 'admin@example.com',
  },
  slack: {
    enabled:    process.env.SLACK_ALERTS === 'true',
    webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  },
  logDir: process.env.LOG_DIR || '/var/log',
};

// ── Pattern definitions ───────────────────────────────────────────────────────
const PUPPET_PATTERNS = [
  { re: /catalog.*error|error.*catalog/i,        label: 'Catalog error',             sev: 'error'    },
  { re: /could not retrieve catalog/i,            label: 'Catalog retrieval failure', sev: 'error'    },
  { re: /transaction aborted/i,                   label: 'Transaction aborted',       sev: 'critical' },
  { re: /certificate verify failed/i,             label: 'SSL/cert failure',          sev: 'error'    },
  { re: /finished catalog run.*error/i,           label: 'Run completed with errors', sev: 'warn'     },
  { re: /applying configuration version/i,        label: 'Catalog apply started',     sev: 'info'     },
  { re: /finished catalog run/i,                  label: 'Catalog apply success',     sev: 'info'     },
  { re: /timeout|timed out/i,                     label: 'Timeout',                   sev: 'warn'     },
  { re: /failed password|authentication failure/i,label: 'Auth failure',              sev: 'warn'     },
  { re: /oom-killer|out of memory/i,              label: 'OOM event',                 sev: 'critical' },
  { re: /service alert.*critical/i,               label: 'Nagios critical',           sev: 'error'    },
  { re: /service alert.*warning/i,                label: 'Nagios warning',            sev: 'warn'     },
  { re: /service recovery|host recovery/i,        label: 'Recovery event',            sev: 'info'     },
  { re: /innodb|mysqld.*error/i,                  label: 'MySQL error',               sev: 'error'    },
  { re: /heap usage.*%/i,                         label: 'JVM heap pressure',         sev: 'warn'     },
];

// ── Parsing helpers ───────────────────────────────────────────────────────────
function parseLevel(line) {
  if (/\[ERROR\]|ERROR:|sshd.*failed password|mysqld.*\[ERROR\]|\bERROR\b/i.test(line)) return 'ERROR';
  if (/\[WARN\]|WARNING|WARN:/i.test(line))            return 'WARN';
  if (/\[INFO\]|INFO:/i.test(line))                    return 'INFO';
  if (/\[DEBUG\]|DEBUG:/i.test(line))                  return 'DEBUG';
  if (/\[CRIT\]|CRITICAL|CRIT:/i.test(line))           return 'CRIT';
  if (/ALERT.*CRITICAL|DOWN;HARD/i.test(line))         return 'CRIT';
  if (/ALERT.*WARNING/i.test(line))                    return 'WARN';
  if (/ALERT.*OK|RECOVERY/i.test(line))                return 'INFO';
  return 'INFO';
}

function parseTime(line) {
  let m;
  m = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
  if (m) return m[1];
  m = line.match(/\[(\d{10})\]/);
  if (m) return new Date(parseInt(m[1]) * 1000).toISOString().replace('T',' ').slice(0,19);
  m = line.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s+\d{2}:\d{2}:\d{2}/i);
  if (m) return m[0];
  return null;
}

function extractMsg(line) {
  return line
    .replace(/^\[?\d{10}\]?\s*/,'')
    .replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s*/,'')
    .replace(/\[(ERROR|WARN|INFO|DEBUG|CRIT)\]\s*/i,'')
    .trim() || line;
}

function parseLogs(rawText) {
  return rawText.split('\n').map(l => l.trim()).filter(Boolean).map(line => ({
    raw:      line,
    level:    parseLevel(line),
    time:     parseTime(line),
    msg:      extractMsg(line),
    patterns: PUPPET_PATTERNS.filter(p => p.re.test(line)).map(p => p.label),
  }));
}

function buildStats(entries) {
  const c = { ERROR:0, WARN:0, INFO:0, DEBUG:0, CRIT:0 };
  entries.forEach(e => { c[e.level] = (c[e.level]||0) + 1; });
  return {
    total:      entries.length,
    errors:     (c.ERROR||0) + (c.CRIT||0),
    warnings:   c.WARN  || 0,
    info:       (c.INFO||0) + (c.DEBUG||0),
    bySeverity: c,
  };
}

function buildPatternSummary(entries) {
  const map = {};
  entries.forEach(e => e.patterns.forEach(l => { map[l] = (map[l]||0)+1; }));
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([label,count])=>({label,count}));
}

function buildTimeline(entries) {
  const tl = {};
  entries.forEach(e => {
    if (!e.time) return;
    const key = e.time.slice(0,16);
    if (!tl[key]) tl[key] = {total:0,errors:0};
    tl[key].total++;
    if (e.level==='ERROR'||e.level==='CRIT') tl[key].errors++;
  });
  return Object.entries(tl).sort(([a],[b])=>a>b?1:-1).map(([time,d])=>({time,...d}));
}

// ── Alert helpers ─────────────────────────────────────────────────────────────
async function sendSlackAlert(message) {
  if (!CONFIG.slack.enabled || !CONFIG.slack.webhookUrl) return;
  try {
    const https = require('https');
    const body  = JSON.stringify({ text: message });
    const url   = new URL(CONFIG.slack.webhookUrl);
    const opts  = { hostname:url.hostname, path:url.pathname, method:'POST',
                    headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)} };
    await new Promise((res,rej)=>{
      const req = https.request(opts, r=>{ r.resume(); r.on('end',res); });
      req.on('error',rej); req.write(body); req.end();
    });
    console.log('[ALERT] Slack sent');
  } catch(err) { console.error('[ALERT] Slack failed:', err.message); }
}

async function sendEmailAlert(subject, body) {
  if (!CONFIG.email.enabled) return;
  try {
    // Uses nodemailer if installed; otherwise logs to console
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({
      host: CONFIG.email.host, port: CONFIG.email.port,
      auth: { user: CONFIG.email.user, pass: CONFIG.email.pass },
    });
    await t.sendMail({ from: CONFIG.email.user, to: CONFIG.email.to, subject, text: body });
    console.log('[ALERT] Email sent:', subject);
  } catch(err) { console.error('[ALERT] Email failed:', err.message); }
}

async function triggerAlerts(stats, patterns) {
  const alerts = [];
  if (stats.errors >= CONFIG.alertThresholds.errorCount)
    alerts.push(`HIGH ERROR RATE: ${stats.errors} errors in this batch`);
  if (stats.bySeverity.CRIT >= CONFIG.alertThresholds.critCount)
    alerts.push(`CRITICAL EVENTS: ${stats.bySeverity.CRIT} CRIT-level entries`);

  const critPats = patterns.filter(p =>
    ['Transaction aborted','OOM event','SSL/cert failure','Catalog retrieval failure'].includes(p.label));
  if (critPats.length)
    alerts.push(`PUPPET CRITICAL PATTERNS: ${critPats.map(p=>p.label).join(', ')}`);

  if (alerts.length) {
    const subject = `[Log Analyzer] Alert: ${alerts.length} issue(s) detected`;
    const body    = `Log Pattern Analyzer\n\n${alerts.join('\n')}\n\nStats:\n  Total: ${stats.total}\n  Errors: ${stats.errors}\n  Warnings: ${stats.warnings}`;
    await sendEmailAlert(subject, body);
    await sendSlackAlert(`*${subject}*\n${alerts.join('\n')}`);
    console.log('[ALERTS TRIGGERED]', alerts);
  }
  return alerts;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/analyze  — main endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { logs } = req.body;
    if (!logs || typeof logs !== 'string')
      return res.status(400).json({ error: 'Missing "logs" string in body' });

    const entries  = parseLogs(logs);
    const stats    = buildStats(entries);
    const patterns = buildPatternSummary(entries);
    const timeline = buildTimeline(entries);
    const alerts   = await triggerAlerts(stats, patterns);

    res.json({ success:true, stats, patterns, timeline, entries, alerts });
  } catch(err) {
    console.error('[/api/analyze]', err);
    res.status(500).json({ error:'Analysis failed', details:err.message });
  }
});

// GET /api/file?path=...  — read a server log file
app.get('/api/file', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'Missing path param' });
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(CONFIG.logDir)))
      return res.status(403).json({ error: 'Access denied outside log directory' });
    if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'File not found' });
    const content = fs.readFileSync(resolved,'utf8');
    const lines   = content.split('\n').slice(-500).join('\n');
    res.json({ success:true, path:resolved, lines });
  } catch(err) { res.status(500).json({ error:err.message }); }
});

// GET /api/logs  — list log files
app.get('/api/logs', (req, res) => {
  try {
    const dir = CONFIG.logDir;
    if (!fs.existsSync(dir)) return res.json({ files:[] });
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.log') || f === 'syslog' || f === 'messages')
      .map(f => ({ name:f, path:path.join(dir,f) }));
    res.json({ files });
  } catch(err) { res.status(500).json({ error:err.message }); }
});

// GET /api/health
app.get('/api/health', (_req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  config: { alertThresholds: CONFIG.alertThresholds,
            emailEnabled: CONFIG.email.enabled, slackEnabled: CONFIG.slack.enabled },
}));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(CONFIG.port, () => {
  console.log(`\nLog Pattern Analyzer API → http://localhost:${CONFIG.port}`);
  console.log(`  Email alerts : ${CONFIG.email.enabled}`);
  console.log(`  Slack alerts : ${CONFIG.slack.enabled}`);
  console.log(`  Error threshold : ${CONFIG.alertThresholds.errorCount}\n`);
});
