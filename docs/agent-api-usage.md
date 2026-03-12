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

## Recommended Claude workflow

1. `GET /api/todos`
2. Compute intended changes (create/update/reorder/delete)
3. Execute mutation calls
4. `GET /api/todos` again to verify result

This read-mutate-read loop avoids stale assumptions and keeps the UI/overlay in sync.
