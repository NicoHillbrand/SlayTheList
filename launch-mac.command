#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════╗
# ║  SlayTheList — macOS Launcher                                   ║
# ║  Double-click this file in Finder to start the app.             ║
# ╚══════════════════════════════════════════════════════════════════╝

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

API_PORT=8788
WEB_PORT=4000

# ── helpers ──────────────────────────────────────────────────────────────────
info()    { printf '\033[1;34m▶\033[0m  %s\n' "$*"; }
success() { printf '\033[1;32m✓\033[0m  %s\n' "$*"; }
warn()    { printf '\033[1;33m⚠\033[0m  %s\n' "$*"; }
fail()    { printf '\033[1;31m✗\033[0m  %s\n' "$*"; }
die()     { fail "$*"; echo; echo "Press Enter to close."; read -r; exit 1; }

# ── 1. Node.js (skip if already good) ───────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
  if [ "$NODE_VER" -ge 20 ] 2>/dev/null; then
    success "Node.js $(node --version) found"
  else
    warn "Node.js v$NODE_VER found but v20+ is required — upgrading..."
    brew install node 2>/dev/null || die "Could not upgrade Node. Please install Node.js 20+ manually from https://nodejs.org"
    success "Node.js upgraded to $(node --version)"
  fi
else
  info "Node.js not found — installing..."

  # Install Homebrew if needed
  if ! command -v brew &>/dev/null; then
    info "Installing Homebrew first (this may take a few minutes)..."
    NONINTERACTIVE=1 /bin/bash -c \
      "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
      || die "Homebrew installation failed. Install Node.js 20+ manually from https://nodejs.org"

    # Add brew to PATH for this session
    if [ -f /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -f /usr/local/bin/brew ]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
    success "Homebrew installed"
  fi

  brew install node || die "Node.js installation failed"
  success "Node.js $(node --version) installed"
fi

# ── 2. .env (skip if exists) ────────────────────────────────────────────────
if [ ! -f "backend/api/.env" ]; then
  if [ -f "backend/api/.env.example" ]; then
    cp "backend/api/.env.example" "backend/api/.env"
    success "Created backend/api/.env from .env.example"
  else
    warn "No .env.example found — you may need to create backend/api/.env manually"
  fi
else
  success "backend/api/.env already exists"
fi

# ── 3. npm install (skip if node_modules is up to date) ─────────────────────
if [ ! -d "node_modules" ]; then
  info "Installing dependencies (first run — this takes a minute or two)..."
  npm install 2>&1 | tail -3
  success "Dependencies installed"
elif [ "package-lock.json" -nt "node_modules/.package-lock.json" ] 2>/dev/null; then
  info "Dependencies out of date — updating..."
  npm install --prefer-offline 2>&1 | tail -3
  success "Dependencies updated"
else
  success "Dependencies already up to date"
fi

# ── 4. Build contracts (skip if already built) ──────────────────────────────
if [ ! -d "shared/contracts/dist" ]; then
  info "Building shared contracts..."
  npm run build:contracts 2>&1 | tail -2
  success "Contracts built"
else
  success "Contracts already built"
fi

# ── 5. Check for port conflicts ─────────────────────────────────────────────
if lsof -iTCP:$API_PORT -sTCP:LISTEN &>/dev/null; then
  die "Port $API_PORT is already in use. Close the existing API process and try again."
fi

# Find an available web port
if lsof -iTCP:$WEB_PORT -sTCP:LISTEN &>/dev/null; then
  WEB_PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()")
  warn "Port 4000 is busy — using port $WEB_PORT instead"
fi

# ── 6. Choose launch mode ───────────────────────────────────────────────────
echo ""
echo "┌──────────────────────────────────────────────┐"
echo "│  How would you like to run SlayTheList?       │"
echo "│                                               │"
echo "│  1) Browser     — opens in your web browser   │"
echo "│  2) Desktop App — launches the Electron app   │"
echo "└──────────────────────────────────────────────┘"
echo ""
printf "Choose [1/2] (default: 1): "
read -r CHOICE

case "$CHOICE" in
  2)
    MODE="desktop"
    ;;
  *)
    MODE="browser"
    ;;
esac

# ── 7. Launch ────────────────────────────────────────────────────────────────

cleanup() {
  echo ""
  info "Shutting down..."
  kill $(jobs -p) 2>/dev/null
  wait 2>/dev/null
  success "Stopped."
}
trap cleanup EXIT INT TERM

if [ "$MODE" = "desktop" ]; then
  # Electron app handles everything (API + Web + window)
  info "Launching Electron app..."
  npm run app:dev 2>&1 &

  echo ""
  echo "┌──────────────────────────────────────────────┐"
  echo "│  SlayTheList (Desktop) is starting...         │"
  echo "│  The app window will appear when ready.       │"
  echo "│                                               │"
  echo "│  Press Ctrl+C or close this window to stop.  │"
  echo "└──────────────────────────────────────────────┘"

  wait

else
  # Browser mode — start API and Web separately
  info "Starting API server..."
  npm run dev:api 2>&1 &
  API_PID=$!

  info "Starting web app on port $WEB_PORT..."
  PORT=$WEB_PORT npm run dev:web 2>&1 &
  WEB_PID=$!

  # Wait for web server, then open browser
  APP_URL="http://localhost:$WEB_PORT"
  info "Waiting for the app to be ready..."
  for i in $(seq 1 45); do
    if curl -sf "$APP_URL" &>/dev/null; then
      success "App is up!"
      open "$APP_URL"
      break
    fi
    if ! kill -0 $API_PID 2>/dev/null || ! kill -0 $WEB_PID 2>/dev/null; then
      die "A server process crashed during startup. Check the output above."
    fi
    sleep 1
  done

  echo ""
  echo "┌──────────────────────────────────────────────┐"
  echo "│  SlayTheList is running!                      │"
  echo "│  Web  →  http://localhost:$WEB_PORT               │"
  echo "│  API  →  http://localhost:$API_PORT                │"
  echo "│                                               │"
  echo "│  Press Ctrl+C or close this window to stop.  │"
  echo "└──────────────────────────────────────────────┘"

  wait
fi
