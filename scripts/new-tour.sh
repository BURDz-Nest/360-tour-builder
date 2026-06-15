#!/usr/bin/env bash
# new-tour.sh — scaffold a new self-contained tour folder.
#
# Usage:   ./scripts/new-tour.sh <tour-name>
# Example: ./scripts/new-tour.sh backroom-walkthrough
#
# Creates tours/<tour-name>/ containing a fresh copy of the player runtime
# (player.html + css/ + js/ + vendor/), an empty images/ folder, and a
# starter tour.json. The result is independently deployable to GitHub Pages
# or Azure Static Web Apps.

set -euo pipefail

# Resolve repo root (this script lives in scripts/).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/player-template"

NAME="${1:?Usage: ./scripts/new-tour.sh <tour-name>}"
# slugify: lowercase, spaces/punctuation -> hyphens
SLUG="$(echo "$NAME" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
DEST="$ROOT/tours/$SLUG"

if [ -e "$DEST" ]; then
  echo "Error: tours/$SLUG already exists. Pick another name or delete it first."
  exit 1
fi

mkdir -p "$DEST/images"
cp -R "$TEMPLATE/." "$DEST/"

cat > "$DEST/tour.json" <<JSON
{
  "version": 1,
  "meta": {
    "title": "$NAME",
    "description": "",
    "author": "",
    "startSceneId": "",
    "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  },
  "scenes": []
}
JSON

echo "Created tours/$SLUG/"
echo "  - player runtime copied (player.html, css/, js/, vendor/)"
echo "  - images/        <- drop your web-optimized 360 .jpg files here"
echo "  - tour.json      <- starter config (edit via the builder)"
echo
echo "Next:"
echo "  1. ./scripts/resize-360.sh \"path/to/raw/photos\"   # optional: web-optimize"
echo "  2. copy the *_web.jpg into tours/$SLUG/images/"
echo "  3. open the builder, author, and Save into tours/$SLUG/"
echo "  4. test:  <server>/tours/$SLUG/player.html?config=tour.json"
echo "  5. push tours/$SLUG/ to GitHub Pages / Azure"
