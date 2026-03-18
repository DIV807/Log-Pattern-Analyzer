# Log Pattern Analyzer — DevOps Project
## Puppet / Monitoring | Intermediate Level

---

## Architecture

```
Puppet Nodes
  └── Filebeat (deployed via Puppet manifest)
        └── POST /api/analyze ──► Node.js Backend (Docker)
                                        │
                                        ├── analyzer.js  (pattern engine)
                                        ├── alerts.js    (threshold checks + Slack)
                                        └── /var/log/puppet (mounted volume)
                                                │
                                        Frontend (nginx + Docker)
                                          └── http://localhost:8080
```

---

## Quick Start

### 1. Clone / copy this project

```bash
git init log-analyzer && cd log-analyzer
# copy all files here
```

### 2. Copy your frontend HTML

```bash
cp /path/to/log_pattern_analyzer.html frontend/
```

### 3. Start with Docker Compose

```bash
docker-compose up --build -d
```

Open http://localhost:8080 in your browser.

---

## Environment Variables

Set these in `docker-compose.yml` under the `backend` service:

| Variable              | Default | Description                          |
|-----------------------|---------|--------------------------------------|
| `PORT`                | 3000    | API server port                      |
| `LOG_DIR`             | `/var/log/puppet` | Path to log files          |
| `ALERT_ERROR_COUNT`   | 5       | Error threshold for HIGH alert       |
| `ALERT_CRIT_COUNT`    | 1       | CRIT threshold for CRITICAL alert    |
| `ALERT_WARN_COUNT`    | 10      | Warning threshold for MEDIUM alert   |
| `ALERT_OOM_COUNT`     | 1       | OOM events before CRITICAL alert     |
| `ALERT_SSL_COUNT`     | 1       | SSL issues before HIGH alert         |
| `ALERT_CATALOG_COUNT` | 2       | Catalog failures before HIGH alert   |
| `SLACK_WEBHOOK_URL`   | (empty) | Slack webhook for CRITICAL alerts    |

---

## API Reference

### POST /api/analyze
Analyze a block of log text.

**Request:**
```json
{ "logs": "2024-03-10 08:01:12 [ERROR] Puppet: Could not retrieve catalog..." }
```

**Response:**
```json
{
  "total": 15,
  "counts": { "ERROR": 3, "WARN": 2, "INFO": 9, "DEBUG": 0, "CRIT": 1 },
  "topPatterns": [
    { "label": "Catalog error", "count": 3 }
  ],
  "timeline": [
    { "minute": "2024-03-10 08:01", "total": 7, "errors": 2 }
  ],
  "puppet": {
    "totalLines": 12,
    "catalogLines": 5,
    "sslIssues": 1,
    "lastRunTime": 13.22,
    "runsCompleted": 1
  },
  "alerts": [
    { "level": "CRITICAL", "message": "...", "rule": "transaction_abort" }
  ]
}
```

### GET /api/logs?file=puppet.log
Read and analyze a log file from the mounted log directory.

### GET /api/logs/list
List available log files in the log directory.

### GET /api/health
Health check endpoint.

---

## Puppet Filebeat Module

### Deploy to all nodes

```bash
# On Puppet master
cp -r puppet/modules/filebeat /etc/puppetlabs/code/environments/production/modules/
cp puppet/manifests/site.pp   /etc/puppetlabs/code/environments/production/manifests/

# Edit api_host in site.pp to point at your analyzer server
# Then trigger a Puppet run on agents:
puppet agent --test
```

### What it does
- Installs Filebeat package
- Deploys `/etc/filebeat/filebeat.yml` via ERB template
- Starts and enables the `filebeat` service
- Ships Puppet agent logs + Nagios/Icinga logs to the API

---

## Alert System

Alerts fire when thresholds are breached. Example alerts:

| Rule              | Level    | Trigger                             |
|-------------------|----------|-------------------------------------|
| `crit_count`      | CRITICAL | Any CRIT log found                  |
| `error_count`     | HIGH     | ≥5 errors in the log batch          |
| `oom_event`       | CRITICAL | Out-of-memory event detected        |
| `ssl_issues`      | HIGH     | SSL/certificate failure in Puppet   |
| `catalog_failure` | HIGH     | ≥2 catalog retrieval failures       |
| `transaction_abort`| CRITICAL | Puppet transaction aborted          |

### Slack Alerts
Set `SLACK_WEBHOOK_URL` in `docker-compose.yml`:

```yaml
environment:
  SLACK_WEBHOOK_URL: https://hooks.slack.com/services/T.../B.../xxx
```

CRITICAL alerts are automatically POSTed to your Slack channel.

---

## Stopping / Restarting

```bash
docker-compose down          # Stop containers
docker-compose up -d         # Start in background
docker-compose logs -f       # Follow logs
docker-compose restart backend  # Restart only API
```

---

## Project Structure

```
log-analyzer/
├── docker-compose.yml
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js      ← Express API
│   ├── analyzer.js    ← Pattern engine
│   └── alerts.js      ← Alert system + Slack
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── log_pattern_analyzer.html
└── puppet/
    ├── manifests/
    │   └── site.pp
    └── modules/
        └── filebeat/
            ├── manifests/
            │   └── init.pp
            └── templates/
                └── filebeat.yml.erb
```
