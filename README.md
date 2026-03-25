# SlayTheList

SlayTheList combines a todo app with a local API and a desktop launcher. The current cross-platform focus is the `frontend/web` + `backend/api` stack; the game overlay remains Windows-only for now.

## Packages

- `frontend/web`: Next.js app for todo management and lock-zone editing
- `backend/api`: Express + WebSocket API for todo persistence and local app services
- `shared/contracts`: Shared TypeScript types and validation schemas
- `desktop/app`: Electron launcher that starts the local stack without visible shells
- `desktop/overlay-agent`: Windows-only WPF overlay client

## Quick start

1. Install dependencies:
   - `npm install`
2. Double-click `launch-slaythelist.bat`
3. Choose how you want to run STL:
   - Desktop app: `npm run desktop:dev`
   - Browser workflow: `npm run dev:api` and `npm run dev:web`

The desktop option starts the API on `8788`, prefers web port `3000`, falls back to a free local port if needed, and opens the UI inside an Electron window without separate terminal windows.

## Unified Windows launcher

If you want one double-click entry point on Windows, use:

- `launch-slaythelist.bat`

It lets you choose:

- Browser mode
- Browser mode with hidden shells
- Desktop mode
- Stop running SlayTheList processes

If you want a no-console launcher window, use:

- `launch-slaythelist-hidden.vbs`

That gives you the same mode choices from a small prompt without leaving a batch window open.

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

## Windows-only overlay tools

The legacy batch launchers and the overlay agent are still Windows-specific:

- `launchers/windows/start-slaythelist.bat`
- `launchers/windows/start-slaythelist-hidden.bat`
- `launchers/windows/stop-slaythelist.bat`
- `launchers/windows/restart-slaythelist.bat`
- `desktop/overlay-agent`

They are no longer required for running the core app on macOS.

## API usage from CLI/agents

For command-line usage patterns (including PowerShell examples suitable for Claude Code), see:

- `docs/agent-api-usage.md`

## Validation

Use `docs/mvp-validation.md` for an end-to-end verification checklist.
