#!/usr/bin/env bash
# launch.command — double-click in Finder to start the 360 Tour Builder.
# Starts the local web server (if not already running) and opens the builder.

PORT=8124  # local dev server port for the builder + tours
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

# Start the server only if the port isn't already serving.
if ! curl -s -o /dev/null "http://localhost:$PORT/builder/index.html"; then
  echo "Starting local server on port $PORT ..."
  python3 -m http.server "$PORT" >/tmp/360tour_server.log 2>&1 &
  sleep 1
else
  echo "Server already running on port $PORT."
fi

URL="http://localhost:$PORT/builder/index.html"
echo "Opening $URL"
case "$(uname)" in
  Darwin) open "$URL" ;;
  Linux)  xdg-open "$URL" ;;
  *)      start "$URL" ;;
esac

echo
echo "Builder is open in your browser."
echo "Leave this window open while you work (it runs the server)."
echo "Close it when you're done."
# Keep the window alive so the background server keeps running.
wait
