#!/bin/bash
# PostToolUse hook for Claude Code
# Checks for incoming agent-protocol messages and surfaces them
NOTIF_FILE="$HOME/.agent-protocol/notifications"
if [ -s "$NOTIF_FILE" ]; then
  cat "$NOTIF_FILE"
  : > "$NOTIF_FILE"
fi
