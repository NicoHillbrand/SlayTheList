# SlayTheList

SlayTheList combines a todo app with a local API and a desktop launcher. The current cross-platform focus is the `frontend/web` + `backend/api` stack; the game overlay is available on Windows (.NET) and Linux (Python).

## Packages

- `frontend/web`: Next.js app for todo management and lock-zone editing
- `backend/api`: Express + WebSocket API for todo persistence and local app services
- `shared/contracts`: Shared TypeScript types and validation schemas
- `desktop/app`: Electron launcher that starts the local stack without visible shells
- `desktop/overlay-agent`: Windows WPF overlay client (self-contained, no .NET install needed)
- `desktop/overlay-agent-linux`: Linux overlay client (Python 3 + tkinter)

## Quick start

1. Install dependencies:
   - Windows: `install.bat`
   - macOS / Linux: `./install.sh`
2. Launch:
   - Windows: double-click `start.bat` (GUI mode selector) or `start.bat browser`
   - macOS: double-click `start.command`
   - Linux: `./start.sh`
3. Or run manually:
   - Desktop app: `npm run desktop:dev`
   - Browser workflow: `npm run dev:api` and `npm run dev:web`

The desktop option starts the API on `8788`, prefers web port `4000`, falls back to a free local port if needed, and opens the UI inside an Electron window without separate terminal windows.

## Launchers

Each platform has a launcher script at the repo root:

| Platform | Script | Notes |
|----------|--------|-------|
| Windows | `start.bat` | No argument → GUI mode selector; accepts `browser`, `desktop`, `stop` |
| macOS | `start.command` | Double-click in Finder or run from terminal |
| Linux | `start.sh` | Run from terminal; accepts `stop` to kill running processes |

All launchers automatically stop previous SlayTheList instances before starting.

## Desktop option

If you prefer STL as a desktop app instead of a browser tab:

- `npm run desktop:dev`

The older alias still works:

- `npm run app:dev`

## Manual browser development

If you want to run the services directly in the browser:

1. Start the API:
   - `npm run dev:api`
2. Start the web app:
   - `npm run dev:web`

`npm run dev:web` now syncs blocked overlay images into `frontend/web/public/blocked-overlays` automatically.

## Packaged desktop build

To build the production app assets and create an unpacked desktop bundle:

- `npm run desktop:package`

The older alias still works:

- `npm run app:package`

See `docs/desktop-launcher.md` for details.

## Overlay agents

The overlay agent blocks game windows until todos are completed. It is optional and platform-specific:

- **Windows:** `desktop/overlay-agent/` — .NET 8 WPF, self-contained (no .NET install needed). Launches automatically in browser mode if a built exe is found.
- **Linux:** `desktop/overlay-agent-linux/` — Python 3 + tkinter. Launches automatically if its venv is set up via `./install.sh`.

## API usage from CLI/agents

For command-line usage patterns (including PowerShell examples suitable for Claude Code), see:

- `docs/claude-todo-api-skill.md`

## Validation

Use `docs/mvp-validation.md` for an end-to-end verification checklist.
