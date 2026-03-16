# API Usage For Claude Code (CLI)

This project already exposes a local HTTP API that an agent can call to manage todos.

Base URL (default): `http://localhost:8788`

## What Claude can do

- Create todo items
- Update title/status/deadline/indent/archive
- Delete todo items
- Reorder todos (for explicit parent/child grouping order)
- Read current todo list before deciding edits

## Endpoints (todos)

- `GET /api/todos` -> list all todos
- `POST /api/todos` -> create todo
- `PATCH /api/todos/:id` -> update todo fields
- `DELETE /api/todos/:id` -> delete todo
- `PUT /api/todos/reorder` -> apply explicit order

## Endpoints (granular accountability CRUD)

- Habits:
  - `GET /api/habits`
  - `POST /api/habits`
  - `PATCH /api/habits/:id`
  - `DELETE /api/habits/:id`
- Predictions:
  - `GET /api/predictions`
  - `POST /api/predictions`
  - `PATCH /api/predictions/:id`
  - `DELETE /api/predictions/:id`
- Reflections:
  - `GET /api/reflections`
  - `POST /api/reflections`
  - `PATCH /api/reflections/:id`
  - `DELETE /api/reflections/:id`

Updatable fields on `PATCH /api/todos/:id`:

- `title: string`
- `status: "active" | "done"`
- `indent: number` (0 for top-level, 1+ for sub-todos)
- `deadlineAt: string | null` (ISO timestamp)
- `deadlineTime: string` (optional, `HH:mm`, applied with `deadlineAt`)
- `archived: boolean`

## PowerShell command patterns

Use these directly in terminal:

```powershell
$API="http://localhost:8788"
```

List todos:

```powershell
Invoke-RestMethod "$API/api/todos"
```

Create todo:

```powershell
Invoke-RestMethod "$API/api/todos" -Method POST -ContentType "application/json" -Body (@{
  title = "Beat Act 1 pathing review"
  deadlineAt = $null
} | ConvertTo-Json)
```

Create todo with explicit time (local):

```powershell
Invoke-RestMethod "$API/api/todos" -Method POST -ContentType "application/json" -Body (@{
  title = "Submit application"
  deadlineAt = "2026-03-20"
  deadlineTime = "14:30"
} | ConvertTo-Json)
```

Mark done:

```powershell
Invoke-RestMethod "$API/api/todos/<todo-id>" -Method PATCH -ContentType "application/json" -Body (@{
  status = "done"
} | ConvertTo-Json)
```

Set indent (make sub-todo):

```powershell
Invoke-RestMethod "$API/api/todos/<todo-id>" -Method PATCH -ContentType "application/json" -Body (@{
  indent = 1
} | ConvertTo-Json)
```

Rename:

```powershell
Invoke-RestMethod "$API/api/todos/<todo-id>" -Method PATCH -ContentType "application/json" -Body (@{
  title = "Refine shop route notes"
} | ConvertTo-Json)
```

Update deadline date + time:

```powershell
Invoke-RestMethod "$API/api/todos/<todo-id>" -Method PATCH -ContentType "application/json" -Body (@{
  deadlineAt = "2026-03-25"
  deadlineTime = "09:15"
} | ConvertTo-Json)
```

Archive:

```powershell
Invoke-RestMethod "$API/api/todos/<todo-id>" -Method PATCH -ContentType "application/json" -Body (@{
  archived = $true
} | ConvertTo-Json)
```

Delete:

```powershell
Invoke-RestMethod "$API/api/todos/<todo-id>" -Method DELETE
```

Reorder:

```powershell
Invoke-RestMethod "$API/api/todos/reorder" -Method PUT -ContentType "application/json" -Body (@{
  orderedTodoIds = @(
    "id-top-1",
    "id-sub-1",
    "id-sub-2",
    "id-top-2"
  )
} | ConvertTo-Json)
```

Create habit:

```powershell
Invoke-RestMethod "$API/api/habits" -Method POST -ContentType "application/json" -Body (@{
  name = "Morning planning"
  status = "active"  # active | idea | archived
} | ConvertTo-Json)
```

Update habit checks:

```powershell
Invoke-RestMethod "$API/api/habits/<habit-id>" -Method PATCH -ContentType "application/json" -Body (@{
  checks = @(
    @{ date = "2026-03-12"; done = $true }
  )
} | ConvertTo-Json -Depth 5)
```

Create prediction:

```powershell
Invoke-RestMethod "$API/api/predictions" -Method POST -ContentType "application/json" -Body (@{
  title = "Finish review by Friday"
  confidence = 72
} | ConvertTo-Json)
```

Resolve prediction:

```powershell
Invoke-RestMethod "$API/api/predictions/<prediction-id>" -Method PATCH -ContentType "application/json" -Body (@{
  outcome = "hit" # pending | hit | miss
} | ConvertTo-Json)
```

Create reflection:

```powershell
Invoke-RestMethod "$API/api/reflections" -Method POST -ContentType "application/json" -Body (@{
  date = "2026-03-12"
  wins = "Finished key tasks"
  challenges = "Context switching"
  notes = "Better focus in the afternoon"
  tomorrow = "Start with hardest task first"
} | ConvertTo-Json)
```

## Recommended Claude workflow

1. `GET /api/todos`
2. Compute intended changes (create/update/reorder/delete)
3. Execute mutation calls
4. `GET /api/todos` again to verify result

This read-mutate-read loop avoids stale assumptions and keeps the UI/overlay in sync.
