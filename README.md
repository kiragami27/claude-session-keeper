# claude-session-keeper

> Prevent session drift in Claude Code. Automatically ping Claude the moment your 5-hour window resets so your next window starts at the right time — not hours later.

[![npm version](https://img.shields.io/npm/v/claude-session-keeper.svg)](https://www.npmjs.com/package/claude-session-keeper)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## The problem

Claude Code has a rolling 5-hour usage window. The window starts when you send your **first message**, not when the previous one expires.

```
Hit limit at 10:00 → reset at 15:00 (5h later)
You come back at 17:00 → new window: 17:00–22:00
                         ↑ 2 hours wasted, and your cadence drifts further every cycle
```

## The solution

`claude-session-keeper` watches your `~/.claude` directory for activity, calculates exactly when your session will reset, and fires a `claude -p "hi"` ping at that moment — starting the new window immediately.

```
Hit limit at 10:00 → reset at 15:00
Auto-ping at 15:00 → new window: 15:00–20:00
You come back at 17:00 → 3h remaining, reset predictably at 20:00
```

---

## Installation

```bash
npm install -g claude-session-keeper
csk install
```

`csk install` registers a system service that starts at login and restarts automatically — **no VPS needed for laptop users**.

Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to be installed and authenticated.

---

## Deployment options

| Setup | How | Best for |
|-------|-----|----------|
| **Local machine** | `npm i -g claude-session-keeper && csk install` | Developers who always have their laptop on |
| **VPS / server** | Docker or systemd on a $5/mo VPS | Most reliable — always on, never misses a reset |
| **One-shot** | `nohup csk ping-in 1h23m &` | Quick fix when you know your exact reset time |

> **Laptop caveat**: if your machine is asleep when the reset fires, the ping will be sent as soon as it wakes up. A VPS eliminates this entirely.

---

## Usage

### 1. Install as a service (recommended)

```bash
npm install -g claude-session-keeper
csk install
```

That's it. The keeper now runs in the background, watches `~/.claude` for activity, and automatically pings Claude at the moment your session resets.

### 2. One-shot mode

When Claude Code tells you *"Your session resets in 1h 23m"*, run:

```bash
nohup csk ping-in 1h23m &
```

The process waits, sends the ping, and exits. No daemon or service needed.

### 3. Manual ping

Start a new 5-hour window right now:

```bash
csk ping
```

### Check status

```bash
csk status
```

### View logs

```bash
csk logs
```

---

## Commands

| Command | Description |
|---------|-------------|
| `csk install` | Register as a system service (Linux/macOS) |
| `csk uninstall` | Remove the system service |
| `csk start` | Start the daemon in the foreground |
| `csk status` | Show session state and next ping time |
| `csk ping` | Send a ping immediately |
| `csk ping-in <duration>` | One-shot: wait then ping (`1h23m`, `45m`, `2h`) |
| `csk logs` | Tail the log file |

All commands accept `-c <path>` to specify a custom config file.

---

## VPS / Docker deployment

For the most reliable setup (ping fires even when your laptop is off):

```bash
docker compose up -d
```

> The container mounts `~/.claude` so the keeper can watch for activity and the `claude` CLI authenticates using your existing session.

---

## Configuration

Copy the example config and edit as needed:

```bash
mkdir -p ~/.claude-session-keeper
cp config.example.yml ~/.claude-session-keeper/config.yml
```

| Option | Default | Description |
|--------|---------|-------------|
| `sessionDuration` | `5h` | Claude's usage window length |
| `inactivityThreshold` | `30m` | Gap before a new activity burst is treated as a new session |
| `pingBuffer` | `30s` | How early before reset to fire the ping |
| `claudeCommand` | `claude` | CLI binary name |
| `pingPrompt` | `hi` | Message sent to start the session |
| `webhookUrl` | — | Optional HTTP POST notification after each ping |

---

## Webhook notifications

Set `webhookUrl` in your config to receive a POST after every ping:

```json
{
  "event": "claude_session_ping",
  "success": true,
  "timestamp": "2024-01-01T15:00:00.000Z",
  "message": "Claude session keeper ping sent — new 5-hour window started"
}
```

Works with Slack incoming webhooks, Discord webhooks, or any custom endpoint.

---

## How it works

1. Watches `~/.claude/` for `.jsonl` file writes (each Claude Code message appends to a conversation file)
2. On first write after a gap > `inactivityThreshold`, records `sessionStartedAt = now`
3. Schedules `claude -p "hi"` at `sessionStartedAt + 5h - pingBuffer`
4. State is persisted to `~/.claude-session-keeper/state.json` — survives restarts
5. After the ping fires, the watcher waits for the next session to begin

---

## Contributing

PRs welcome. Open an issue first for anything beyond small bug fixes.

---

## License

MIT
