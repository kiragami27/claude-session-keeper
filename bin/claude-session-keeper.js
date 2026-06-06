#!/usr/bin/env node

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const { loadConfig, parseDuration, formatDuration, STATE_DIR } = require('../src/config');
const { SessionKeeper } = require('../src/keeper');
const { install, uninstall } = require('../src/service');

const pkg = require('../package.json');

// ─── Logger ──────────────────────────────────────────────────────────────────

function makeLogger(toFile = false) {
  const logPath = path.join(STATE_DIR, 'keeper.log');
  const ts = () => new Date().toLocaleTimeString();

  function write(level, color, m) {
    const line = `[${new Date().toISOString()}] ${level.padEnd(5)} ${m}`;
    if (toFile) {
      try { fs.appendFileSync(logPath, line + '\n'); } catch {}
    }
    const tty = `\x1b[${color}m[${ts()}]${level === 'INFO' ? '' : ` ${level}`}\x1b[0m ${m}`;
    if (level === 'ERROR') console.error(tty); else console.log(tty);
  }

  return {
    info:  (m) => write('INFO',  '32', m),
    warn:  (m) => write('WARN',  '33', m),
    error: (m) => write('ERROR', '31', m),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCompoundDuration(str) {
  // Accepts: "1h30m", "45m", "2h", "90m", "1h 30m"
  const clean = str.replace(/\s+/g, '');
  return parseDuration(clean);
}

function makeKeeper(opts, fileLog = false) {
  const logger = makeLogger(fileLog);
  const config = loadConfig(opts.config);
  return { keeper: new SessionKeeper(config, logger), logger, config };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

program
  .name('claude-session-keeper')
  .alias('csk')
  .version(pkg.version)
  .description(
    'Automatically ping Claude Code when your 5-hour session resets\n' +
    'to prevent session drift and maximise your usage window.'
  );

// ── start ────────────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Start the daemon: watch for Claude activity and auto-ping on reset')
  .option('-c, --config <path>', 'Path to config.yml')
  .option('--log-file', 'Also write logs to ~/.claude-session-keeper/keeper.log')
  .action(async (opts) => {
    const { keeper } = makeKeeper(opts, opts.logFile);

    process.on('SIGINT',  () => { keeper.stop(); process.exit(0); });
    process.on('SIGTERM', () => { keeper.stop(); process.exit(0); });

    await keeper.start();

    // Keep process alive
    process.stdin.resume();
  });

// ── status ───────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show current session and next scheduled ping')
  .option('-c, --config <path>', 'Path to config.yml')
  .action((opts) => {
    const { keeper } = makeKeeper(opts);
    const s = keeper.status();
    const now = new Date();

    const line = (label, value) =>
      console.log(`  ${label.padEnd(20)} ${value}`);

    console.log('\n  \x1b[1mClaude Session Keeper\x1b[0m\n');

    line('Session started:', s.sessionStartedAt
      ? s.sessionStartedAt.toLocaleString()
      : 'not detected yet');

    line('Last activity:', s.lastActivityAt
      ? `${s.lastActivityAt.toLocaleString()} (${formatDuration(now - s.lastActivityAt)} ago)`
      : 'none');

    line('Last ping sent:', s.lastPingSentAt
      ? `${s.lastPingSentAt.toLocaleString()} (${formatDuration(now - s.lastPingSentAt)} ago)`
      : 'none');

    if (s.nextPingAt) {
      const remaining = s.nextPingAt - now;
      line('Next ping:', `${s.nextPingAt.toLocaleString()} (in ${formatDuration(remaining)})`);
    } else {
      line('Next ping:', 'not scheduled (start the daemon or use ping-in)');
    }

    console.log();
  });

// ── ping ─────────────────────────────────────────────────────────────────────
program
  .command('ping')
  .description('Send a ping to Claude Code immediately (starts a new 5-hour window now)')
  .option('-c, --config <path>', 'Path to config.yml')
  .action(async (opts) => {
    const { keeper } = makeKeeper(opts);
    keeper._ensureStateDir();
    const ok = await keeper.ping();
    process.exit(ok ? 0 : 1);
  });

// ── ping-in ──────────────────────────────────────────────────────────────────
program
  .command('ping-in <duration>')
  .description(
    'Wait then ping. Use when Claude tells you your session resets in X.\n' +
    '  Examples:  csk ping-in 1h23m\n' +
    '             csk ping-in 45m\n' +
    '             csk ping-in 2h\n\n' +
    '  Tip: run in background with:  nohup csk ping-in 1h23m &'
  )
  .option('-c, --config <path>', 'Path to config.yml')
  .action(async (duration, opts) => {
    let ms;
    try {
      ms = parseCompoundDuration(duration);
    } catch (e) {
      console.error(`\x1b[31mError:\x1b[0m ${e.message}`);
      process.exit(1);
    }

    const { keeper } = makeKeeper(opts);
    keeper._ensureStateDir();
    const ok = await keeper.pingAfter(ms);
    process.exit(ok ? 0 : 1);
  });

// ── install ───────────────────────────────────────────────────────────────────
program
  .command('install')
  .description(
    'Register as a system service so it starts at login and restarts automatically\n' +
    '  Linux  → systemd user service  (no sudo needed)\n' +
    '  macOS  → launchd agent\n' +
    '  Other  → prints pm2 instructions'
  )
  .action(() => {
    const { logger } = makeKeeper({ config: undefined });
    const ok = install(logger);
    if (ok) {
      logger.info(`\n✓ claude-session-keeper is now running in the background.`);
      logger.info(`  It will start automatically at every login.`);
    }
  });

// ── uninstall ─────────────────────────────────────────────────────────────────
program
  .command('uninstall')
  .description('Remove the system service installed by "install"')
  .action(() => {
    const { logger } = makeKeeper({ config: undefined });
    uninstall(logger);
  });

// ── logs ──────────────────────────────────────────────────────────────────────
program
  .command('logs')
  .description('Tail the keeper log file (~/.claude-session-keeper/keeper.log)')
  .action(() => {
    const logPath = path.join(STATE_DIR, 'keeper.log');
    if (!fs.existsSync(logPath)) {
      console.log(`No log file yet at ${logPath}`);
      console.log('Start the keeper with: csk start --log-file');
      process.exit(0);
    }
    const { spawnSync } = require('child_process');
    spawnSync('tail', ['-f', logPath], { stdio: 'inherit' });
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
