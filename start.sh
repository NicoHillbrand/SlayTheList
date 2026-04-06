#!/bin/bash
# ============================================
#   SlayTheList — Linux Launcher
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

API_PORT=8788
WEB_PORT=4000

info()    { printf '\033[1;34m▶\033[0m  %s\n' "$*"; }
success() { printf '\033[1;32m✓\033[0m  %s\n' "$*"; }
warn()    { printf '\033[1;33m⚠\033[0m  %s\n' "$*"; }
fail()    { printf '\033[1;31m✗\033[0m  %s\n' "$*"; }
die()     { fail "$*"; exit 1; }

# ── Kill previous SlayTheList processes ─────────────────────────────────────
kill_previous() {
  info "Stopping previous SlayTheList processes..."

  # Kill node processes related to this project
  pkill -f "slaythelist.*dev:api" 2>/dev/null || true
  pkill -f "slaythelist.*dev:web" 2>/dev/null || true
  pkill -f "tsx watch.*server\.ts" 2>/dev/null || true
  pkill -f "next dev.*slaythelist" 2>/dev/null || true
  pkill -f "overlay_agent\.py" 2>/dev/null || true
  pkill -f "startup-status\.py" 2>/dev/null || true

  # Kill SlayTheList processes on the API & web ports
  for port in $API_PORT 4000 4001 4002 4003; do
    if command -v lsof &>/dev/null; then
      for pid in $(lsof -ti:$port 2>/dev/null); do
        cmdline=$(cat /proc/$pid/cmdline 2>/dev/null | tr '\0' ' ' || ps -p $pid -o args= 2>/dev/null)
        if echo "$cmdline" | grep -qi "slaythelist"; then
          kill -9 "$pid" 2>/dev/null || true
        fi
      done
    elif command -v fuser &>/dev/null; then
      fuser -k $port/tcp 2>/dev/null || true
    fi
  done

  sleep 1
  success "Previous processes stopped"
}

# ── Preflight ───────────────────────────────────────────────────────────────
command -v node &>/dev/null || die "Node.js not found. Run ./install.sh first."

NODE_VER=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
[ "$NODE_VER" -ge 20 ] 2>/dev/null || die "Node.js v20+ required (found v$NODE_VER). Run ./install.sh first."

[ -d "node_modules" ] || die "Dependencies not installed. Run ./install.sh first."
[ -d "shared/contracts/dist" ] || die "Contracts not built. Run ./install.sh first."

success "Node.js $(node --version)"
success "Dependencies OK"

# ── Handle "stop" argument ──────────────────────────────────────────────────
if [ "${1:-}" = "stop" ]; then
  kill_previous
  exit 0
fi

# ── Auto-stop previous instance ────────────────────────────────────────────
kill_previous

# ── Find available web port ─────────────────────────────────────────────────
if ss -tlnp 2>/dev/null | grep -q ":$WEB_PORT " || lsof -iTCP:$WEB_PORT -sTCP:LISTEN &>/dev/null 2>&1; then
  WEB_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()")
  warn "Port 4000 is busy — using port $WEB_PORT instead"
fi

# ── Mode selection ──────────────────────────────────────────────────────────
echo ""
echo "  How would you like to run SlayTheList?"
echo ""
echo "  1) Browser     — opens in your web browser"
echo "  2) Desktop App — launches the Electron app"
echo ""
printf "Choose [1/2] (default: 1): "
read -r CHOICE

case "$CHOICE" in
  2) MODE="desktop" ;;
  *) MODE="browser" ;;
esac

# ── Cleanup handler ─────────────────────────────────────────────────────────
cleanup() {
  echo ""
  info "Shutting down..."
  kill $(jobs -p) 2>/dev/null
  wait 2>/dev/null
  success "Stopped."
}
trap cleanup EXIT INT TERM

# ── Launch ──────────────────────────────────────────────────────────────────
if [ "$MODE" = "desktop" ]; then
  info "Launching Electron app..."
  npm run app:dev 2>&1 &

  echo ""
  echo "  SlayTheList (Desktop) is starting..."
  echo "  The app window will appear when ready."
  echo "  Press Ctrl+C to stop."

  wait

else
  info "Starting API server..."
  npm run dev:api 2>&1 &
  API_PID=$!

  info "Starting web app on port $WEB_PORT..."
  PORT=$WEB_PORT npm run dev:web 2>&1 &
  WEB_PID=$!

  # Launch overlay agent if installed
  HAS_OVERLAY=""
  OVERLAY_VENV="desktop/overlay-agent-linux/venv/bin/python3"
  OVERLAY_SCRIPT="desktop/overlay-agent-linux/overlay_agent.py"
  if [ -x "$OVERLAY_VENV" ] && [ -f "$OVERLAY_SCRIPT" ]; then
    info "Starting overlay agent..."
    "$OVERLAY_VENV" "$OVERLAY_SCRIPT" 2>&1 &
    HAS_OVERLAY="--has-overlay"
  else
    warn "Overlay agent not installed — run ./install.sh to set it up"
  fi

  # Launch startup status GUI
  if command -v python3 &>/dev/null && python3 -c "import tkinter" 2>/dev/null; then
    python3 scripts/startup-status.py --api-port $API_PORT --web-port $WEB_PORT $HAS_OVERLAY &
  fi

  APP_URL="http://localhost:$WEB_PORT"
  info "Waiting for the app to be ready..."
  for i in $(seq 1 45); do
    if curl -sf "$APP_URL" &>/dev/null; then
      success "App is up!"
      xdg-open "$APP_URL" 2>/dev/null \
        || sensible-browser "$APP_URL" 2>/dev/null \
        || echo "Open $APP_URL in your browser."
      break
    fi
    if ! kill -0 $API_PID 2>/dev/null || ! kill -0 $WEB_PID 2>/dev/null; then
      die "A server process crashed during startup. Check the output above."
    fi
    sleep 1
  done

  echo ""
  echo "  SlayTheList is running!"
  echo "  Web  →  http://localhost:$WEB_PORT"
  echo "  API  →  http://localhost:$API_PORT"
  echo ""
  echo "  Press Ctrl+C to stop."

  wait
fi
