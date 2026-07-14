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
| `update_todo` | Patch a todo by `id`. Optional: `title`, `context`, `status`, `deadline_at` (null to clear). |
| `delete_todo` | Permanently delete a todo by `id`. |

### Gold

| Tool | Purpose |
|------|---------|
| `get_gold` | Returns the current `GoldState` (`gold` balance + `rewardedTodoIds`). |
| `award_gold` | Add gold. Requires `amount` (non-negative integer). Optional: `title` — records a named achievement in the daily/shareable log (omit for a silent balance-only bump); `category` — `"Tasks"` \| `"Habits"` \| `"Encouragements"` \| `"Micro"` (small engagement rewards; collapsed into one running "⚡ Micro actions" total in the Tasks section of the log) (unknown/missing → `"Other"`); `source` — which agent submitted it (e.g. `"claude-code"`); `timestamp` — ISO 8601 to backdate; `with_sound: true` plays the gold coin sound in the overlay (best-effort — needs the API server running). |
| `spend_gold` | Deduct gold (clamps at zero, never negative). Requires `amount`. Optional `with_sound` like above. |

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
