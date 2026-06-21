#!/usr/bin/env bash
# Local Redis for College Copilot — built and run inside WSL (no sudo, no Docker).
#
# WSL2 forwards localhost, so a Redis listening on :6379 inside WSL is reachable
# from Windows at redis://localhost:6379 (what REDIS_URL points to in .env).
#
# Usage (from the project root, on Windows):
#   wsl bash scripts/redis-wsl.sh start   # build if needed, then run
#   wsl bash scripts/redis-wsl.sh stop
#   wsl bash scripts/redis-wsl.sh ping
# Or via npm:  npm run redis:start | redis:stop | redis:ping
set -euo pipefail

REDIS_SRC="$HOME/redis-build/redis-stable"
SERVER="$REDIS_SRC/src/redis-server"
CLI="$REDIS_SRC/src/redis-cli"
DATA="$HOME/redis-data"

build() {
  echo "Building Redis from source (one-time, ~1-2 min)…"
  mkdir -p "$HOME/redis-build" && cd "$HOME/redis-build"
  [ -f redis-stable.tar.gz ] || curl -fsSL https://download.redis.io/redis-stable.tar.gz -o redis-stable.tar.gz
  [ -d redis-stable ] || tar xzf redis-stable.tar.gz
  cd redis-stable && make -j"$(nproc)" BUILD_TLS=no
}

case "${1:-start}" in
  start)
    [ -x "$SERVER" ] || build
    mkdir -p "$DATA"
    if "$CLI" ping >/dev/null 2>&1; then echo "Redis already running on localhost:6379"; exit 0; fi
    nohup "$SERVER" --port 6379 --bind 0.0.0.0 --protected-mode no --dir "$DATA" \
      > "$DATA/redis.log" 2>&1 &
    sleep 1
    "$CLI" ping >/dev/null && echo "Redis started on localhost:6379 ✓"
    ;;
  stop)
    "$CLI" shutdown nosave 2>/dev/null || pkill -f "redis-server" 2>/dev/null || true
    echo "Redis stopped."
    ;;
  ping)
    "$CLI" ping
    ;;
  *)
    echo "usage: $0 {start|stop|ping}"; exit 1 ;;
esac
