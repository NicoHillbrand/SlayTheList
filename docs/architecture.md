# Architecture

SlayTheList MVP has three cooperating runtimes:

1. Browser UI (`frontend/web`) for todos and lock-zone setup.
2. Local API (`backend/api`) for persistence and live state distribution.
3. Windows overlay agent (`desktop/overlay-agent`) for game window tracking and click blocking.

## Data flow

1. User creates todos and lock zones in the web app.
2. Web app calls API endpoints to persist data in SQLite.
3. API recomputes lock states and broadcasts via WebSocket.
4. Overlay agent receives lock state and updates blocking rectangles.
5. User completes todos, API recalculates lock states, overlay unlocks matching zones.

## Recovery behavior

- API persists todos, zones, and mappings in SQLite (`backend/api/data/slaythelist.db`).
- On restart, API reloads state and immediately serves consistent lock state.
- Overlay reconnects with exponential backoff to recover from API restarts.
