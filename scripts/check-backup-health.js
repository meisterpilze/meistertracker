#!/usr/bin/env node
// Monitor script — verifies the daily backup ran recently and that the most
// recent file on disk is intact. Exits 0 on OK, 1 on degraded, 2 on critical.
//
// Intended to be run by any external monitor (Windows Task Scheduler, cron,
// PM2 cron_restart, GitHub Action, UptimeRobot via /api/health, etc.).
// Prints a human-readable report on stdout and a one-line summary at the end.
//
// Recognises two filename prefixes:
//   - meisterpilze_backup_YYYY-MM-DD.db   (auto-backups, written by server.js)
//   - meistertracker_*.db                  (manual backups, written by
//     update_server.sh / START.bat). R-04 — earlier versions of this script
//     ignored manual backups entirely and reported "no valid backups" when
//     30 manual files were present.
//
// Exit codes:
//   0 = healthy
//   1 = degraded (auto stale but manual fresh, or off-site marker stale)
//   2 = critical (no backups of any kind, or auto + manual both stale,
//                 or latest file corrupt)
//
// Usage:
//   node scripts/check-backup-health.js
//   node scripts/check-backup-health.js --backup-dir <path> \
//                                       [--max-age-hours 26] \
//                                       [--max-manual-age-hours 168] \
//                                       [--max-offsite-age-hours 26]

const fs = require('fs');
const path = require('path');
const { BACKUP_PREFIX } = require('./rotate-backups.js');

const AUTO_BACKUP_PREFIX = BACKUP_PREFIX;
const MANUAL_BACKUP_PREFIX = 'meistertracker_';

function parseArgs(argv) {
  const out = {
    maxAgeHours: 26, // auto-backups
    maxManualAgeHours: 168, // 7 days
    maxOffsiteAgeHours: 26
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--backup-dir' && argv[i + 1]) {
      out.backupDir = argv[++i];
    } else if (argv[i] === '--max-age-hours' && argv[i + 1]) {
      out.maxAgeHours = Number(argv[++i]);
    } else if (argv[i] === '--max-manual-age-hours' && argv[i + 1]) {
      out.maxManualAgeHours = Number(argv[++i]);
    } else if (argv[i] === '--max-offsite-age-hours' && argv[i + 1]) {
      out.maxOffsiteAgeHours = Number(argv[++i]);
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      out.help = true;
    }
  }
  return out;
}

function printUsage() {
  process.stdout.write(
    [
      'Usage: node scripts/check-backup-health.js [options]',
      '',
      'Options:',
      '  --backup-dir <path>            Path to backups directory (default: ./backups)',
      '  --max-age-hours <n>            Max age of newest auto-backup (default: 26)',
      '  --max-manual-age-hours <n>     Max age of newest manual backup (default: 168)',
      '  --max-offsite-age-hours <n>    Max age of off-site sync marker (default: 26)',
      '  -h, --help                     Show this help',
      '',
      'Exit codes:',
      '  0 = healthy',
      '  1 = degraded (auto stale, manual fresh / off-site marker stale)',
      '  2 = critical (no backups at all / latest file corrupt)',
      ''
    ].join('\n')
  );
}

const args = parseArgs(process.argv);
if (args.help) {
  printUsage();
  process.exit(0);
}

const projectRoot = path.resolve(__dirname, '..');
const backupDir = args.backupDir || path.join(projectRoot, 'backups');
const statusFile = path.join(backupDir, '.backup-status.json');
const offsiteFile = path.join(backupDir, '.offsite-sync.json');

const critical = []; // exit code 2
const degraded = []; // exit code 1
const info = [];

function sectionHeader(title) {
  process.stdout.write('\n=== ' + title + ' ===\n');
}

function line(msg) {
  process.stdout.write(msg + '\n');
}

function sqliteHeaderOk(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    return header.toString('utf8', 0, 15) === 'SQLite format 3';
  } catch (_) {
    return false;
  }
}

