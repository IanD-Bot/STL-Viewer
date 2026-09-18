#!/usr/bin/env bash
set -euo pipefail
STL=${1:?Usage: open-stl.sh /path/to/model.stl [port]}
PORT=${2:-8765}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
test -f "$ROOT/index.html"
test -f "$STL"
PY=$(command -v python3 || command -v python)
TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
cp -R "$ROOT"/. "$TMP"/
cp -f "$STL" "$TMP/model.stl"
URL="http://127.0.0.1:${PORT}/index.html?file=model.stl"
echo "Serving $TMP"
echo "Opening $URL"
( cd "$TMP" && "$PY" -m http.server "$PORT" --bind 127.0.0.1 ) &
PID=$!
sleep 1
if command -v xdg-open >/dev/null; then xdg-open "$URL"
elif command -v open >/dev/null; then open "$URL"
else echo "$URL"
fi
wait "$PID"
