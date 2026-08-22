#!/usr/bin/env bash
# Kills whatever is already listening on the dev server port, so a stale
# `next dev` from a previous session doesn't collide with this one.
set -euo pipefail

PORT="${PORT:-3000}"
PIDS=$(lsof -ti tcp:"$PORT" 2>/dev/null || true)

if [ -n "$PIDS" ]; then
  echo "Killing existing process on port $PORT (pid: $PIDS)"
  kill -9 $PIDS
fi
