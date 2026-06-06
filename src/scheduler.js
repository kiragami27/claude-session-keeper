class Scheduler {
  constructor() {
    this._timer = null;
    this._firedAt = null;
    this.nextPingAt = null;
  }

  scheduleAt(time, callback) {
    this.cancel();
    const delay = Math.max(0, time - Date.now());
    this.nextPingAt = new Date(time);
    this._timer = setTimeout(() => {
      this._firedAt = new Date();
      this._timer = null;
      this.nextPingAt = null;
      callback();
    }, delay);
    // Prevent the timer from blocking process exit when used standalone
    if (this._timer.unref) this._timer.unref();
    return delay;
  }

  // Re-ref the timer so the process stays alive (used in daemon mode)
  keepAlive() {
    if (this._timer && this._timer.ref) this._timer.ref();
  }

  cancel() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
      this.nextPingAt = null;
    }
  }

  get isScheduled() {
    return this._timer !== null;
  }
}

module.exports = { Scheduler };
