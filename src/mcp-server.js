const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { STATE_DIR, formatDuration } = require('./config');

const STATE_FILE = path.join(STATE_DIR, 'state.json');
const SESSION_DURATION = 5 * 60 * 60 * 1000;

function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

const TOOLS = [
  {
    name: 'get_session_status',
    description:
      'Get the current Claude Code session status: when the session started, ' +
      'when the 5-hour window resets, how many minutes remain, and when the ' +
      'next auto-ping is scheduled. Use this to know exactly when your session ' +
      'will reset so you can plan accordingly.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

function sessionStatus() {
  const state = readState();
  const now = Date.now();

  if (!state.sessionStartedAt && !state.lastPingSentAt) {
    return (
      'No session data found.\n' +
      'Make sure the keeper daemon is running: csk start --log-file'
    );
  }

  const lines = [];

  if (state.sessionStartedAt) {
    const sessionStart = new Date(state.sessionStartedAt);
    const resetAt = new Date(sessionStart.getTime() + SESSION_DURATION);
    const msUntilReset = resetAt - now;
    const absMin = Math.abs(Math.round(msUntilReset / 60000));

    lines.push(`Session started:     ${sessionStart.toLocaleString()}`);
    lines.push(`Session resets at:   ${resetAt.toLocaleString()}`);
    lines.push(
      msUntilReset > 0
        ? `Time until reset:    ${formatDuration(msUntilReset)} (${absMin} min)`
        : `Session reset:       ${absMin} min ago (ping may be in flight)`
    );
  }

  if (state.lastActivityAt) {
    const t = new Date(state.lastActivityAt);
    lines.push(`Last activity:       ${t.toLocaleString()} (${formatDuration(now - t)} ago)`);
  }

  if (state.lastPingSentAt) {
    const t = new Date(state.lastPingSentAt);
    lines.push(`Last ping sent:      ${t.toLocaleString()} (${formatDuration(now - t)} ago)`);
  }

  if (state.nextPingAt) {
    const t = new Date(state.nextPingAt);
    const ms = t - now;
    const absMin = Math.abs(Math.round(ms / 60000));
    lines.push(
      ms > 0
        ? `Next ping scheduled: ${t.toLocaleString()} (in ${absMin} min)`
        : `Next ping:           overdue by ${absMin} min — daemon may be stopped`
    );
  } else {
    lines.push('Next ping:           not scheduled (waiting for activity or daemon)');
  }

  return lines.join('\n');
}

// ─── JSON-RPC / MCP protocol ─────────────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function handleRequest(req) {
  // Notifications have no id — no response needed
  if (req.id === undefined || req.id === null) return;

  switch (req.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'claude-session-keeper', version: '1.0.0' },
        },
      });
      break;

    case 'tools/list':
      send({ jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } });
      break;

    case 'tools/call': {
      const name = req.params && req.params.name;
      if (name === 'get_session_status') {
        send({
          jsonrpc: '2.0',
          id: req.id,
          result: { content: [{ type: 'text', text: sessionStatus() }] },
        });
      } else {
        send({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32602, message: `Unknown tool: ${name}` },
        });
      }
      break;
    }

    default:
      send({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: 'Method not found' },
      });
  }
}

function startMcpServer() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      handleRequest(JSON.parse(trimmed));
    } catch {}
  });

  rl.on('close', () => process.exit(0));
}

module.exports = { startMcpServer };
