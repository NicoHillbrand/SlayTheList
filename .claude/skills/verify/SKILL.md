# Verify: SlayTheList web app

How to run an isolated copy of the app and drive it for verification.

## ⚠️ The user's live API is (almost) always running on port 8788

The overlay auto-starts on login. Its SQLite DB at `app/backend/api/data/slaythelist.db`
holds the user's **real** gold, todos, predictions, habits. Any test instance of the
web app that falls back to the default API base (`http://localhost:8788`) will read
and **write real data**.

Do not rely on `NEXT_PUBLIC_API_BASE_URL` set as a shell env var for isolation: it is
inlined at compile time, and in one session the override was lost after a mid-session
dev-server recompile — the test UI silently flipped to the live API and mutated real
gold. Instead:

1. Write the override to `app/frontend/web/.env.local` (Next re-reads it on restarts):
   `NEXT_PUBLIC_API_BASE_URL=http://localhost:8799` — **delete the file when done**
   (it would break the user's real dev runs).
2. In any browser driver, install a request guard before mutating anything:
   `page.on("request", r => { if (r.url().includes("8788")) throw new Error("hit live API!") })`
   or assert a sentinel (seed the isolated DB with a known odd gold value and check
   the header shows it before proceeding).

## Isolated stack

```bash
# API on 8799 with scratch data dir (server creates the sqlite db on boot)
cd app/backend/api && PORT=8799 SLAYTHELIST_DATA_DIR=<scratch>/data npx tsx src/server.ts

# Web on 3005 (after writing .env.local as above)
cd app/frontend/web && npx next dev -p 3005
```

`npm run typecheck` in `app/` builds contracts + combat-engine first — run it once
before starting if `app/shared/contracts` changed, since both servers import the built types.

Seed state over HTTP (no UI needed):
- `POST /api/gold/award {"amount":N}` — balance-only, no ledger entry
- `PUT /api/gold-state {"gold":N,"rewardedTodoIds":[]}`
- `PUT /api/accountability-state {"habits":[],"predictions":[],"reflections":[]}`
- Inspect ledger: `GET /api/gold/activity?days=N`

Note: resetting gold/accountability state does **not** clear the `gold_activity`
ledger table — repeated test runs accumulate duplicate-looking entries. Fresh scratch
data dir per scenario if ledger content matters.

## Driving the UI

No Playwright in the repo. `npm i playwright-core` in the scratchpad and launch with
`channel: "msedge"` (system Edge, no browser download). Gotchas:

- Headless Edge dies randomly mid-run (~20–60s in) on this machine. Keep driver
  scripts short, one scenario each, and retry on "Target page … has been closed".
- Row action buttons (Happened / Didn't happen / Delete) are hover-revealed
  (`.goal-actions` is `opacity: 0` until row hover): `await row.hover()` then
  `click({ force: true })`.
- Navigation: `goto(..., { waitUntil: "domcontentloaded" })` — the page polls, so
  `networkidle` is unreliable. Tabs are `.goals-subtab` buttons by name.
- Client → API writes are async fire-and-forget; wait ~900ms after a UI action
  before asserting balance via the API.
- Accountability state (predictions/habits) autosaves with a 450ms debounce —
  a page killed immediately after an action can lose that write.
