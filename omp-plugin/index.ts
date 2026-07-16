/**
 * agent-protocol-omp — OMP extension for instant relay message injection.
 *
 * Connects to the agent-protocol bridge's Unix domain socket
 * (~/.agent-protocol/omp.sock) and injects incoming relay messages
 * into the active OMP session via pi.sendMessage().
 *
 * This replaces the "irc" delivery mode's background-subagent polling loop
 * with a direct socket connection — sub-second delivery, no context tax.
 *
 * Architecture:
 *   Relay → Bridge (MCP) → Unix socket → This extension → pi.sendMessage() → Session
 *
 * The bridge starts the socket server when AGENT_PROTOCOL_DELIVERY=omp-socket.
 * This extension connects on session_start and reconnects automatically.
 */

import { connect, type Socket } from "node:net";
import { join } from "node:path";
import { existsSync } from "node:fs";

const SOCKET_PATH = join(
  process.env.HOME || process.env.HOMEPATH || "/tmp",
  ".agent-protocol",
  "omp.sock",
);

// Reconnect delay: starts at 500ms, backs off to 5s max.
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;

/** Shape of a message pushed by the bridge over the Unix socket. */
interface SocketMessage {
  text: string;
  meta?: {
    taskId?: string;
    kind?: string;
  };
  timestamp?: string;
}

/** Minimal subset of the OMP ExtensionAPI we use. */
interface ExtensionAPI {
  setLabel(label: string): void;
  on(event: string, handler: (event: unknown, ctx: unknown) => void | Promise<void>): void;
  sendMessage(message: string, options?: { deliverAs?: string; triggerTurn?: boolean }): void;
  registerCommand(
    name: string,
    def: {
      description: string;
      handler: (args: string, ctx: { ui: { notify(msg: string, level: string): void } }) => Promise<void>;
    },
  ): void;
}

export default function agentProtocolOmp(pi: ExtensionAPI) {
  pi.setLabel("Agent Protocol Bridge");

  let active = false;
  let socket: Socket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let lineBuffer = "";

  function cleanup() {
    active = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      socket.destroy();
      socket = null;
    }
    lineBuffer = "";
  }

  function scheduleReconnect() {
    if (!active) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts),
      RECONNECT_MAX_MS,
    );
    reconnectAttempts++;
    reconnectTimer = setTimeout(connectToSocket, delay);
  }

  function handleMessage(data: SocketMessage) {
    if (!data || typeof data.text !== "string") return;
    // Inject the relay message into the active session.
    // triggerTurn: true starts a turn when idle and interrupts when busy,
    // matching Claude Code's SendMessage behavior.
    try {
      pi.sendMessage(data.text, { triggerTurn: true });
    } catch {
      // If sendMessage fails (e.g. runtime not ready), try queuing for
      // the next user prompt so the message isn't lost.
      try {
        pi.sendMessage(data.text, { deliverAs: "nextTurn" });
      } catch {
        // Nothing more we can do — the message is lost.
      }
    }
  }

  function connectToSocket() {
    if (!active) return;

    // If the socket file doesn't exist yet, the bridge hasn't started or
    // isn't in omp-socket mode. Back off and try again.
    if (!existsSync(SOCKET_PATH)) {
      scheduleReconnect();
      return;
    }

    socket = connect(SOCKET_PATH);

    socket.on("connect", () => {
      reconnectAttempts = 0;
    });

    socket.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      // Keep the last partial line in the buffer
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed) as SocketMessage;
          handleMessage(data);
        } catch {
          // Ignore malformed lines
        }
      }
    });

    socket.on("error", () => {
      // ECONNREFUSED, socket vanished, etc. — schedule reconnect
      if (socket) {
        socket.destroy();
        socket = null;
      }
      scheduleReconnect();
    });

    socket.on("close", () => {
      socket = null;
      scheduleReconnect();
    });
  }

  pi.on("session_start", async () => {
    cleanup();
    active = true;
    reconnectAttempts = 0;
    connectToSocket();
  });

  pi.on("session_shutdown", async () => {
    cleanup();
  });

  // Provide a slash command for manual status check
  pi.registerCommand("ap-status", {
    description: "Show agent-protocol socket bridge status",
    handler: async (_args: string, ctx) => {
      const connected = socket !== null && !socket.destroyed && socket.writable;
      const status = connected
        ? `Connected to bridge socket at ${SOCKET_PATH}`
        : `Not connected (socket: ${socket ? "exists" : "null"}, active: ${active})`;
      ctx.ui.notify(status, "info");
    },
  });
}
