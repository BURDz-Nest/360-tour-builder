#!/usr/bin/env bash
# resize-360.sh — make web-friendly copies of 360 panoramas (macOS, uses sips).
#
# Usage:
#   ./resize-360.sh "My Folder"          # resizes every .jpg in that folder
#   ./resize-360.sh "My Folder" 4096     # custom max width (default 6144)
#
# Output: for each foo.jpg it writes foo_web.jpg (longest side capped, ~80% quality).
# 6144 is a good quality/safety balance; use 4096 for locked-down/VDI GPUs.

set -euo pipefail

DIR="${1:?Usage: ./resize-360.sh <folder> [maxwidth]}"
MAX="${2:-6144}"

shopt -s nullglob nocaseglob
count=0
for f in "$DIR"/*.jpg "$DIR"/*.jpeg; do
  base="${f%.*}"
  case "$base" in *_web) continue;; esac   # don't re-process outputs
  out="${base}_web.jpg"
  sips -Z "$MAX" -s formatOptions 80 "$f" --out "$out" >/dev/null
  w=$(sips -g pixelWidth "$out" | awk '/pixelWidth/{print $2}')
  printf "  %-50s -> %spx\n" "$(basename "$out")" "$w"
  count=$((count+1))
done

echo "Done. Resized $count image(s) in '$DIR' (max width ${MAX}px)."
[ "$count" -eq 0 ] && echo "  (No .jpg files found — check the folder name/path.)"
