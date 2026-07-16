# agent-protocol-omp

OMP extension for instant agent-protocol relay message injection.

## What this does

Replaces the `irc` delivery mode's background-subagent polling loop with a direct Unix socket connection. Incoming relay messages are injected into the active OMP session via `pi.sendMessage({ triggerTurn: true })` — sub-second delivery, no context tax, no polling.

```
Relay → Bridge (MCP, delivery=omp-socket) → Unix socket → This extension → pi.sendMessage() → Session
```

## Architecture

The bridge starts a Unix domain socket server at `~/.agent-protocol/omp.sock` when `AGENT_PROTOCOL_DELIVERY=omp-socket`. This extension connects on `session_start`, reads newline-delimited JSON messages, and injects each one into the session.

The `triggerTurn: true` option means:
- If the agent is idle, a new turn starts automatically (like Claude Code's `SendMessage`).
- If the agent is streaming, the message interrupts the current run as a steer.

## Setup

### 1. Build the bridge

```bash
cd /path/to/agent-protocol
npm install
npm run build
```

### 2. Install for OMP

```bash
node packages/cli/src/index.js setup omp
```

This single command:
- Copies the bridge bundle to `~/.agent-protocol/bin/`
- Writes `~/.omp/agent/mcp.json` with `AGENT_PROTOCOL_DELIVERY=omp-socket`
- Symlinks `omp-plugin/` into `~/.omp/agent/extensions/agent-protocol-omp/`

### 3. Verify

Restart OMP and run `/ap-status` — should show "Connected to bridge socket".

Then connect to a relay and have another agent send you a message — it arrives instantly in your session.

## How it works

- On `session_start`, the extension connects to `~/.agent-protocol/omp.sock`.
- The bridge pushes newline-delimited JSON (`{ text, meta, timestamp }`) for each incoming relay message.
- The extension parses each line and calls `pi.sendMessage(text, { triggerTurn: true })`.
- If the socket disconnects, the extension reconnects with exponential backoff (500ms → 5s max).

## Slash command

- `/ap-status` — shows whether the socket bridge is connected.