function statBackups(prefix, files) {
  const stats = files
    .filter((f) => f.startsWith(prefix))
    .map((f) => {
      const full = path.join(backupDir, f);
      try {
        const st = fs.statSync(full);
        return { file: f, full, mtimeMs: st.mtimeMs, size: st.size };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats;
}

sectionHeader('Meistertracker Backup Health Check');
line('Backup dir:                      ' + backupDir);
line('Max auto-backup age (hours):     ' + args.maxAgeHours);
line('Max manual-backup age (hours):   ' + args.maxManualAgeHours);
line('Max off-site marker age (hours): ' + args.maxOffsiteAgeHours);
line('Check time:                      ' + new Date().toISOString());

if (!fs.existsSync(backupDir)) {
  critical.push('Backup directory does not exist: ' + backupDir);
} else {
  let files = [];
  try {
    files = fs
      .readdirSync(backupDir)
      .filter((f) => f.endsWith('.db') && (f.startsWith(AUTO_BACKUP_PREFIX) || f.startsWith(MANUAL_BACKUP_PREFIX)));
  } catch (e) {
    critical.push('Could not list backup directory: ' + e.message);
  }

  const auto = statBackups(AUTO_BACKUP_PREFIX, files);
  const manual = statBackups(MANUAL_BACKUP_PREFIX, files);

  sectionHeader('Backup files');
  function ageDescription(stats) {
    if (stats.length === 0) return 'none';
    const newestAgeH = (Date.now() - stats[0].mtimeMs) / 3600000;
    const oldestAgeH = (Date.now() - stats[stats.length - 1].mtimeMs) / 3600000;
    return stats.length + ' files, newest ' + formatAge(newestAgeH) + ' ago, oldest ' + formatAge(oldestAgeH) + ' ago';
  }
  line('Auto-backups (' + AUTO_BACKUP_PREFIX + '*):    ' + ageDescription(auto));
  line('Manual backups (' + MANUAL_BACKUP_PREFIX + '*): ' + ageDescription(manual));

  // Auto-backup freshness
  let autoStale = false;
  let autoCorrupt = false;
  if (auto.length === 0) {
    // No autos at all is degraded if manual is fresh, critical otherwise.
    autoStale = true;
  } else {
    const latest = auto[0];
    const ageHours = (Date.now() - latest.mtimeMs) / 3600000;
    sectionHeader('Latest auto-backup');
    line('File:        ' + latest.file);
    line('mtime:       ' + new Date(latest.mtimeMs).toISOString());
    line('Age (hours): ' + ageHours.toFixed(1));
    line('Size:        ' + latest.size + ' bytes');

    if (ageHours > args.maxAgeHours) {
      autoStale = true;
    } else {
      info.push('Latest auto-backup is ' + ageHours.toFixed(1) + 'h old — within window');
    }
    if (latest.size < 1024) {
      autoCorrupt = true;
      critical.push('Latest auto-backup is suspiciously small: ' + latest.size + ' bytes');
    }
    if (!sqliteHeaderOk(latest.full)) {
      autoCorrupt = true;
      critical.push('Latest auto-backup missing SQLite magic header (corrupt?): ' + latest.file);
    } else if (!autoCorrupt) {
      info.push('Latest auto-backup has valid SQLite magic header');
    }
  }

  // Manual-backup freshness
  let manualFresh = false;
  if (manual.length > 0) {
    const latest = manual[0];
    const ageHours = (Date.now() - latest.mtimeMs) / 3600000;
    if (ageHours <= args.maxManualAgeHours) {
      manualFresh = true;
      info.push('Latest manual backup (' + latest.file + ') is ' + ageHours.toFixed(1) + 'h old — fresh');
    } else {
      info.push('Latest manual backup (' + latest.file + ') is ' + ageHours.toFixed(1) + 'h old — beyond window');
    }
  }

  // Combine: auto stale + no manual = critical, auto stale + manual fresh = degraded
  if (auto.length === 0 && manual.length === 0) {
    critical.push('No auto- or manual-backups found in ' + backupDir);
  } else if (autoStale) {
    if (manualFresh) {
      degraded.push('Auto-backup is stale but a fresh manual backup exists — auto-backup loop may be broken');
    } else {
      critical.push('Auto-backup is stale and no fresh manual backup — backups are NOT running');
    }
  }

  // Status file
  sectionHeader('Backup status file');
  if (!fs.existsSync(statusFile)) {
    info.push('No .backup-status.json yet — will be created on next scheduled run');
    line('(status file not present — ok on a fresh install)');
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      line('lastAttempt:  ' + JSON.stringify(parsed.lastAttempt || null));
      line('lastSuccess:  ' + JSON.stringify(parsed.lastSuccess || null));
      line('lastFailure:  ' + JSON.stringify(parsed.lastFailure || null));

      if (parsed.lastAttempt && parsed.lastAttempt.success === false) {
        critical.push(
          'Most recent backup attempt FAILED at ' +
            parsed.lastAttempt.time +
            (parsed.lastFailure ? ' — ' + parsed.lastFailure.error : '')
        );
      }
      if (parsed.lastSuccess && parsed.lastSuccess.time) {
        const ageH = (Date.now() - new Date(parsed.lastSuccess.time).getTime()) / 3600000;
        line('Last success age (hours): ' + ageH.toFixed(1));
        if (ageH > args.maxAgeHours) {
          critical.push('Last recorded success was ' + ageH.toFixed(1) + 'h ago (> max ' + args.maxAgeHours + 'h)');
        }
      } else if (fs.existsSync(statusFile)) {
        degraded.push('Status file has no lastSuccess entry');
      }
    } catch (e) {
      critical.push('Could not parse .backup-status.json: ' + e.message);
    }
  }

  // Off-site sync marker (R-06)
  sectionHeader('Off-site sync');
  if (!fs.existsSync(offsiteFile)) {
    degraded.push('No .offsite-sync.json — off-site backup may not be configured (see DEPLOYMENT.md)');
    line('(no marker yet)');
  } else {
    try {
      const parsed = JSON.parse(fs.readFileSync(offsiteFile, 'utf8'));
      line('Last sync:    ' + (parsed.time || 'n/a'));
      line('Bytes:        ' + (parsed.bytes != null ? parsed.bytes : 'n/a'));
      line('Target:       ' + (parsed.target || 'n/a'));
      if (parsed.time) {
        const ageH = (Date.now() - new Date(parsed.time).getTime()) / 3600000;
        line('Age (hours):  ' + ageH.toFixed(1));
        if (ageH > args.maxOffsiteAgeHours) {
          degraded.push(
            'Off-site backup marker is ' + ageH.toFixed(1) + 'h old (> max ' + args.maxOffsiteAgeHours + 'h)'
          );
        } else {
          info.push('Off-site marker is ' + ageH.toFixed(1) + 'h old — within window');
        }
      }
    } catch (e) {
      degraded.push('Could not parse .offsite-sync.json: ' + e.message);
    }
  }
}

function formatAge(ageHours) {
  if (ageHours < 1) return Math.round(ageHours * 60) + 'm';
  if (ageHours < 24) return ageHours.toFixed(1) + 'h';
  return (ageHours / 24).toFixed(1) + 'd';
}

sectionHeader('Summary');
info.forEach((i) => line('  OK:       ' + i));
degraded.forEach((d) => line('  DEGRADED: ' + d));
critical.forEach((c) => line('  CRITICAL: ' + c));
line('');
if (critical.length > 0) {
  line('RESULT: ' + critical.length + ' critical problem(s) — exit 2');
  process.exit(2);
} else if (degraded.length > 0) {
  line('RESULT: ' + degraded.length + ' degraded condition(s) — exit 1');
  process.exit(1);
} else {
  line('RESULT: backup healthy — exit 0');
  process.exit(0);
}
