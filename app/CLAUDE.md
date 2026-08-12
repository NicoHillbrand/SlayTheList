# SlayTheList — App / Development

Development context for the SlayTheList codebase. This file loads when you open
`app/` in Claude Code, so it stays out of end-user agent sessions (which open
`workspace/`). Open this folder for any coding work.

For the HTTP API path, app-startup/launcher details, and PowerShell command
templates, see [`docs/api-guide.md`](docs/api-guide.md). The MCP tool contract
and data shapes below are the fast path for agents.

## Repo Layout

```
SlayTheList/
├── app/          # all code: npm monorepo root (backend/, frontend/, shared/,
│                 # desktop/, scripts/, deploy/, assets/, docs/, FEATURE-IDEAS.md)
├── workspace/    # personal-agent home — open THIS folder in Claude Code for
│                 # agent sessions; has its own CLAUDE.md (modes, logging) and a
│                 # private-by-default gitignore
├── start.bat / start.sh / start.command   # launchers (entry points stay top-level)
├── update.bat / install*.bat|sh           # updater / installers
└── CLAUDE.md / README.md / .mcp.json
```

Run npm commands from `app/` (e.g. `cd app; npm run dev:web`). The top-level scripts redirect into `app/` themselves.

## MCP Tools

### Todos
Individual rows with full CRUD:

| Tool | Purpose |
|------|---------|
| `list_todos` | List todos. `status`: `"active"` (default) \| `"done"` \| `"all"`. `include_archived`: bool, default false. |
| `create_todo` | Create a todo. Requires `title`. Optional: `context`, `deadline_at` (ISO 8601). |
| `update_todo` | Patch a todo by `id`. Optional: `title`, `context`, `status`, `deadline_at` (null to clear). Setting `status: "done"` on a not-yet-completed todo **pays `GOLD_PER_TODO` (5) automatically** and records it in `rewardedTodoIds` — do not follow up with `award_gold`, that double-counts. |
| `delete_todo` | Permanently delete a todo by `id`. |

### Gold

