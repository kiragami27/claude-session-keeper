const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVICE_NAME = 'claude-session-keeper';
const PLIST_LABEL = `com.${SERVICE_NAME}`;

function getBinPath() {
  // Resolve the actual installed binary path
  try {
    return execSync(`which ${SERVICE_NAME}`, { encoding: 'utf8' }).trim();
  } catch {
    return process.argv[1];
  }
}

// ─── Linux: systemd user service (no sudo needed) ────────────────────────────

function installSystemd(log) {
  const binPath = getBinPath();
  const nodePath = process.execPath;
  const serviceDir = path.join(os.homedir(), '.config/systemd/user');
  const servicePath = path.join(serviceDir, `${SERVICE_NAME}.service`);
  const logDir = path.join(os.homedir(), `.${SERVICE_NAME}`);

  fs.mkdirSync(serviceDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const unit = `[Unit]
Description=Claude Session Keeper — auto-ping on 5h reset
After=default.target

[Service]
Type=simple
ExecStart=${nodePath} ${binPath} start
Restart=on-failure
RestartSec=15
Environment=HOME=${os.homedir()}
StandardOutput=append:${logDir}/keeper.log
StandardError=append:${logDir}/keeper.log

[Install]
WantedBy=default.target
`;

  fs.writeFileSync(servicePath, unit);
  execSync('systemctl --user daemon-reload');
  execSync(`systemctl --user enable ${SERVICE_NAME}`);
  execSync(`systemctl --user start ${SERVICE_NAME}`);

  log.info(`Service file: ${servicePath}`);
  log.info(`Logs:         journalctl --user -u ${SERVICE_NAME} -f`);
  log.info(`Status:       systemctl --user status ${SERVICE_NAME}`);
}

function uninstallSystemd(log) {
  try { execSync(`systemctl --user stop ${SERVICE_NAME}`); } catch {}
  try { execSync(`systemctl --user disable ${SERVICE_NAME}`); } catch {}

  const servicePath = path.join(
    os.homedir(), `.config/systemd/user/${SERVICE_NAME}.service`
  );
  if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath);
  try { execSync('systemctl --user daemon-reload'); } catch {}

  log.info('systemd service removed.');
}

// ─── macOS: launchd agent ─────────────────────────────────────────────────────

function installLaunchd(log) {
  const binPath = getBinPath();
  const nodePath = process.execPath;
  const plistDir = path.join(os.homedir(), 'Library/LaunchAgents');
  const plistPath = path.join(plistDir, `${PLIST_LABEL}.plist`);
  const logFile = path.join(os.homedir(), `.${SERVICE_NAME}/keeper.log`);

  fs.mkdirSync(plistDir, { recursive: true });
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${binPath}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${logFile}</string>
</dict>
</plist>`;

  fs.writeFileSync(plistPath, plist);
  try { execSync(`launchctl unload ${plistPath} 2>/dev/null`); } catch {}
  execSync(`launchctl load -w ${plistPath}`);

  log.info(`Plist:  ${plistPath}`);
  log.info(`Logs:   tail -f ${logFile}`);
  log.info(`Status: launchctl list | grep ${PLIST_LABEL}`);
}

function uninstallLaunchd(log) {
  const plistPath = path.join(
    os.homedir(), `Library/LaunchAgents/${PLIST_LABEL}.plist`
  );
  if (fs.existsSync(plistPath)) {
    try { execSync(`launchctl unload ${plistPath}`); } catch {}
    fs.unlinkSync(plistPath);
  }
  log.info('launchd agent removed.');
}

// ─── Public ───────────────────────────────────────────────────────────────────

function install(log) {
  const p = process.platform;
  if (p === 'linux') {
    installSystemd(log);
  } else if (p === 'darwin') {
    installLaunchd(log);
  } else {
    log.warn('Auto-install is not supported on Windows.');
    log.warn('Use pm2 instead:');
    console.log('\n  npm install -g pm2');
    console.log('  pm2 start "csk start" --name claude-session-keeper');
    console.log('  pm2 save');
    console.log('  pm2 startup   # follow the printed instructions\n');
    return false;
  }
  return true;
}

function uninstall(log) {
  const p = process.platform;
  if (p === 'linux') uninstallSystemd(log);
  else if (p === 'darwin') uninstallLaunchd(log);
  else log.warn('Nothing to uninstall on Windows (remove from pm2 manually).');
}

module.exports = { install, uninstall };
