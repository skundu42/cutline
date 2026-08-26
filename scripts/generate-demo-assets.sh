#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/demo"
mkdir -p "$OUT"

FONT=""
# This ffmpeg build has no libfreetype/drawtext; clips are solid color + tone.

encode() {
  local name="$1"
  local color="$2"
  local seconds="$3"
  local label="$4"
  local extra=()
  if [[ -n "$FONT" ]]; then
    extra=(-vf "drawtext=fontfile=${FONT}:text='${label} %{pts\:hms}':fontsize=42:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2")
  fi
  ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "color=c=${color}:s=1280x720:d=${seconds}:r=15" \
    -f lavfi -i "sine=frequency=220:duration=${seconds}" \
    "${extra[@]}" \
    -c:v libx264 -pix_fmt yuv420p -crf 32 -preset veryfast \
    -c:a aac -b:a 64k \
    -movflags +faststart \
    "$OUT/${name}.mp4"
  ffmpeg -y -hide_banner -loglevel error -ss 1 -i "$OUT/${name}.mp4" -frames:v 1 "$OUT/${name}.jpg" || true
}

encode take_1 0x152822 74 "TAKE 1"
encode take_2 0x495945 11 "TAKE 2"
encode gpu_rack 0xF4965E 8 "GPU RACK"
encode brand_sting 0xABEA93 2 "CUTLINE"

cat > "$OUT/cache_diagram.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <rect width="1080" height="1920" fill="#152822"/>
  <text x="80" y="180" fill="#ABEA93" font-size="64" font-family="system-ui,sans-serif" font-weight="800">KV CACHE</text>
  <text x="80" y="260" fill="#F8F8F8" font-size="32" font-family="system-ui,sans-serif">one row per new token</text>
  <rect x="80" y="360" width="920" height="120" rx="16" fill="#D3FFB5" stroke="#19192C" stroke-width="4"/>
  <rect x="80" y="520" width="920" height="120" rx="16" fill="#D0E6D6" stroke="#19192C" stroke-width="4"/>
  <rect x="80" y="680" width="920" height="120" rx="16" fill="#D7D1E4" stroke="#19192C" stroke-width="4"/>
  <rect x="80" y="840" width="920" height="120" rx="16" fill="#ABEA93" stroke="#19192C" stroke-width="4"/>
  <text x="120" y="435" fill="#19192C" font-size="36" font-family="ui-monospace,monospace">k0 v0  token 0</text>
  <text x="120" y="595" fill="#19192C" font-size="36" font-family="ui-monospace,monospace">k1 v1  token 1</text>
  <text x="120" y="755" fill="#19192C" font-size="36" font-family="ui-monospace,monospace">k2 v2  token 2</text>
  <text x="120" y="915" fill="#19192C" font-size="36" font-family="ui-monospace,monospace">k3 v3  append only</text>
</svg>
SVG

GOLDEN_VF=()
if [[ -n "$FONT" ]]; then
  GOLDEN_VF=(-vf "drawtext=fontfile=${FONT}:text='GOLDEN 9\:16 %{pts\:hms}':fontsize=42:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2")
fi

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "color=c=0x152822:s=720x1280:d=35:r=15" \
  -f lavfi -i "sine=frequency=330:duration=35" \
  "${GOLDEN_VF[@]}" \
  -c:v libx264 -pix_fmt yuv420p -crf 32 -preset veryfast \
  -c:a aac -b:a 64k -movflags +faststart \
  "$OUT/golden_export_720p.mp4"

echo "Wrote demo assets to $OUT"
