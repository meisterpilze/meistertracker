/**
 * Watchdog — monitors /api/health and auto-reverts to last stable commit on
 * repeated failures. Designed to run as a separate PM2 process alongside the
 * main server.
 *
 * Environment variables:
 *   WATCHDOG_URL        — health endpoint (default: http://localhost:3000/api/health)
 *   WATCHDOG_INTERVAL   — check interval in seconds (default: 30)
 *   WATCHDOG_THRESHOLD  — consecutive failures before revert (default: 3)
 *   PM2_PROCESS_NAME    — PM2 process name to restart (default: meisterpilze)
 */

const http = require('http');
const https = require('https');
const { execSync } = require('child_process');
const path = require('path');

const HEALTH_URL = process.env.WATCHDOG_URL || 'http://localhost:3000/api/health';
const INTERVAL = parseInt(process.env.WATCHDOG_INTERVAL, 10) || 30;
const THRESHOLD = parseInt(process.env.WATCHDOG_THRESHOLD, 10) || 3;
const PM2_NAME = process.env.PM2_PROCESS_NAME || 'meisterpilze';
const PROJECT_DIR = path.resolve(__dirname);

let consecutiveFailures = 0;
let reverting = false;

function log(level, msg, extra) {
  const entry = { ts: new Date().toISOString(), level, msg, ...extra };
  console.log(JSON.stringify(entry));
}

function checkHealth() {
  return new Promise((resolve) => {
    const mod = HEALTH_URL.startsWith('https') ? https : http;
    const req = mod.get(HEALTH_URL, { timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          log('warn', 'Health check returned non-200', { statusCode: res.statusCode, body: body.slice(0, 200) });
          resolve(false);
        }
      });
    });
    req.on('error', (err) => {
      log('warn', 'Health check failed', { error: err.message });
      resolve(false);
    });
    req.on('timeout', () => {
      req.destroy();
      log('warn', 'Health check timed out');
      resolve(false);
    });
  });
}

function run(cmd, opts) {
  return execSync(cmd, { cwd: PROJECT_DIR, encoding: 'utf8', timeout: 30000, ...opts }).trim();
}

function getStableCommit() {
  try {
    return run('git rev-parse stable 2>/dev/null');
  } catch {
    return null;
  }
}

function getCurrentCommit() {
  try {
    return run('git rev-parse HEAD');
  } catch {
    return null;
  }
}

async function revertToStable() {
  if (reverting) return;
  reverting = true;

  const stable = getStableCommit();
  const current = getCurrentCommit();

  if (!stable) {
    log('error', 'No stable tag found — cannot revert. Manual intervention required.');
    reverting = false;
    return;
  }

  if (stable === current) {
    log('warn', 'Already on stable commit — restarting PM2 only');
    try {
      run(`pm2 restart ${PM2_NAME}`);
      log('info', 'PM2 process restarted');
    } catch (e) {
      log('error', 'Failed to restart PM2', { error: e.message });
    }
    reverting = false;
    return;
  }

  log('warn', 'Reverting to stable commit', { from: current.slice(0, 8), to: stable.slice(0, 8) });

  try {
    // Reset to the last known-good commit
    run(`git reset --hard ${stable}`);
    log('info', 'Git reset successful');

    // Reinstall dependencies (in case package.json changed)
    run('npm install --omit=dev', { timeout: 120000 });
    log('info', 'npm install completed');

    // Restart the server
    run(`pm2 restart ${PM2_NAME}`);
    log('info', 'PM2 process restarted after revert');

    // Wait and verify
    await new Promise((r) => setTimeout(r, 5000));
    const ok = await checkHealth();
    if (ok) {
      log('info', 'Server healthy after revert');
      consecutiveFailures = 0;
    } else {
      log('error', 'Server still unhealthy after revert to stable — manual intervention required');
    }
  } catch (e) {
    log('error', 'Revert failed', { error: e.message });
  }

  reverting = false;
}

async function tick() {
  if (reverting) return;

  const healthy = await checkHealth();

  if (healthy) {
    if (consecutiveFailures > 0) {
      log('info', 'Server recovered', { previousFailures: consecutiveFailures });
    }
    consecutiveFailures = 0;
    return;
  }

  consecutiveFailures++;
  log('warn', `Health check failure ${consecutiveFailures}/${THRESHOLD}`);

  if (consecutiveFailures >= THRESHOLD) {
    log('error', `${THRESHOLD} consecutive failures — initiating revert`);
    await revertToStable();
  }
}

// ── Main ─────────────────────────────────────────────────────
log('info', 'Watchdog started', {
  url: HEALTH_URL,
  interval: `${INTERVAL}s`,
  threshold: THRESHOLD,
  pm2Process: PM2_NAME
});

setInterval(tick, INTERVAL * 1000);

// Run first check after a short delay to let server boot
setTimeout(tick, 10000);
