# SlayTheList Todo API Skill (for Claude)

Use this skill when the user asks you to create, edit, complete, reorder, indent, archive, or delete todos in SlayTheList via command line/API.

## Goal

Manage todos through the local SlayTheList API in a safe, deterministic way that keeps Block Setup and overlay lock state in sync.

## Runtime assumptions

- API base URL: `http://localhost:8788`
- Platform shell: PowerShell
- Todos API:
  - `GET /api/todos`
  - `POST /api/todos`
  - `PATCH /api/todos/:id`
  - `DELETE /api/todos/:id`
  - `PUT /api/todos/reorder`

## Hard rules

1. Always read first: call `GET /api/todos` before mutating.
2. After every mutation batch, read again with `GET /api/todos` to verify.
3. Prefer `PATCH` updates over delete+recreate (preserves IDs and relationships).
4. For hierarchy:
   - use `indent` (`0` top-level, `1+` nested),
   - then call reorder endpoint to place children under parents.
5. If a user instruction is ambiguous (for example two todos with same title), ask a clarification question instead of guessing.
6. Never mutate lock zones in this skill unless user explicitly asks for block/zone changes.

## Data model notes

- `status`: `"active"` or `"done"`
- `indent`: non-negative integer
- `deadlineAt`: ISO datetime string or `null`
- `deadlineTime`: optional `HH:mm` (24-hour), used with `deadlineAt`
- `archived`: boolean (passed on PATCH; backend maps it to archive timestamp)

## PowerShell command templates

Set base:

```powershell
$API = "http://localhost:8788"
```

Read current todos:

```powershell
Invoke-RestMethod "$API/api/todos"
```

Create todo:

```powershell
Invoke-RestMethod "$API/api/todos" -Method POST -ContentType "application/json" -Body (@{
  title = "New todo"
  deadlineAt = $null
} | ConvertTo-Json)
```

Create todo with explicit time:

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

Set deadline date + time:

```powershell
Invoke-RestMethod "$API/api/todos/<id>" -Method PATCH -ContentType "application/json" -Body (@{
  deadlineAt = "2026-03-28"
  deadlineTime = "10:00"
} | ConvertTo-Json)
```

Set indent:

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

## Execution pattern (required)

When asked to make todo changes:

1. Read todos.
2. Resolve target IDs by exact title match first; if multiple matches, ask user.
3. Apply minimal set of mutations.
4. If hierarchy/order changed, call reorder endpoint.
5. Read todos again.
6. Report what changed (titles, IDs, status, indent, order).

## Example intent mapping

- "Add task X" -> `POST /api/todos`
- "Complete task X" -> `PATCH status=done`
- "Make Y a subtask of X" -> `PATCH indent` for Y + `PUT /api/todos/reorder`
- "Delete task X" -> `DELETE /api/todos/:id`
- "Archive completed tasks" -> find done items, patch `archived=true` for each

