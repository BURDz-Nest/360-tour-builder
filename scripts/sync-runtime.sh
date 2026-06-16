#!/usr/bin/env bash
# sync-runtime.sh — push the player runtime (player-template/) into every
# existing tours/<name>/ folder, so runtime fixes reach tours you already made.
# Preserves each tour's tour.json and images/ (those don't exist in the template).

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

shopt -s nullglob
count=0
for d in tours/*/; do
  [ -d "$d" ] || continue
  cp -R player-template/css player-template/js player-template/vendor player-template/player.html "$d"
  echo "synced runtime -> $d"
  count=$((count + 1))
done

if [ "$count" -eq 0 ]; then
  echo "No tours found in tours/. Nothing to sync."
else
  echo "Done. Synced $count tour(s)."
fi
