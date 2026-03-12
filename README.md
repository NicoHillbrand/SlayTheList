# SlayTheList

SlayTheList combines a browser todo app with a Windows game overlay that blocks configured regions of the game screen until required todos are completed.

## Packages

- `frontend/web`: Next.js app for todo management and lock-zone editing
- `backend/api`: Express + WebSocket API for todo persistence and overlay synchronization
- `shared/contracts`: Shared TypeScript types and validation schemas
- `desktop/overlay-agent`: WPF overlay client that tracks Slay the Spire 2 window and blocks clicks in locked rectangles

## Quick start

1. Install dependencies:
   - `npm install`
2. Run backend API:
   - `npm run dev:api`
3. Run web app:
   - `npm run dev:web`
4. Run Windows overlay agent from Visual Studio:
   - Open `desktop/overlay-agent/SlayTheList.OverlayAgent.sln`

Default local port is `8788` for API/WebSocket.

## One-click Batch Launcher

- Double-click `start-slaythelist.bat` from repo root.
- It starts API + web in separate terminals, checks for port conflicts, and opens the browser.
- To stop API + web + overlay together, run `stop-slaythelist.bat`.

## One-Click Launcher

If you want a single executable instead of running terminals, see:

- `docs/desktop-launcher.md`

## MVP constraints

- Supports windowed/borderless game modes.
- Manual todo completion drives lock/unlock state.
- AI todo expansion and screenshot verification are planned for phase 2.

## Validation

Use `docs/mvp-validation.md` for an end-to-end verification checklist.
