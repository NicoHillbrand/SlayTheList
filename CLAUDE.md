# SlayTheList

Personal productivity overlay app. An MCP server is configured at `.mcp.json` that gives Claude direct read/write access to the user's todos, habits, predictions, and reflections.

## MCP Tools

### Todos
Individual rows with full CRUD:

| Tool | Purpose |
|------|---------|
| `list_todos` | List todos. `status`: `"active"` (default) \| `"done"` \| `"all"`. `include_archived`: bool, default false. |
| `create_todo` | Create a todo. Requires `title`. Optional: `context`, `deadline_at` (ISO 8601). |
| `update_todo` | Patch a todo by `id`. Optional: `title`, `context`, `status`, `deadline_at` (null to clear). |
| `delete_todo` | Permanently delete a todo by `id`. |

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
| `set_predictions` | Replaces full predictions array. |
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
  "targetTitle": "string | undefined"
}
```

`murphy: true` marks a prediction as a Murphy-Jitsu failure-mode prediction (what might go wrong). `targetTitle` links it to a specific goal by title when it's a per-goal failure mode. Regular predictions omit both fields.

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
      "cwd": "backend/api"
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
      "command": "/absolute/path/to/SlayTheList/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/SlayTheList/backend/api/src/mcp.ts"],
      "env": {
        "SLAYTHELIST_DATA_DIR": "/absolute/path/to/SlayTheList/backend/api/data"
      }
    }
  }
}
```

Restart Claude Code after adding/changing `.mcp.json`.

## Morning startup routine

At the start of each conversation, check the current time. If it is before noon (12:00), pull the user's pending predictions via `list_predictions` and offer to briefly talk through them — either to add new ones for the day or review existing ones. Also offer to run a quick Murphy-Jitsu check: ask what could go wrong today or what failure modes they'd predict for their key goals (create these as predictions with `murphy: true`, optionally with `targetTitle` set to the relevant goal). Keep it short: just mention you noticed it's still morning and ask if they want to run through predictions and/or Murphy-Jitsu.

## Notes

- The local API server (`backend/api`) must be running for overlay/game features but is **not** required for MCP — the MCP server connects directly to the SQLite database.
- If the data directory is non-default (e.g. you pass `--data-dir` or set `SLAYTHELIST_DATA_DIR` when running the API), set the same env var in `.mcp.json` so the MCP server reads the same database.
