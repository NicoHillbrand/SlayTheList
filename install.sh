#!/bin/bash
# ============================================
#   SlayTheList — macOS / Linux Installer
# ============================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

info()    { printf '\033[1;34m▶\033[0m  %s\n' "$*"; }
success() { printf '\033[1;32m✓\033[0m  %s\n' "$*"; }
warn()    { printf '\033[1;33m⚠\033[0m  %s\n' "$*"; }
fail()    { printf '\033[1;31m✗\033[0m  %s\n' "$*"; }
die()     { fail "$*"; exit 1; }

OS="$(uname -s)"

echo "============================================"
echo "  SlayTheList — Installer ($OS)"
echo "============================================"
echo ""

# ── 1. Node.js ──────────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
  if [ "$NODE_VER" -ge 20 ] 2>/dev/null; then
    success "Node.js $(node --version) found"
  else
    warn "Node.js v$NODE_VER found but v20+ is required"
    NEED_NODE=1
  fi
else
  info "Node.js not found"
  NEED_NODE=1
fi

if [ "${NEED_NODE:-0}" = "1" ]; then
  if [ "$OS" = "Darwin" ]; then
    # macOS — use Homebrew
    if ! command -v brew &>/dev/null; then
      info "Installing Homebrew..."
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
  else
    # Linux — try common package managers
    if command -v apt-get &>/dev/null; then
      info "Installing Node.js via apt..."
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - \
        && sudo apt-get install -y nodejs \
        || die "Node.js installation failed. Install Node.js 20+ manually from https://nodejs.org"
    elif command -v dnf &>/dev/null; then
      info "Installing Node.js via dnf..."
      curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - \
        && sudo dnf install -y nodejs \
        || die "Node.js installation failed. Install Node.js 20+ manually from https://nodejs.org"
    elif command -v pacman &>/dev/null; then
      info "Installing Node.js via pacman..."
      sudo pacman -Sy --noconfirm nodejs npm \
        || die "Node.js installation failed. Install Node.js 20+ manually from https://nodejs.org"
    else
      die "No supported package manager found. Install Node.js 20+ manually from https://nodejs.org"
    fi
  fi
  success "Node.js $(node --version) installed"
fi

# ── 2. .env file ────────────────────────────────────────────────────────────
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

# ── 3. npm install ──────────────────────────────────────────────────────────
info "Installing npm dependencies..."
npm install 2>&1 | tail -5
success "Dependencies installed"

# ── 4. Build shared contracts ───────────────────────────────────────────────
info "Building shared contracts..."
npm run build:contracts 2>&1 | tail -3
success "Contracts built"

# ── 5. Linux overlay agent dependencies ─────────────────────────────────────
if [ "$OS" = "Linux" ]; then
  info "Setting up Linux overlay agent..."

  # System packages for GTK3 + PyGObject + Cairo + xdotool
  PKGS_NEEDED=""
  if command -v apt-get &>/dev/null; then
    # Debian/Ubuntu
    for pkg in python3-gi python3-gi-cairo gir1.2-gtk-3.0 xdotool python3-venv python3-pip; do
      dpkg -s "$pkg" &>/dev/null || PKGS_NEEDED="$PKGS_NEEDED $pkg"
    done
    if [ -n "$PKGS_NEEDED" ]; then
      info "Installing system packages:$PKGS_NEEDED"
      sudo apt-get install -y $PKGS_NEEDED || warn "Some system packages failed to install"
    fi
  elif command -v dnf &>/dev/null; then
    # Fedora/RHEL
    for pkg in python3-gobject python3-cairo gtk3 xdotool python3-pip; do
      rpm -q "$pkg" &>/dev/null || PKGS_NEEDED="$PKGS_NEEDED $pkg"
    done
    if [ -n "$PKGS_NEEDED" ]; then
      info "Installing system packages:$PKGS_NEEDED"
      sudo dnf install -y $PKGS_NEEDED || warn "Some system packages failed to install"
    fi
  elif command -v pacman &>/dev/null; then
    # Arch
    for pkg in python-gobject gtk3 xdotool python-pip; do
      pacman -Qi "$pkg" &>/dev/null 2>&1 || PKGS_NEEDED="$PKGS_NEEDED $pkg"
    done
    if [ -n "$PKGS_NEEDED" ]; then
      info "Installing system packages:$PKGS_NEEDED"
      sudo pacman -S --noconfirm $PKGS_NEEDED || warn "Some system packages failed to install"
    fi
  else
    warn "Could not detect package manager. Install manually: python3-gi, gtk3, xdotool"
  fi

  # Python deps in a venv (--system-site-packages to pick up PyGObject)
  OVERLAY_DIR="desktop/overlay-agent-linux"
  if [ ! -d "$OVERLAY_DIR/venv" ]; then
    python3 -m venv --system-site-packages "$OVERLAY_DIR/venv"
  fi
  "$OVERLAY_DIR/venv/bin/pip" install -q -r "$OVERLAY_DIR/requirements.txt" 2>&1 | tail -3
  success "Linux overlay agent ready"
fi

echo ""
echo "============================================"
echo "  Installation complete!"
if [ "$OS" = "Darwin" ]; then
  echo "  Run start.command to launch SlayTheList."
else
  echo "  Run ./start.sh to launch SlayTheList."
fi
echo "============================================"
echo ""
