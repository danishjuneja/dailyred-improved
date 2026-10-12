#!/usr/bin/env bash
# Build and play Daily Red on macOS or Linux with Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-8080}"

fail() { printf 'Daily Red: %s\n' "$1" >&2; exit 1; }

case "$PORT" in
  ''|*[!0-9]*) fail "Port must be a number from 1 to 65535. Try: bash scripts/play.sh 8080" ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  fail "Port must be a number from 1 to 65535. Try: bash scripts/play.sh 8080"
fi

for file in Dockerfile patches/pokefirered-dailyred.patch web/index.html; do
  [ -f "$ROOT/$file" ] || fail "Missing project file: $file. Use a complete Daily Red checkout."
done

if ! command -v docker >/dev/null 2>&1; then
  if [ "$(uname -s)" = Darwin ]; then
    fail "Docker is missing. Install Docker Desktop: https://docs.docker.com/desktop/setup/install/mac-install/"
  fi
  fail "Docker is missing. Install Docker Engine for your distribution: https://docs.docker.com/engine/install/"
fi
if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  if [ "$(uname -s)" = Darwin ]; then
    fail "Docker is installed but its engine is unavailable. Start Docker Desktop (open -a Docker), then run: docker version"
  fi
  fail "Docker is installed but its engine is unavailable. Start it (usually sudo systemctl start docker), check permissions, then run: docker version"
fi
docker_os="$(docker info --format '{{.OSType}}' 2>/dev/null)" || fail "Could not read Docker engine details. Run: docker info"
[ "$docker_os" = linux ] || fail "A Linux Docker engine is required. Switch Docker Desktop to Linux containers, then run: docker info --format '{{.OSType}}'"

if ! docker build --progress=quiet -t dailyred:local "$ROOT"; then
  echo "Daily Red: Image build failed. Check the Docker error above, internet access, and free disk space." >&2
  echo "For a detailed log, run: docker build --progress=plain -t dailyred:local \"$ROOT\"" >&2
  exit 1
fi
echo "Open http://localhost:$PORT and press Play. Press Ctrl+C here to stop the server."
if docker run --rm -p "127.0.0.1:$PORT:8080" dailyred:local; then
  exit 0
else
  status=$?
  if [ "$status" -ne 130 ] && [ "$status" -ne 143 ]; then
    next_port=$((PORT == 65535 ? 8080 : PORT + 1))
    echo "Daily Red: Docker exited with status $status. If you did not stop the game, check the error above." >&2
    echo "If port $PORT is unavailable, try: bash \"$ROOT/scripts/play.sh\" $next_port" >&2
  fi
  exit "$status"
fi
