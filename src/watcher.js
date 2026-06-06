const chokidar = require('chokidar');

class ClaudeActivityWatcher {
  constructor(claudeDir, onActivity) {
    this.claudeDir = claudeDir;
    this.onActivity = onActivity;
    this._watcher = null;
  }

  start() {
    this._watcher = chokidar.watch(this.claudeDir, {
      persistent: true,
      ignoreInitial: true,
      // Only care about conversation files written by claude CLI
      ignored: (p) => {
        const base = require('path').basename(p);
        // Watch .jsonl (conversations) and ignore everything else heavy
        return base.startsWith('.') && base !== '.claude';
      },
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      depth: 5,
    });

    this._watcher.on('add', (p) => this._handle(p));
    this._watcher.on('change', (p) => this._handle(p));
  }

  _handle(filePath) {
    if (filePath.endsWith('.jsonl') || filePath.endsWith('.json')) {
      this.onActivity(filePath);
    }
  }

  stop() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
  }
}

module.exports = { ClaudeActivityWatcher };
