#!/usr/bin/env bash
#
# Build Claude in Arc against the current official Claude extension.
#
#   ./build.sh                      # fetch the latest official build and patch it
#   ./build.sh --crx path/to.crx    # patch a CRX you already have
#   ./build.sh --label v0.4         # override the label shown in arc://extensions
#
# Output: dist/Claude-in-Arc - load it via arc://extensions, "Load unpacked".

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

LABEL="v0.3"
CRX=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --crx)   CRX="$2";   shift 2 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

OFFICIAL="build/official"
DIST="dist/Claude-in-Arc"

echo "-> Fetching the official extension"
if [[ -n "$CRX" ]]; then
  python3 tools/fetch-official.py --out "$OFFICIAL" --crx "$CRX"
else
  python3 tools/fetch-official.py --out "$OFFICIAL"
fi

echo
echo "-> Applying the Arc patch"
python3 tools/apply-patch.py "$OFFICIAL" patch "$DIST" --label "$LABEL"

echo
echo "-> Verifying the build"
python3 tools/verify-build.py "$DIST"

cat <<EOF
To install:
  1. arc://extensions  ->  remove the official Claude extension if present
     (this build reuses its ID; the two cannot coexist)
  2. Enable "Developer mode"
  3. "Load unpacked"  ->  $ROOT/$DIST

Keep that folder where it is: Arc re-reads it on every launch.
EOF
