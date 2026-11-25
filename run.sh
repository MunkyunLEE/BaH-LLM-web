#!/bin/sh
cd "$(dirname "$0")/web" || exit 1
PORT="${1:-8766}"
URL="http://localhost:$PORT/index.html"
echo "BaH-LLM-web: $URL (끄려면 Ctrl+C)"
( sleep 1; if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
