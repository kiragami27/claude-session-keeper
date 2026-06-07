const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { ClaudeActivityWatcher } = require('./watcher');
const { Scheduler } = require('./scheduler');
const { formatDuration } = require('./config');

class SessionKeeper {
  constructor(config, logger) {
    this.config = config;
    this.log = logger;
    this.scheduler = new Scheduler();
    this._watcher = null;
    this._state = {
      sessionStartedAt: null,
      nextPingAt: null,
      lastPingSentAt: null,
      lastActivityAt: null,
    };
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async start() {
    this._ensureStateDir();
    this._loadState();

    // Reschedule any pending ping from a previous run
    if (this._state.nextPingAt) {
      const t = new Date(this._state.nextPingAt);
      if (t <= new Date()) {
        this.log.warn('Missed a scheduled ping while offline — sending now');
        await this._sendPing();
      } else {
        this._doSchedule(new Date(this._state.sessionStartedAt));
        this.scheduler.keepAlive();
      }
    }

    // Watch ~/.claude for activity
    this._watcher = new ClaudeActivityWatcher(
      this.config.claudeDir,
      (f) => this._onActivity(f)
    );
    this._watcher.start();

    this.log.info(`Watching ${this.config.claudeDir} for Claude Code activity`);
    this.log.info('Session keeper running. Ctrl+C to stop.\n');
  }

  stop() {
    if (this._watcher) this._watcher.stop();
    this.scheduler.cancel();
    this.log.info('Stopped.');
  }

  // Immediately send a ping
  async ping() {
    return this._sendPing();
  }

  // Schedule a one-shot ping after `ms` milliseconds (standalone, no watcher needed)
  async pingAfter(ms) {
    const pingAt = new Date(Date.now() + ms);
    this.log.info(`Ping scheduled for ${pingAt.toLocaleString()} (in ${formatDuration(ms)})`);
    this.log.info('Waiting...');
    await new Promise((resolve) => setTimeout(resolve, ms));
    return this._sendPing();
  }

  status() {
    this._loadState();
    const s = this._state;
    return {
      sessionStartedAt: s.sessionStartedAt ? new Date(s.sessionStartedAt) : null,
      lastActivityAt: s.lastActivityAt ? new Date(s.lastActivityAt) : null,
      lastPingSentAt: s.lastPingSentAt ? new Date(s.lastPingSentAt) : null,
      nextPingAt: s.nextPingAt ? new Date(s.nextPingAt) : null,
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _onActivity(filePath) {
    const now = new Date();
    const lastActivity = this._state.lastActivityAt
      ? new Date(this._state.lastActivityAt)
      : null;

    this._state.lastActivityAt = now.toISOString();

    const gap = lastActivity ? now - lastActivity : Infinity;
    const isNewSession = gap > this.config.inactivityThreshold;

    if (isNewSession && !this.scheduler.isScheduled) {
      this._state.sessionStartedAt = now.toISOString();

      if (gap >= this.config.sessionDuration) {
        // Session already expired during the absence — ping immediately
        this.log.info(
          `Claude session already reset (inactive for ${formatDuration(gap)}) — pinging now`
        );
        this._sendPing();
      } else {
        this.log.info(`New Claude session detected`);
        this._doSchedule(now);
        this.scheduler.keepAlive();
      }
    }

    this._saveState();
  }

  _doSchedule(sessionStart) {
    const fireAt = new Date(
      sessionStart.getTime() + this.config.sessionDuration + this.config.pingDelay
    );
    this._state.nextPingAt = fireAt.toISOString();

    const delay = this.scheduler.scheduleAt(fireAt, () => this._sendPing());
    this.log.info(
      `Next ping → ${fireAt.toLocaleString()} (in ${formatDuration(delay)})`
    );
    this._saveState();
  }

  async _sendPing() {
    this.log.info('Sending session-reset ping to Claude Code…');

    const ok = await new Promise((resolve) => {
      const proc = spawn(this.config.claudeCommand, ['-p', this.config.pingPrompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout.on('data', () => {}); // drain
      proc.stderr.on('data', () => {});

      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', (err) => {
        this.log.error(`Cannot run "${this.config.claudeCommand}": ${err.message}`);
        resolve(false);
      });
    });

    if (ok) {
      this.log.info('✓ Ping sent. New 5-hour window has started.');
    } else {
      this.log.error('Ping failed. Check that the claude CLI is installed and authenticated.');
    }

    this._state.lastPingSentAt = new Date().toISOString();
    this._state.nextPingAt = null;
    // After a ping, reset session tracking so the watcher picks up the new session
    this._state.sessionStartedAt = null;
    this.scheduler.cancel();
    this._saveState();

    if (this.config.webhookUrl) this._webhook(ok);

    return ok;
  }

  _webhook(success) {
    try {
      const url = new URL(this.config.webhookUrl);
      const body = Buffer.from(JSON.stringify({
        event: 'claude_session_ping',
        success,
        timestamp: new Date().toISOString(),
        message: success
          ? 'Claude session keeper ping sent — new 5-hour window started'
          : 'Claude session keeper ping FAILED',
      }));
      const req = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
        },
      });
      req.on('error', () => {});
      req.write(body);
      req.end();
    } catch {
      // Best-effort
    }
  }

  _loadState() {
    const p = path.join(this.config.stateDir, 'state.json');
    if (fs.existsSync(p)) {
      try {
        this._state = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        this.log.warn('Could not read state file, starting fresh');
      }
    }
  }

  _saveState() {
    const p = path.join(this.config.stateDir, 'state.json');
    fs.writeFileSync(p, JSON.stringify(this._state, null, 2));
  }

  _ensureStateDir() {
    if (!fs.existsSync(this.config.stateDir)) {
      fs.mkdirSync(this.config.stateDir, { recursive: true });
    }
  }
}

module.exports = { SessionKeeper };
