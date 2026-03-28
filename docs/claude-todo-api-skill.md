# SlayTheList API Guide (for Claude)

Use this when the user asks you to create, edit, complete, reorder, indent, archive, or delete todos, habits, predictions, or reflections in SlayTheList.

## How to connect

There are two ways to interact with SlayTheList depending on your context:

### Option A — MCP tools (Claude Code, preferred)

If you're running inside Claude Code, add this to the `.mcp.json` in your repo root (create it if it doesn't exist).

**From within the SlayTheList repo:**

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

**From another project:** Use absolute paths and **set `SLAYTHELIST_DATA_DIR`** so the MCP server finds the correct database. Without this env var, it defaults to `process.cwd()/data` — which will be the *calling* project's directory, not SlayTheList's, resulting in an empty database.

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

Restart Claude Code after adding this. The MCP server connects directly to the SQLite database — **the SlayTheList API server does not need to be running**.

Available MCP tools:

| Tool | Purpose |
|------|---------|
| `list_todos` | List todos. `status`: `"active"` (default) \| `"done"` \| `"all"`. `include_archived`: bool. |
| `create_todo` | Create a todo. Requires `title`. Optional: `context`, `deadline_at` (ISO 8601). |
| `update_todo` | Patch a todo by `id`. Optional: `title`, `context`, `status`, `deadline_at` (null to clear). |
| `delete_todo` | Permanently delete a todo by `id`. |
| `list_habits` | Returns all habits. |
| `set_habits` | Replaces full habits array (read → modify → write). |
| `list_predictions` | Returns all predictions. |
| `set_predictions` | Replaces full predictions array (read → modify → write). |
| `list_reflections` | Returns reflections, newest first. Optional `limit` (default 30). |
| `set_reflections` | Replaces full reflections array (read → modify → write). |

For habits/predictions/reflections the pattern is: call `list_*` → modify the array → call `set_*` with the full replacement array.

### Option B — HTTP API (any context)

Requires the SlayTheList API server to be running. See the rest of this doc.

---

## Morning predictions check (startup tip)

Once you have SlayTheList connected via MCP from your regular working directory (using the absolute-path setup above), here's a small thing you can do: add a morning check to the CLAUDE.md in that directory so Claude nudges you about your predictions at the start of each day.

Add this to the CLAUDE.md in your **default working directory** (not the SlayTheList folder — wherever you normally open Claude Code):

```
At the start of each conversation, check the current time. If it is before noon (12:00),
pull my pending predictions via list_predictions and offer to briefly talk through them —
either to add new ones or review existing ones. Also offer a quick Murphy-Jitsu check:
ask what could go wrong today or what failure modes I'd predict for my key goals, and
create those as predictions with murphy: true (and targetTitle set to the goal title if
it's goal-specific). Keep it short — just ask if I want to run through predictions
and/or Murphy-Jitsu.
```

Or just ask Claude to set it up:
> "Can you add a morning predictions and Murphy-Jitsu check to my CLAUDE.md? Before noon, remind me to review predictions and think through what might go wrong."

Claude will add the snippet for you.

### Murphy-Jitsu prediction fields

Murphy-Jitsu predictions use the same `Prediction` shape with two extra fields:

| Field | Type | Purpose |
|-------|------|---------|
| `murphy` | `boolean` | `true` marks this as a failure-mode / Murphy-Jitsu prediction |
| `targetTitle` | `string` (optional) | Links the prediction to a specific goal by title |

To add a general Murphy-Jitsu prediction (read → modify → write):

```powershell
$preds = (Invoke-RestMethod "$API/api/predictions").items
$preds += @{
  id          = [guid]::NewGuid().ToString()
  title       = "I'll get pulled into an unplanned meeting and lose focus"
  confidence  = 40
  outcome     = "pending"
  createdAt   = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  resolvedAt  = $null
  murphy      = $true
}
Invoke-RestMethod "$API/api/predictions" -Method PUT -ContentType "application/json" -Body ($preds | ConvertTo-Json -Depth 5)
```

To link a Murphy prediction to a specific goal, add `targetTitle = "Goal title here"` to the object above.

---

## Start the app first (HTTP API only)

Before making any API calls, make sure the local API is running from the repo root.

1. Start SlayTheList using one of these options:
   - API only: `npm run dev:api`
   - Browser workflow: run `npm run dev:api` and `npm run dev:web` in separate terminals
   - Desktop workflow: `npm run desktop:dev`
   - Windows launcher: double-click `launch-slaythelist.bat`
2. Verify the API is up before mutating data:
   - `(Invoke-RestMethod "http://localhost:8788/api/todos").items`

If startup fails because dependencies are missing, run `npm install` from the repo root and try again.

If the API call still fails, do not proceed with mutations until the user starts the app or you start the correct dev command.

## Runtime assumptions

- API base URL: `http://localhost:8788`
- Platform shell: PowerShell

## Endpoints

**Todos**
- `GET /api/todos`
- `POST /api/todos`
- `PATCH /api/todos/:id`
- `DELETE /api/todos/:id`
- `PUT /api/todos/reorder`

**Habits / Predictions / Reflections** (granular CRUD — do not replace entire state)
- `GET/POST/PATCH/DELETE /api/habits`
- `GET/POST/PATCH/DELETE /api/predictions`
- `GET/POST/PATCH/DELETE /api/reflections`

