# SlayTheList API Guide

How to reach SlayTheList's data programmatically. Two paths:

- **MCP tools (preferred, Claude Code):** the tool contract, data shapes, and
  `.mcp.json` setup live in [`../CLAUDE.md`](../CLAUDE.md). Use that inside
  Claude Code; the MCP server talks to the SQLite database directly and does
  **not** need the API server running.
- **HTTP API (any context):** requires the local API server to be running.
  Documented below.

## Starting SlayTheList

### Platform launchers (repo root)

| Platform | Script | Usage |
|----------|--------|-------|
| Windows | `start.bat` | Double-click for the GUI mode selector, or pass a CLI argument |
| macOS | `start.command` | Double-click in Finder, or run from terminal |
| Linux | `start.sh` | Run from terminal |

All launchers stop any previous instance before starting.

### CLI arguments

| Argument | Effect |
|----------|--------|
| `browser` | Start API + web app, open in browser |
| `desktop` | Start Electron desktop app |
| `stop` | Kill all running SlayTheList processes |

```bash
# Windows
start.bat browser
start.bat stop

# macOS / Linux
./start.sh browser
./start.sh stop
```

Windows `start.bat` with no argument opens a GUI mode selector (`scripts/launcher.vbs` → `scripts/launcher.ps1`); macOS/Linux show an interactive terminal prompt.

### npm scripts (run from `app/`)

| Command | What it starts |
|---------|---------------|
| `npm run dev:api` | API server only (port 8788) |
| `npm run dev:web` | Web frontend only (default port 4000) |
| `npm run desktop:dev` | Electron app (starts API + web internally) |
| `npm run desktop:package` | Build packaged desktop app |
| `npm run build` | Full production build |

For browser development, run `npm run dev:api` and `npm run dev:web` in separate terminals.

### Ports

| Service | Default port | Fallback |
|---------|-------------|----------|
| API | 8788 | Fixed |
| Web | 4000 | Auto-increments to next free port if 4000 is busy |

### Prerequisites

- Node.js v20+
- Run `install.bat` (Windows) or `./install.sh` (macOS/Linux) before first launch — installs npm dependencies and builds shared contracts.

### Overlay agents (optional)

Blocks game windows until todos are completed. Windows: `app/desktop/overlay-agent/` (.NET 8 WPF, self-contained). Linux: `app/desktop/overlay-agent-linux/` (Python 3 + tkinter venv). Neither is required for core functionality.

## HTTP API

### Start the app first

Before any API calls, make sure the local API is running (`start.bat browser`, `./start.sh`, or `npm run dev:api` from `app/`). Verify before mutating:

```powershell
(Invoke-RestMethod "http://localhost:8788/api/todos").items
```

If the call fails, don't proceed with mutations until the app is up. If startup fails on missing dependencies, run the install script and retry.

### Runtime assumptions

- API base URL: `http://localhost:8788`
- Shell: PowerShell (Windows) or bash (macOS/Linux)

### Endpoints

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

Walkthroughs have no dedicated endpoint over HTTP: they live inside the accountability state bundle (`GET`/`PUT /api/accountability-state`, modify the `walkthroughs` array). MCP is strongly preferred for walkthroughs.

### Response shapes

All `GET` list endpoints return `{ items: [...] }`:

```powershell
$todos       = (Invoke-RestMethod "$API/api/todos").items
$predictions = (Invoke-RestMethod "$API/api/predictions").items
```

`POST` and `PATCH` responses return the affected object directly.

### Todo fields

**POST** `/api/todos` accepts: `title` (required), `deadlineAt`, `deadlineTime`.

**PATCH** `/api/todos/:id` accepts:
- `title: string`
- `context: string` (optional notes; empty string to clear — PATCH only)
- `status: "active" | "done"`
- `indent: number` (0 = top-level, 1+ = nested)
- `deadlineAt: string | null` (ISO timestamp)
- `deadlineTime: string` (optional `HH:mm` 24-hour, used with `deadlineAt`)
- `archived: boolean` (backend maps to archive timestamp)

### Hard rules

1. Always read first: `GET /api/todos` before mutating.
2. After every mutation batch, read again to verify.
3. Prefer `PATCH` over delete+recreate (preserves IDs and relationships).
4. For hierarchy: set `indent` on the child, then call the reorder endpoint.
5. If an instruction is ambiguous (e.g. two todos with the same title), ask instead of guessing.
6. Never mutate lock zones unless the user explicitly asks for block/zone changes.

### PowerShell command templates

```powershell
$API = "http://localhost:8788"
```

Read todos:

```powershell
$todos = (Invoke-RestMethod "$API/api/todos").items
```

Create todo (optionally with a deadline time):

```powershell
Invoke-RestMethod "$API/api/todos" -Method POST -ContentType "application/json" -Body (@{
  title = "Prep meeting notes"
  deadlineAt = "2026-03-20"
  deadlineTime = "16:45"
} | ConvertTo-Json)
```

Mark done / active, rename, set context, set deadline, set indent, archive:

```powershell
Invoke-RestMethod "$API/api/todos/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  status = "done"        # or "active"
  # title = "Updated title"
  # context = "Some extra notes"
  # deadlineAt = "2026-03-28"; deadlineTime = "10:00"
  # indent = 1
  # archived = $true      # or $false
} | ConvertTo-Json)
```

Delete / reorder:

```powershell
Invoke-RestMethod "$API/api/todos/<id>" -Method DELETE
Invoke-RestMethod "$API/api/todos/reorder" -Method PUT -ContentType "application/json" -Body (@{
  orderedTodoIds = @("id-1","id-2","id-3")
} | ConvertTo-Json)
```

Create prediction / resolve it:

```powershell
Invoke-RestMethod "$API/api/predictions" -Method POST -ContentType "application/json" -Body (@{
  title = "Ship by Friday"; confidence = 68
} | ConvertTo-Json)

Invoke-RestMethod "$API/api/predictions/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  outcome = "hit"        # pending | hit | miss
} | ConvertTo-Json)
```

Create habit / update checks:

```powershell
Invoke-RestMethod "$API/api/habits" -Method POST -ContentType "application/json" -Body (@{
  name = "Daily planning"; status = "active"   # active | idea | archived
} | ConvertTo-Json)

Invoke-RestMethod "$API/api/habits/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  checks = @(@{ date = "2026-03-27"; done = $true })
} | ConvertTo-Json -Depth 5)
```

### Execution pattern

1. Read todos via `GET /api/todos` → `.items`.
2. Resolve target IDs by exact title match; if multiple match, ask the user.
3. Apply the minimal set of mutations.
4. If hierarchy/order changed, call the reorder endpoint.
5. Read again to verify.
6. Report what changed (titles, IDs, status, indent, order).

### Intent mapping

- "Add task X" → `POST /api/todos`
- "Complete task X" → `PATCH status=done`
- "Make Y a subtask of X" → `PATCH indent=1` on Y + `PUT /api/todos/reorder`
- "Delete task X" → `DELETE /api/todos/:id`
- "Archive completed tasks" → find done items, `PATCH archived=true` for each
