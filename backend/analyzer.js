'use strict';

const PUPPET_PATTERNS = [
  { re: /catalog.*error|error.*catalog/i,      label: 'Catalog error',            sev: 'error'    },
  { re: /could not retrieve catalog/i,          label: 'Catalog retrieval failure', sev: 'error'    },
  { re: /transaction aborted/i,                 label: 'Transaction aborted',       sev: 'critical' },
  { re: /certificate verify failed/i,           label: 'SSL/cert failure',          sev: 'error'    },
  { re: /finished catalog run.*error/i,         label: 'Run with errors',           sev: 'warn'     },
  { re: /applying configuration version/i,      label: 'Catalog apply started',     sev: 'info'     },
  { re: /finished catalog run/i,                label: 'Catalog apply success',     sev: 'info'     },
  { re: /timeout|timed out/i,                   label: 'Timeout',                   sev: 'warn'     },
  { re: /failed password|authentication failure/i, label: 'Auth failure',           sev: 'warn'     },
  { re: /oom-killer|out of memory/i,            label: 'OOM event',                 sev: 'critical' },
  { re: /service alert.*critical/i,             label: 'Nagios critical alert',     sev: 'error'    },
  { re: /service alert.*warning/i,              label: 'Nagios warning alert',      sev: 'warn'     },
  { re: /service recovery|host recovery/i,      label: 'Recovery event',            sev: 'info'     },
  { re: /innodb|mysqld.*error/i,                label: 'MySQL error',               sev: 'error'    },
  { re: /heap usage.*%/i,                       label: 'JVM heap pressure',         sev: 'warn'     },
  { re: /exec.*failed with exit code/i,         label: 'Exec resource failure',     sev: 'error'    },
  { re: /ssl_connect|ssl error/i,               label: 'SSL connection error',      sev: 'error'    },
  { re: /could not send report/i,               label: 'Report send failure',       sev: 'warn'     },
];

function parseLevel(line) {
  if (/\[ERROR\]|ERROR:|mysqld.*\[ERROR\]|\bERROR\b/i.test(line) ||
      /sshd.*failed password/i.test(line)) return 'ERROR';
  if (/\[WARN\]|WARNING|WARN:/i.test(line))  return 'WARN';
  if (/\[INFO\]|INFO:/i.test(line))           return 'INFO';
  if (/\[DEBUG\]|DEBUG:/i.test(line))         return 'DEBUG';
  if (/\[CRIT\]|CRIT:/i.test(line))           return 'CRIT';
  if (/ALERT.*CRITICAL|DOWN;HARD/i.test(line)) return 'CRIT';
  if (/ALERT.*WARNING/i.test(line))            return 'WARN';
  if (/ALERT.*OK|RECOVERY/i.test(line))        return 'INFO';
  return 'INFO';
}

function parseTime(line) {
  let m;
  m = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2})/);
  if (m) return m[1].replace('T', ' ');
  m = line.match(/\[(\d{10})\]/);
  if (m) return new Date(parseInt(m[1]) * 1000).toISOString().slice(0, 16).replace('T', ' ');
  m = line.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+\s+\d{2}:\d{2}/i);
  if (m) return m[0];
  return null;
}

function extractMsg(line) {
  return line
    .replace(/^\[?\d{10}\]?\s*/, '')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}\s*/, '')
    .replace(/\[(ERROR|WARN|INFO|DEBUG|CRIT)\]\s*/i, '')
    .trim() || line;
}

function matchPatterns(line) {
  return PUPPET_PATTERNS
    .filter(p => p.re.test(line))
    .map(p => ({ label: p.label, sev: p.sev }));
}

function analyzeLog(raw) {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  const entries = lines.map(line => ({
    raw:      line,
    level:    parseLevel(line),
    time:     parseTime(line),
    msg:      extractMsg(line),
    signals:  matchPatterns(line),
  }));

  // Counts
  const counts = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, CRIT: 0 };
  entries.forEach(e => { counts[e.level] = (counts[e.level] || 0) + 1; });

  // Pattern frequency
  const patternFreq = {};
  entries.forEach(e =>
    e.signals.forEach(s => { patternFreq[s.label] = (patternFreq[s.label] || 0) + 1; })
  );
  const topPatterns = Object.entries(patternFreq)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));

  // Timeline (group by minute)
  const timeline = {};
  entries.forEach(e => {
    if (!e.time) return;
    const key = e.time.slice(0, 16);
    if (!timeline[key]) timeline[key] = { total: 0, errors: 0 };
    timeline[key].total++;
    if (e.level === 'ERROR' || e.level === 'CRIT') timeline[key].errors++;
  });

  // Puppet-specific stats
  const puppetLines    = entries.filter(e => /puppet/i.test(e.raw));
  const catalogLines   = puppetLines.filter(e => /catalog/i.test(e.raw));
  const sslLines       = puppetLines.filter(e => /ssl|certificate/i.test(e.raw));
  const runFinished    = puppetLines.filter(e => /finished catalog run/i.test(e.raw));
  const lastRunTime    = runFinished.length
    ? (runFinished[runFinished.length - 1].raw.match(/(\d+\.\d+) seconds/) || [])[1]
    : null;

  return {
    total:        entries.length,
    counts,
    entries,
    topPatterns,
    timeline:     Object.entries(timeline).sort((a, b) => (a[0] > b[0] ? 1 : -1))
                    .map(([minute, v]) => ({ minute, ...v })),
    puppet: {
      totalLines:   puppetLines.length,
      catalogLines: catalogLines.length,
      sslIssues:    sslLines.length,
      lastRunTime:  lastRunTime ? parseFloat(lastRunTime) : null,
      runsCompleted: runFinished.length,
    },
  };
}

module.exports = { analyzeLog };
