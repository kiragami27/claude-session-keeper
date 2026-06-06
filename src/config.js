const path = require('path');
const fs = require('fs');
const os = require('os');

let yaml;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

const STATE_DIR = path.join(os.homedir(), '.claude-session-keeper');

const DEFAULTS = {
  sessionDuration: 5 * 60 * 60 * 1000,    // 5 hours
  inactivityThreshold: 30 * 60 * 1000,    // 30 min gap = new session
  pingBuffer: 30 * 1000,                  // send ping 30s before reset
  claudeCommand: 'claude',
  pingPrompt: 'hi',
  claudeDir: path.join(os.homedir(), '.claude'),
  stateDir: STATE_DIR,
  webhookUrl: null,
};

function parseDuration(str) {
  if (typeof str === 'number') return str;
  const multipliers = { h: 3600000, m: 60000, s: 1000, ms: 1 };
  let ms = 0;
  const re = /(\d+(?:\.\d+)?)(h|m(?:s)?|s)/g;
  let match;
  let found = false;
  while ((match = re.exec(str)) !== null) {
    found = true;
    ms += parseFloat(match[1]) * (multipliers[match[2]] ?? 1000);
  }
  if (!found) throw new Error(`Invalid duration: "${str}". Use formats like 1h, 30m, 1h30m`);
  return ms;
}

function formatDuration(ms) {
  if (ms <= 0) return '0s';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !h) parts.push(`${s}s`);
  return parts.join(' ');
}

function loadConfig(configPath) {
  const filePath = configPath || path.join(STATE_DIR, 'config.yml');
  let overrides = {};

  if (fs.existsSync(filePath) && yaml) {
    try {
      const raw = yaml.load(fs.readFileSync(filePath, 'utf8')) || {};
      if (raw.sessionDuration) raw.sessionDuration = parseDuration(raw.sessionDuration);
      if (raw.inactivityThreshold) raw.inactivityThreshold = parseDuration(raw.inactivityThreshold);
      if (raw.pingBuffer) raw.pingBuffer = parseDuration(raw.pingBuffer);
      overrides = raw;
    } catch (e) {
      console.warn(`Warning: could not parse config file: ${e.message}`);
    }
  }

  return { ...DEFAULTS, ...overrides };
}

module.exports = { loadConfig, parseDuration, formatDuration, STATE_DIR };