| Tool | Purpose |
|------|---------|
| `get_gold` | Returns the current `GoldState` (`gold` balance + `rewardedTodoIds`). |
| `list_gold_activity` | Read the gold-activity ledger — what actually earned/spent gold, with per-entry `delta`, `createdAt`, `sourceType`, and `label`. Returns `earnedToday`, `balance`, and `days` (grouped by local day, newest first). `days`: how many recent days (default 7, max 365). `since` (ISO 8601): also returns `sinceEntries` (flat list, `createdAt >= since`) and `earnedSince` (sum of their positive deltas) — use to reconcile UI completions into a session footer. |
| `award_gold` | Add gold. Requires `amount` (non-negative integer). Optional: `title` — records a named achievement in the daily/shareable log (omit for a silent balance-only bump); `category` — `"Tasks"` \| `"Habits"` \| `"Encouragements"` \| `"Micro"` (small engagement rewards; collapsed into one running "⚡ Micro actions" total in the Tasks section of the log) (unknown/missing → `"Other"`); `source` — which agent submitted it (e.g. `"claude-code"`); `timestamp` — ISO 8601 to backdate; `with_sound: true` plays the gold coin sound — see the caveat below. |
| `award_micro` | Record micro-actions in **tenths** of a gold — the fast sub-tick between finished todos. Requires `tenths` (positive integer). Optional `label`, `source`, `with_sound`. Ten tenths **roll over into 1 real gold automatically** (do not follow up with `award_gold`); every `MICRO_TENTHS_PER_DRAW` (3) buys one extra card draw in The Crawl. Unspent tenths expire at midnight. Returns `tenths`, `goldPaid` (today's rollover watermark), `goldAwarded` (paid by this call), and the resulting `gold`. |
| `spend_gold` | Deduct gold (clamps at zero, never negative). Requires `amount`. Optional `with_sound` like above. |

**`with_sound` caveat:** it broadcasts a `play_sound` event over the API's
WebSocket, and the only listener is the **main web app window** (`page.tsx`). The
overlay panels do not listen, so with just the overlay open the flag is silently a
no-op. It has never been otherwise — the listener was added in one place when the
event was introduced and nothing removed it.

### The Crawl (overlay dungeon run)

| Tool | Purpose |
|------|---------|
| `get_crawl` | Read the run: floor/room, HP, current enemy, hand and deck, energy left today, `drawCredits` / `microTenthsToday` (extra draws bought by `award_micro`), and any pinned todo (`ward`, plus the enemy's remaining shield in `state.enemy.ward`). |
| `ward_crawl_on_todo` | Pin a todo to the run. While it is not `done` the **current enemy is warded**: it absorbs `WARD_AMOUNT` (5) damage, refilled every enemy turn. Nothing is blocked — cards still play, rooms still open. Finishing it shatters the shield immediately. Pass `todo_id: null` to clear. Create the todo with `create_todo` first. |

The design in one line: **energy is the gold you earned today** (a mirror of the
ledger, expiring at midnight — playing never lowers the real balance), and
**wards are todos**. Both are minted by real work only. Clearing the boss pays 10
gold back into the ledger. See `shared/crawl-engine` for the rules and
`pacing.test.ts` for the balance guards.

**Why a ward and not a lock.** This was a hard freeze until 2026-08-12: a pinned
todo stopped every action. That got the incentive backwards — with the run frozen,
finishing the todo only *removes a wall*, when it should be what *earns a good
turn*. Warding the enemy instead means the player can always act, their damage is
just being eaten, and the moment the work lands their next card hits at full
weight. Two guards in `pacing.test.ts` hold the line: a pinned run is never
blocked, and a warded fight still progresses (just measurably slower). Nothing in
the crawl freezes on a todo any more.

**Micro-gold buys draws, not energy.** `award_micro` mints draw credits at 3
tenths each, and spending one (`POST /api/crawl/draw`) pulls a card *above* the
`HAND_SIZE` (4) a turn refills to — that overflow is the "extend your turn"
effect. It costs no energy and does not give the enemy a turn. Cards still cost
energy to play, so a day of nothing but micro-actions widens the hand and advances
the run not at all; `pacing.test.ts` guards exactly that. Micro buys OPTIONS,
finished work buys POWER.

Draws stop at `HAND_LIMIT` (5) and refuse rather than spending the credit, so it
stays banked. Five is not a balance number — it is what fits on one row at 340px,
and a hand that wraps makes the window taller every time you draw.

When suggesting sub-tasks in a session, `ward_crawl_on_todo` is how a suggestion
becomes the thing that earns a good turn. It is now safe to use freely — a ward
the user never finishes costs them damage, not their run, and it retires by itself
when they leave the room.

### Current step (overlay display)

| Tool | Purpose |
|------|---------|
| `set_current_step` | Write the one-line "what to do right now" shown in the overlay. Requires `text` (`null` clears it). Optional `subtitle`, `source`. Setting a new step **replaces** the old one — there is only ever one. |
| `complete_current_step` | Mark it done, which removes it from the overlay. Stamps `doneAt` and keeps the row. Idempotent. |
| `get_current_step` | Read it back, or `null`. Also returns `age`: `"fresh"` \| `"stale"` (>45 min, shown dimmed) \| `"expired"` (>4 h, not rendered). A non-null `doneAt` means it was completed and is no longer displayed. |

**This is a display, not a gate.** It freezes nothing and gates no card or room.
`ward_crawl_on_todo` is what makes the run respond; this just puts the driver-mode
next step where the user is already looking instead of only in the chat window.

**Retiring it is the agent's job.** There is no user dismissal — deliberately, since
a step the user can swat away says nothing about whether the work happened, and the
agent that set it is the thing that knows. So a step leaves the overlay in exactly
three ways: `complete_current_step`, being replaced by the next `set_current_step`,
or `text: null`. Ageing is only the backstop for an agent that forgot.

The design constraint is *not adding noise*, since a second thing competing for
attention makes the overlay worse rather than better. So: one short imperative
line (truncated, never wrapped), nothing animated, and switchable off entirely via
the `showCurrentStep` setting. It also **ages on purpose** — dimmed after 45
minutes, gone after 4 hours — because a stale instruction is worse than none.

Thresholds and the `currentStepAge()` helper live in `shared/contracts`. `doneAt`
is set by `complete_current_step` and is what the later payout work (driver-mode
objectives) hangs off — a completed step is withheld from the overlay payload
server-side rather than filtered in the UI, so the surface never receives one it
should not show.

**It never polls.** The step rides the `overlay_state` WebSocket broadcast, which
the API already sends on every mutation and immediately on socket connect, so the
overlay gets it pushed. An MCP write talks straight to SQLite and so cannot
broadcast; `set_current_step` therefore pokes `POST /api/overlay/refresh`
(best-effort) to make it land at once instead of on the next 5s heartbeat. That
endpoint is general — it is the way any MCP write can reach an open UI.

### Habits, Predictions, Reflections
These are stored as JSON arrays. The pattern for any modification is **read → modify → write**:
1. Call `list_habits` / `list_predictions` / `list_reflections` to get the current array.
2. Modify the array in memory (add, update, or remove items).
3. Call `set_habits` / `set_predictions` / `set_reflections` with the full replacement array.

| Tool | Purpose |
|------|---------|
| `list_habits` | Returns all habits. |
| `set_habits` | Replaces full habits array. |
| `list_predictions` | Returns all predictions. |
| `set_predictions` | Replaces full predictions array. Stake-aware — see below. |
| `list_reflections` | Returns reflections, newest first. Optional `limit` (default 30). |
| `set_reflections` | Replaces full reflections array. |

## Data Shapes

### Todo
```json
{
  "id": "uuid",
  "title": "string",
  "context": "string | undefined",
  "status": "active | done",
  "indent": 0,
  "sortOrder": 0,
  "deadlineAt": "ISO string | null",
  "archivedAt": "ISO string | null",
  "completedAt": "ISO string | null",
  "createdAt": "ISO string",
  "updatedAt": "ISO string"
}
```

### Habit
```json
{
  "id": "uuid",
  "name": "string",
  "status": "active | archived | idea",
  "checks": [{ "date": "YYYY-MM-DD", "done": true }],
  "createdAt": 1700000000000
}
```

### Prediction
```json
{
  "id": "uuid",
  "title": "string",
  "confidence": 75,
  "outcome": "pending | hit | miss",
  "createdAt": 1700000000000,
  "resolvedAt": 1700000000000,
  "murphy": false,
  "targetTitle": "string | undefined",
  "logDate": "YYYY-MM-DD | undefined",
  "stake": 5,
  "payout": 8
}
```

`murphy: true` marks a prediction as a Murphy-Jitsu failure-mode prediction (what might go wrong). `targetTitle` links it to a specific goal by title when it's a per-goal failure mode. Regular predictions omit both fields.

`logDate` (optional) overrides which day the prediction appears under in the daily log. Without it, resolved predictions group by their resolution day and pending ones by the day they were made. Set it to move a prediction to the day it actually belongs — never re-date `createdAt`/`resolvedAt` for that; those record when things really happened.

`stake` (optional, gold) escrows gold on a prediction. `set_predictions` handles the gold movements server-side, mirroring the app UI:

- **Adding `stake` to a new/pending prediction** deducts that much gold immediately (clamped to the current balance) and writes a "Staked N on …" ledger entry. Do not deduct gold yourself.
- **While a stake is pending**, `confidence` and `stake` are locked — changes to them are ignored.
- **Resolving a staked prediction** (`outcome` pending → `hit`/`miss`) computes `payout` server-side and awards it. Never set `payout` yourself on a live resolution — it is overwritten. Scoring is quadratic: break-even at 50% confidence, up to 2× the stake back when confident and right, down to 0 when confidently wrong.
- **Resolved staked predictions are frozen** — outcome/stake/payout/confidence can't be changed afterwards.
- **Removing a pending staked prediction** from the array refunds the stake silently (no ledger entry).
- **History backfill**: a prediction written already-resolved with both `stake` and `payout` is stored as-is with no gold movement.

The tool result reports `staked`, `paidOut`, `refunded`, and the resulting `gold` balance.

### CrawlState

Full shape in `shared/crawl-engine/src/types.ts`. The fields that matter when
reasoning about a run:

```json
{
  "floor": 1, "room": 0,
  "status": "fighting | reward | dead | victory",
  "hp": 40, "maxHp": 40, "block": 0, "strength": 0,
  "playedThisTurn": false,
  "deck": ["strike", "..."], "hand": ["..."],
  "enemy": { "name": "Cellar Rat", "hp": 18, "attack": 4, "ward": 0, "turnsUntilHeavy": 3, "boss": false },
  "energyDay": "YYYY-MM-DD", "energyUsed": 0, "drawsUsed": 0,
  "wardTodoId": "uuid | null", "wardTodoTitle": "string | null"
}
```

Two rules that are easy to get wrong: HP resets in full every room (it measures
one fight, not the run), and the enemy only swings in response to a played card
— `playedThisTurn: false` means nothing can hurt the player, so an idle run is
never in danger.

`energyDay` covers both daily pools: `energyUsed` and `drawsUsed` are zeroed
together when the day rolls over.

### ReflectionEntry
```json
{
  "id": "uuid",
  "date": "YYYY-MM-DD",
  "prompts": {
    "wins": "string",
    "challenges": "string",
    "learnings": "string",
    "tomorrow": "string",
    "gratitude": "string"
  },
  "items": { "<key>": ["string"] },
  "wins": "string",
  "challenges": "string",
  "notes": "string",
  "tomorrow": "string",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
```

Note: `prompts` and `items` are optional legacy/extended fields. The top-level `wins`, `challenges`, `notes`, and `tomorrow` are always present.

## MCP Setup

### From within this repo

The `.mcp.json` in this repo uses relative paths:

```json
{
  "mcpServers": {
    "slaythelist": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "app/backend/api"
    }
  }
}
```

### From another project

Use absolute paths to the `tsx` binary and `mcp.ts` entry point, and **set `SLAYTHELIST_DATA_DIR`** to point at the SlayTheList data directory. Without this, the MCP server defaults to `process.cwd()/data` — which will be the *calling* project's directory, not SlayTheList's, resulting in an empty database.

```json
{
  "mcpServers": {
    "slaythelist": {
      "command": "/absolute/path/to/SlayTheList/app/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/SlayTheList/app/backend/api/src/mcp.ts"],
      "env": {
        "SLAYTHELIST_DATA_DIR": "/absolute/path/to/SlayTheList/app/backend/api/data"
      }
    }
  }
}
```

Restart Claude Code after adding/changing `.mcp.json`.

## Notes

- The local API server (`app/backend/api`) must be running for overlay/game features but is **not** required for MCP — the MCP server connects directly to the SQLite database.
- If the data directory is non-default (e.g. you pass `--data-dir` or set `SLAYTHELIST_DATA_DIR` when running the API), set the same env var in `.mcp.json` so the MCP server reads the same database.
