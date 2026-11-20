#!/usr/bin/env bash
# End-to-end test of the account routes against a local PocketBase.
# Usage: server/tests/run.sh [path-to-pocketbase-binary]   (default: downloads 0.30.0 into a temp dir)
# Everything runs in a temp dir that is removed at the end; nothing touches the live server.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
T=$(mktemp -d); trap 'if [ -f "$T/pb.pid" ]; then kill "$(cat "$T/pb.pid")" 2>/dev/null || true; fi; rm -rf "$T"' EXIT
PB=${1:-}
if [ -z "$PB" ]; then
  V=0.30.0; curl -sL -o "$T/pb.zip" "https://github.com/pocketbase/pocketbase/releases/download/v$V/pocketbase_${V}_linux_amd64.zip"; (cd "$T" && unzip -oq pb.zip); PB="$T/pocketbase"
fi
mkdir -p "$T/pb_hooks" "$T/pb_migrations" "$T/pb_data"
cp "$ROOT"/server/pb_hooks/*.js "$T/pb_hooks/"; cp "$ROOT/engine.js" "$T/pb_hooks/engine.js"; cp "$ROOT"/server/pb_migrations/*.js "$T/pb_migrations/"
"$PB" --dir "$T/pb_data" --migrationsDir "$T/pb_migrations" migrate up >/dev/null
"$PB" --dir "$T/pb_data" superuser upsert su@test.local Sup3rpass-word >/dev/null
PORT=${PORT:-8099}
"$PB" serve --dir "$T/pb_data" --hooksDir "$T/pb_hooks" --migrationsDir "$T/pb_migrations" --http "127.0.0.1:$PORT" --hooksWatch=false > "$T/pb.log" 2>&1 &
echo $! > "$T/pb.pid"
for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
if node "$ROOT/server/tests/e2e.mjs" "$ROOT/engine.js" "http://127.0.0.1:$PORT"; then echo "e2e passed"; else echo "e2e FAILED; server log:"; grep -iE "error|panic" "$T/pb.log" | grep -v "SELECT\|INSERT\|UPDATE\|CREATE" | head -20; exit 1; fi
