#!/usr/bin/env bash
#
# launch.sh — start a local dev server for ATLAS Explore.
#
# Serves the tour builder over http://localhost so you can iterate WITHOUT
# pushing to GitHub. localhost counts as a browser "secure context", so the
# File System Access API (save-to-disk) works exactly like the deployed https
# site. See ../README.md for the full workflow.
#
# Usage:
#   ./scripts/launch.sh            # serve on port 5173, open the builder
#   ./scripts/launch.sh 5199       # serve on a different port
#
set -euo pipefail

PORT="${1:-5173}"

# We must serve from this stage's root (the parent of this scripts/ folder)
# because the builder loads vendor libs + the player via ../player-template/
# relative paths. Serve any deeper and those 404.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVE_ROOT="$(dirname "$SCRIPT_DIR")"
URL="http://localhost:${PORT}/builder/index.html"

# Pick a python.
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "ERROR: python3 not found. Install it (macOS: brew install python) and retry." >&2
  exit 1
fi

# Refuse to double-bind a busy port.
if command -v lsof >/dev/null 2>&1 && lsof -Pi ":${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Port ${PORT} is already in use."
  echo "  Stop it:        lsof -ti:${PORT} | xargs kill"
  echo "  Or use another: ./scripts/launch.sh 5199"
  exit 1
fi

# Open in a Chromium browser (Chrome/Edge required for the folder-save API).
open_builder() {
  sleep 1
  if command -v open >/dev/null 2>&1; then                 # macOS
    open -a "Google Chrome" "$URL" 2>/dev/null \
      || open -a "Microsoft Edge" "$URL" 2>/dev/null \
      || open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then            # Linux
    xdg-open "$URL"
  elif command -v start >/dev/null 2>&1; then               # Windows (Git Bash)
    start "" "$URL"
  else
    echo "Open this in Chrome or Edge: $URL"
  fi
}

echo "ATLAS Explore — Dev stage — local dev server"
echo "  Serving: $SERVE_ROOT"
echo "  Builder: $URL"
echo "  Use Chrome or Edge. Press Ctrl+C to stop."
echo ""

open_builder &

cd "$SERVE_ROOT"
exec "$PY" -m http.server "$PORT"
