#!/bin/bash
# SlayTheList launcher for macOS
# Double-click this file in Finder to start the app.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── helpers ──────────────────────────────────────────────────────────────────
info()    { echo "▶  $*"; }
success() { echo "✓  $*"; }
warn()    { echo "⚠  $*"; }
die()     { echo "✗  $*"; exit 1; }

# ── 1. Node.js ───────────────────────────────────────────────────────────────
NODE_OK=false
if command -v node &>/dev/null; then
  NODE_VER=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
  if [ "$NODE_VER" -ge 20 ] 2>/dev/null; then
    NODE_OK=true
  else
    warn "Node.js $NODE_VER found but SlayTheList needs v20+. Will upgrade via Homebrew."
  fi
fi

if ! $NODE_OK; then
  info "Node.js not found or too old — installing via Homebrew..."

  # Install Homebrew if missing (non-interactive, auto-accepts prompts)
  if ! command -v brew &>/dev/null; then
    info "Installing Homebrew first (this may take a few minutes)..."
    NONINTERACTIVE=1 /bin/bash -c \
      "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add brew to PATH for the rest of this session
    if [ -f /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -f /usr/local/bin/brew ]; then
      eval "$(/usr/local/bin/brew shellenv)"
    fi
  fi

  brew install node
  success "Node.js installed: $(node --version)"
fi

# ── 2. .env ──────────────────────────────────────────────────────────────────
ENV_FILE="backend/api/.env"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "backend/api/.env.example" ]; then
    cp "backend/api/.env.example" "$ENV_FILE"
    success "Created $ENV_FILE from .env.example"
  else
    warn "No .env.example found — you may need to create backend/api/.env manually."
  fi
fi

# ── 3. npm install ────────────────────────────────────────────────────────────
info "Installing/updating dependencies..."
npm install --prefer-offline 2>&1 | tail -5
success "Dependencies ready."

# ── 4. Launch both servers in separate Terminal tabs ─────────────────────────
APP_URL="http://localhost:4000"

info "Starting API server and web app..."

osascript <<APPLESCRIPT
tell application "Terminal"
  -- API server (reuse current window's tab)
  do script "cd '$SCRIPT_DIR' && npm run dev:api" in front window

  -- Web frontend in a new tab
  tell application "System Events" to keystroke "t" using command down
  delay 0.5
  do script "cd '$SCRIPT_DIR' && npm run dev:web" in front window
end tell
APPLESCRIPT

# ── 5. Wait for the web server, then open the browser ────────────────────────
info "Waiting for the web app to be ready..."
for i in $(seq 1 30); do
  if curl -sf "$APP_URL" &>/dev/null; then
    success "App is up — opening browser..."
    open "$APP_URL"
    break
  fi
  sleep 1
done

echo ""
echo "┌──────────────────────────────────────────────┐"
echo "│  SlayTheList is running!                      │"
echo "│  Web  →  http://localhost:4000                │"
echo "│  API  →  http://localhost:8788                │"
echo "│                                               │"
echo "│  Close the Terminal tabs to stop the app.    │"
echo "└──────────────────────────────────────────────┘"