## Response shapes

All `GET` list endpoints return `{ items: [...] }`. Access the array via `.items`:

```powershell
$todos       = (Invoke-RestMethod "$API/api/todos").items
$habits      = (Invoke-RestMethod "$API/api/habits").items
$predictions = (Invoke-RestMethod "$API/api/predictions").items
$reflections = (Invoke-RestMethod "$API/api/reflections").items
```

`POST` and `PATCH` responses return the affected object directly.

## Todo fields

**POST** `/api/todos` accepts: `title` (required), `deadlineAt`, `deadlineTime`

**PATCH** `/api/todos/:id` accepts:
- `title: string`
- `context: string` (optional notes; empty string to clear — PATCH only, not available on POST)
- `status: "active" | "done"`
- `indent: number` (0 = top-level, 1+ = nested)
- `deadlineAt: string | null` (ISO timestamp)
- `deadlineTime: string` (optional `HH:mm` 24-hour, used with `deadlineAt`)
- `archived: boolean` (backend maps to archive timestamp)

## Hard rules

1. Always read first: call `GET /api/todos` before mutating.
2. After every mutation batch, read again with `GET /api/todos` to verify.
3. Prefer `PATCH` updates over delete+recreate (preserves IDs and relationships).
4. For hierarchy: set `indent` on the child, then call the reorder endpoint to place it correctly.
5. If a user instruction is ambiguous (e.g. two todos with same title), ask instead of guessing.
6. Never mutate lock zones unless the user explicitly asks for block/zone changes.

## PowerShell command templates

```powershell
$API = "http://localhost:8788"
```

Read todos:

```powershell
$todos = (Invoke-RestMethod "$API/api/todos").items
```

Create todo:

```powershell
Invoke-RestMethod "$API/api/todos" -Method POST -ContentType "application/json" -Body (@{
  title = "New todo"
  deadlineAt = $null
} | ConvertTo-Json)
```

Create todo with deadline time:

```powershell
Invoke-RestMethod "$API/api/todos" -Method POST -ContentType "application/json" -Body (@{
  title = "Prep meeting notes"
  deadlineAt = "2026-03-20"
  deadlineTime = "16:45"
} | ConvertTo-Json)
```

Mark done / active:

```powershell
Invoke-RestMethod "$API/api/todos/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  status = "done"   # or "active"
} | ConvertTo-Json)
```

Rename:

```powershell
Invoke-RestMethod "$API/api/todos/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  title = "Updated title"
} | ConvertTo-Json)
```

Set context/notes:

```powershell
Invoke-RestMethod "$API/api/todos/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  context = "Some extra notes"
} | ConvertTo-Json)
```

Set deadline:

```powershell
Invoke-RestMethod "$API/api/todos/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  deadlineAt = "2026-03-28"
  deadlineTime = "10:00"
} | ConvertTo-Json)
```

Set indent (make sub-todo):

```powershell
Invoke-RestMethod "$API/api/todos/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  indent = 1
} | ConvertTo-Json)
```

Archive / unarchive:

```powershell
Invoke-RestMethod "$API/api/todos/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  archived = $true   # or $false
} | ConvertTo-Json)
```

Delete:

```powershell
Invoke-RestMethod "$API/api/todos/<id>" -Method DELETE
```

Reorder:

```powershell
Invoke-RestMethod "$API/api/todos/reorder" -Method PUT -ContentType "application/json" -Body (@{
  orderedTodoIds = @("id-1","id-2","id-3")
} | ConvertTo-Json)
```

Create habit:

```powershell
Invoke-RestMethod "$API/api/habits" -Method POST -ContentType "application/json" -Body (@{
  name = "Daily planning"
  status = "active"  # active | idea | archived
} | ConvertTo-Json)
```

Update habit checks:

```powershell
Invoke-RestMethod "$API/api/habits/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  checks = @(
    @{ date = "2026-03-27"; done = $true }
  )
} | ConvertTo-Json -Depth 5)
```

Create prediction:

```powershell
Invoke-RestMethod "$API/api/predictions" -Method POST -ContentType "application/json" -Body (@{
  title = "Ship by Friday"
  confidence = 68
} | ConvertTo-Json)
```

Resolve prediction:

```powershell
Invoke-RestMethod "$API/api/predictions/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  outcome = "hit"  # pending | hit | miss
} | ConvertTo-Json)
```

Create reflection:

```powershell
Invoke-RestMethod "$API/api/reflections" -Method POST -ContentType "application/json" -Body (@{
  date = "2026-03-27"
  wins = "..."
  challenges = "..."
  notes = "..."
  tomorrow = "..."
} | ConvertTo-Json)
```

## Execution pattern

When asked to make todo changes:

1. Read todos via `GET /api/todos` → `.items`.
2. Resolve target IDs by exact title match; if multiple matches, ask the user.
3. Apply the minimal set of mutations.
4. If hierarchy/order changed, call the reorder endpoint.
5. Read todos again to verify.
6. Report what changed (titles, IDs, status, indent, order).

## Intent mapping

- "Add task X" → `POST /api/todos`
- "Complete task X" → `PATCH status=done`
- "Make Y a subtask of X" → `PATCH indent=1` on Y + `PUT /api/todos/reorder`
- "Delete task X" → `DELETE /api/todos/:id`
- "Archive completed tasks" → find done items, `PATCH archived=true` for each
