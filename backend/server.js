const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { analyzeLog } = require('./analyzer');
const { checkAlerts } = require('./alerts');

const app = express();
const PORT = process.env.PORT || 3000;
const LOG_DIR = process.env.LOG_DIR || '/var/log/puppet';

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// POST /api/analyze — analyze pasted or uploaded logs
app.post('/api/analyze', (req, res) => {
  const { logs } = req.body;
  if (!logs || typeof logs !== 'string') {
    return res.status(400).json({ error: 'Missing logs field' });
  }
  const result = analyzeLog(logs);
  const alerts = checkAlerts(result);
  res.json({ ...result, alerts });
});

// GET /api/logs — read log files from mounted log directory
app.get('/api/logs', (req, res) => {
  const file = req.query.file || 'puppet.log';
  const logPath = path.join(LOG_DIR, path.basename(file));
  if (!fs.existsSync(logPath)) {
    return res.status(404).json({ error: `Log file not found: ${file}` });
  }
  const raw = fs.readFileSync(logPath, 'utf8');
  const result = analyzeLog(raw);
  const alerts = checkAlerts(result);
  res.json({ file, ...result, alerts });
});

// GET /api/logs/list — list available log files
app.get('/api/logs/list', (req, res) => {
  if (!fs.existsSync(LOG_DIR)) {
    return res.json({ files: [] });
  }
  const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log'));
  res.json({ files });
});

// GET /api/health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Log Analyzer API running on port ${PORT}`);
});
