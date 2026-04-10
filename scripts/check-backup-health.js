#!/usr/bin/env node
// Monitor script — verifies the daily backup ran recently and that the most
// recent file on disk is intact. Exits 0 on OK, 1 on problems.
//
// Intended to be run by any external monitor (Windows Task Scheduler, cron,
// PM2 cron_restart, GitHub Action, UptimeRobot via /api/health, etc.).
// Prints a human-readable report on stdout and a one-line summary at the end.
//
// Usage:
//   node scripts/check-backup-health.js              # uses ./backups and ./meistertracker.db
//   node scripts/check-backup-health.js --backup-dir <path> [--max-age-hours 26]

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { maxAgeHours: 26 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--backup-dir' && argv[i + 1]) {
      out.backupDir = argv[++i];
    } else if (argv[i] === '--max-age-hours' && argv[i + 1]) {
      out.maxAgeHours = Number(argv[++i]);
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
      '  --backup-dir <path>      Path to backups directory (default: ./backups)',
      '  --max-age-hours <n>      Fail if latest backup older than this (default: 26)',
      '  -h, --help               Show this help',
      ''
    ].join('\n')
  );
}

const args = parseArgs(process.argv);
if (args.help) {
  printUsage();
  process.exit(0);
}

// Default: project root is two levels up from this file (scripts/ -> project root).
const projectRoot = path.resolve(__dirname, '..');
const backupDir = args.backupDir || path.join(projectRoot, 'backups');
const statusFile = path.join(backupDir, '.backup-status.json');

const problems = [];
const info = [];

function sectionHeader(title) {
  process.stdout.write('\n=== ' + title + ' ===\n');
}

function line(msg) {
  process.stdout.write(msg + '\n');
}

sectionHeader('Meistertracker Backup Health Check');
line('Backup dir:     ' + backupDir);
line('Max age hours:  ' + args.maxAgeHours);
line('Check time:     ' + new Date().toISOString());

// 1. Backup directory must exist
if (!fs.existsSync(backupDir)) {
  problems.push('Backup directory does not exist: ' + backupDir);
} else {
  // 2. Must contain at least one .db file
  let files = [];
  try {
    files = fs
      .readdirSync(backupDir)
      .filter((f) => f.endsWith('.db') && f.startsWith('meisterpilze_backup_'))
      .sort();
  } catch (e) {
    problems.push('Could not list backup directory: ' + e.message);
  }

  if (files.length === 0) {
    problems.push('No meisterpilze_backup_*.db files found in backup directory');
  } else {
    sectionHeader('Backup files on disk');
    line('Total daily backups: ' + files.length);
    const latest = files[files.length - 1];
    const latestPath = path.join(backupDir, latest);
    let stat;
    try {
      stat = fs.statSync(latestPath);
    } catch (e) {
      problems.push('Could not stat latest backup: ' + e.message);
    }
    if (stat) {
      const ageMs = Date.now() - stat.mtimeMs;
      const ageHours = ageMs / 3600000;
      line('Latest file:         ' + latest);
      line('Latest mtime:        ' + stat.mtime.toISOString());
      line('Latest age (hours):  ' + ageHours.toFixed(1));
      line('Latest size (bytes): ' + stat.size);

      if (ageHours > args.maxAgeHours) {
        problems.push('Latest backup is ' + ageHours.toFixed(1) + 'h old (> max ' + args.maxAgeHours + 'h)');
      } else {
        info.push('Latest backup is ' + ageHours.toFixed(1) + 'h old — within window');
      }

      if (stat.size < 1024) {
        problems.push('Latest backup is suspiciously small: ' + stat.size + ' bytes');
      }

      // Check SQLite magic header on the latest file
      try {
        const fd = fs.openSync(latestPath, 'r');
        const header = Buffer.alloc(16);
        fs.readSync(fd, header, 0, 16, 0);
        fs.closeSync(fd);
        if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
          problems.push('Latest backup missing SQLite magic header (corrupt?)');
        } else {
          info.push('Latest backup has valid SQLite magic header');
        }
      } catch (e) {
        problems.push('Could not read latest backup header: ' + e.message);
      }
    }
  }

  // 3. Read .backup-status.json if present (written by server.js runDailyBackup)
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
        problems.push(
          'Most recent backup attempt FAILED at ' +
            parsed.lastAttempt.time +
            (parsed.lastFailure ? ' — ' + parsed.lastFailure.error : '')
        );
      }
      if (parsed.lastSuccess && parsed.lastSuccess.time) {
        const ageH = (Date.now() - new Date(parsed.lastSuccess.time).getTime()) / 3600000;
        line('Last success age (hours): ' + ageH.toFixed(1));
        if (ageH > args.maxAgeHours) {
          problems.push('Last recorded success was ' + ageH.toFixed(1) + 'h ago (> max ' + args.maxAgeHours + 'h)');
        }
      } else if (fs.existsSync(statusFile)) {
        problems.push('Status file has no lastSuccess entry');
      }
    } catch (e) {
      problems.push('Could not parse .backup-status.json: ' + e.message);
    }
  }
}

// 4. Summary
sectionHeader('Summary');
info.forEach((i) => line('  OK:   ' + i));
problems.forEach((p) => line('  FAIL: ' + p));
line('');
if (problems.length === 0) {
  line('RESULT: backup healthy');
  process.exit(0);
} else {
  line('RESULT: ' + problems.length + ' problem(s) detected');
  process.exit(1);
}
