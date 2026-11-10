#!/bin/sh
set -eu
npm test
work=$(mktemp -d)
mkdir "$work/server" "$work/browser"
pids=
cleanup() {
  for pid in $pids; do kill "$pid" 2>/dev/null || true; done
  for pid in $pids; do wait "$pid" 2>/dev/null || true; done
  pids=
}
trap cleanup EXIT
trap 'exit 130' INT
export BROWSER_COVERAGE="$work/browser"
export BOARD_A=http://127.0.0.1:3100
export BOARD_B=http://127.0.0.1:3101
BOARD_COVERAGE=1 ./node_modules/.bin/vite build
for port in 3100 3101; do
  PORT=$port NODE_V8_COVERAGE="$work/server" node --import tsx server/index.ts &
  pids="$pids $!"
  n=0
  until curl -fs "http://127.0.0.1:$port/healthz" >/dev/null; do
    n=$((n + 1))
    [ "$n" -lt 40 ]
    sleep 0.5
  done
done
npm run test:e2e
cleanup
./node_modules/.bin/c8 report --temp-directory "$work/server" --exclude-after-remap \
  --include 'server/**' --reporter json --report-dir coverage/e2e
node tests/coverage.mjs "$work/browser"
node --input-type=module -e 'import { rmSync } from "node:fs"; rmSync(process.argv[1], { recursive: true });' "$work"
