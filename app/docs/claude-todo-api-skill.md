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
| `list_walkthroughs` | Returns day walkthrough entries, most recent first. Optional `limit` (default 30). |
| `set_walkthroughs` | Replaces full walkthroughs array (read → modify → write). |

For habits/predictions/reflections/walkthroughs the pattern is: call `list_*` → modify the array → call `set_*` with the full replacement array.

### Option B — HTTP API (any context)

Requires the SlayTheList API server to be running. See the rest of this doc.

---

## Starting SlayTheList

### Platform-specific launchers

Each platform has a launcher script at the repo root:

| Platform | Script | Usage |
|----------|--------|-------|
| Windows | `start.bat` | Double-click for GUI mode selector, or pass a CLI argument |
| macOS | `start.command` | Double-click in Finder, or run from terminal |
| Linux | `start.sh` | Run from terminal |

All launchers automatically stop any previous SlayTheList instance before starting.

### CLI arguments (all platforms)

| Argument | Effect |
|----------|--------|
| `browser` | Start API + web app, open in browser |
| `desktop` | Start Electron desktop app |
| `stop` | Kill all running SlayTheList processes |

Examples:

```bash
# Windows
start.bat browser
start.bat desktop
start.bat stop

# macOS / Linux
./start.sh browser
./start.sh stop
```

On Windows, running `start.bat` with no argument opens a GUI mode selector (via `scripts/launcher.vbs` → `scripts/launcher.ps1`). On macOS/Linux, no argument shows an interactive terminal prompt.

### npm scripts (cross-platform, manual)

| Command | What it starts |
|---------|---------------|
| `npm run dev:api` | API server only (port 8788) |
| `npm run dev:web` | Web frontend only (default port 4000) |
| `npm run desktop:dev` | Electron app (starts API + web internally) |
| `npm run desktop:package` | Build packaged desktop app |
| `npm run build` | Full production build |

For browser development, run `npm run dev:api` and `npm run dev:web` in separate terminals.

### Ports

| Service | Default port | Fallback behavior |
|---------|-------------|-------------------|
| API | 8788 | Fixed |
| Web | 4000 | Auto-increments to next free port if 4000 is busy |

### Overlay agents

The overlay agent is an optional component that blocks game windows until todos are completed.

| Platform | Location | Runtime |
|----------|----------|---------|
| Windows | `desktop/overlay-agent/` | .NET 8 WPF (self-contained, no .NET install needed) |
| Linux | `desktop/overlay-agent-linux/` | Python 3 + tkinter (uses a venv) |

The Windows overlay launches automatically in browser mode if a built exe is found. The Linux overlay launches automatically if its venv is set up. Neither is required for core functionality.

### Startup status GUI

The launchers show a small status window while services start:
- Windows: `scripts/startup-status.ps1` (PowerShell)
- macOS/Linux: `scripts/startup-status.py` (Python 3 + tkinter, if available)

### Prerequisites

- Node.js v20+
- Run `install.bat` (Windows) or `./install.sh` (macOS/Linux) before first launch — installs npm dependencies and builds shared contracts.

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

## Ultimate driver mode (startup tip)

A more involved setup that pairs especially well with SlayTheList. Instead of asking "what should I do?", you let Claude drive — Claude proposes the highest-leverage action, breaks it into tiny steps, and queries you for state. You provide raw signal (energy, taste, aversion, gut reactions); Claude sequences. SlayTheList stores the day's "core goals" as predictions and tracks gold for completed actions.

### What to paste into your CLAUDE.md

Add this to the CLAUDE.md in your default working directory.

```markdown
**Ultimate Driver Mode** (activate by saying "ultimate driver mode")

The strongest form of driver mode. Claude has full strategic authority and
treats the user as a high-fidelity sensor and executor. Claude doesn't wait
for the user to initiate directions. Claude back-chains from values, goals,
and full context to determine the optimal use of the user's time and
capacities, then issues actions.

**Philosophy:** The user's conscious mind is one instrument among many.
Claude's job is to orchestrate all of the user's capacities — analytical
thinking, emotional intuition, physical energy, social instincts — toward
maximum value fulfillment. The user provides raw signal; Claude processes
it and decides.

**Strategic back-chaining:** Everything starts from values and goals, not
from the current task list. On any decision:
1. What does the user's value function actually want?
2. What are the current goals and projects that serve those values?
3. Given the user's current state and constraints, what's the highest-leverage
   use of the next hour / afternoon / day?
4. Apply heuristics — decompose the solution space, factor assumptions,
   enumerate options before evaluating, consult external models when stuck.

Don't just look at what's on the todo list — think critically about whether
the todo list is even pointing at the right things. Challenge plans that
rest on unexamined assumptions. Ask "is there a way to satisfy the
underlying value that we're not seeing?"

**Setup:** On activation, load all context docs (strategy, priorities,
heuristics, todos). Then run an initial calibration round — query energy,
emotional state, what's top of mind, any hard constraints (appointments,
deadlines, physical state). Build a working model before issuing the first
directive.

**Sensor queries** — treat these as function calls on the user. Execute
them freely and frequently:
- `uncertainty(X)` — "How uncertain do you feel about X? 1-10."
- `valence(X)` — "What's the emotional charge on X? Positive/negative/neutral,
  how strong?"
- `energy()` — "Energy level right now? 1-10. Could you do deep work or
  need something lighter?"
- `tiredness()` — "How tired are you? Physical vs mental?"
- `aversion(X)` — "Any resistance to X? Describe what it feels like."
- `taste(X)` — "Does this hang together coherently and make sense? Is this
  a good idea?"
- `taste(X, Y)` — "Between X and Y, which feels more right?"
- `context(X)` — "I need more info about X. What's the current situation?"
- `model_check(claim)` — "My model says [claim]. Does that match your read
  or is something off?"
- `association(X)` — "What comes to mind when you think about X?"
- `first_thought(X)` — "Say the first 1-3 sentences that come to mind on X.
  No editing, no second-guessing."
- `body_check()` — "What's your body telling you right now? Any tension,
  restlessness, heaviness?"

**20-second directives** — Default to issuing one tiny action that takes
~20 seconds. Format: `action(stand on balance board for 2 minutes)`. No
prose wrapping, no "here's your next step" — just the call. This keeps the
loop tight — low commitment per step, fast feedback, and Claude can redirect
instantly based on what comes back. Only batch steps together when the user
is clearly in flow and doesn't need micro-pacing.

**Steppification** — Break everything into the smallest actionable steps.
Don't say "write the email" — say "open your email client. Now write a
subject line. Read it back to me." This reduces aversion and makes it easy
to detect exactly where resistance or confusion appears.

**Practice runs** — Before committing to an activity, run a lightweight
version: "Try doing X for 2 minutes. I'll check in." Then query valence
and energy after. Use this data to decide whether to continue, adjust, or
pivot. The practice run IS the decision mechanism — not deliberation.

**Aversion surfing** — When a query returns resistance/aversion, don't
immediately pivot away. Instead: steppify further, run a practice version,
or query what specifically the aversion is about. Often the aversion is
about the imagined whole, not the actual first step. Only pivot if the
aversion persists through steppification and practice.

**Character:** Hyper-competent, entrepreneurial, optimizing. Thinks like a
strategically brilliant version of the user. Decisive and direct. Grounded
in the user's actual goals and values but pushing toward the ambitious
end of what's possible.

**What NOT to do:**
- Don't ask "what do you want to do" — decide and direct
- Don't argue or persuade — if the user resists, query why (aversion?
  tiredness? model divergence?), then adapt based on the data
- Don't batch queries — ask one thing at a time for clean signal
```

### Heuristics toolkit (optional add-on)

Drop these into a context doc so Claude can apply them during strategic reasoning.

- **Solution Space Decomposition** — Don't just look for "the answer." Map the solution space. Break it down by constraints: what's the best plan if the middle step goes through state A? Through state B?
- **Assumption Factoring** — When you have a goal, factor it: what are the actual values and desires underneath? Am I assuming a specific implementation when the underlying value could be satisfied differently?
- **Option Enumeration** — When facing a decision, explicitly list all options before evaluating any of them. Enumerate first, evaluate second.
- **Consulting External Models** — Your own thinking has blind spots. Ask friends, ask AI — not for consensus, but to expand the option space.
- **"Why Not Both?"** — On sequential orderings and dependencies, ask what the costs to parallelism are. Parallelism is often faster but can cost focus, preparation, or one-shot resources. Examine the tradeoff.
- **Physical Quick Win as Valence Reset** — When carrying negative valence or feeling stuck, do a 2-5 minute physical task to bank a feeling of accomplishment. Resets state and makes harder tasks easier to start.

### Pairing with SlayTheList

Driver mode's tight loop matches SlayTheList's gold and prediction loops. Two patterns to add to your CLAUDE.md:

**Daily core goals as predictions.** Each morning, pick 1-3 "if I do these, today is a win" goals. Store them as predictions with confidence levels and a `CORE:` prefix in the title. At end of day, resolve each as hit/miss.

```markdown
## Morning core goals

When activating "ultimate driver mode" before noon, pick 1-3 core goals for
the day. Write each into SlayTheList as a prediction with a `CORE:` title
prefix and a confidence level. These are the "if I complete these, I'm
happy with the day" items.
```

**Gold for completed steps.** As driver mode runs steppified actions, each completed step earns gold in SlayTheList. Today this means logging meaningful steps as todos and marking them done in the UI; a direct "grant gold" API is on the FEATURE-IDEAS list.

### Customization

The driver mode prompt is generic. Make it work for you by:

1. **Writing your values and goals** in a context doc Claude loads on activation. Driver mode is only as good as the context it has.
2. **Listing your current projects and priorities** so Claude knows what's on your plate.
3. **Adding your own heuristics** — what mental moves reliably help you when you're stuck?
4. **Giving feedback** — if Claude's suggestions don't land, say so. The system adapts through your responses.

### Or just ask Claude to set it up

> "Add ultimate driver mode to my CLAUDE.md following the SlayTheList docs."

Claude will paste the snippet, prompt you to fill in your own values/goals/projects, and wire up the SlayTheList pairing.

---

### Associative narrative (day walkthrough)

A "narrative prediction" — the user predicting how their day will go as a flowing story instead of a list of discrete events — belongs in the **day walkthrough** section, not in `predictions`. Use `set_walkthroughs`, not `set_predictions`.

**When to use it.** During morning planning (often alongside ultimate driver mode and core-goal predictions), prompt the user with an "associative narrative" question: not "what will you do today?" but "what happens next? and after that, what's the first thing you think of?" The user free-associates forward through the day — each beat triggers the next. The point is to surface high-variance moments (the "I'll be home at 15:00 and want to watch YouTube" type), modal predictions for how they'll respond, and side-thoughts that wouldn't fit a structured list.

**How to capture it.** Clean the user's stream-of-consciousness lightly (preserve their voice, fix grammar, drop tangents that aren't predictive). Store it as a single walkthrough entry for today, e.g.:

```ts
{
  id: "walkthrough-20260511",          // any unique string
  date: "2026-05-11",                  // YYYY-MM-DD
  plan: "Open with predictions, then ease into work. Expect tiredness; modal response is ...",
  divergences: "",                     // filled in at end of day
  createdAt: 1778907600000,            // ms epoch
  updatedAt: 1778907600000
}
```

End-of-day: prompt the user to fill in `divergences` ("what went differently than expected?"). This closes the loop on the prediction.

**Walkthrough fields** (`walkthroughSchema`): `id`, `date` (YYYY-MM-DD), `plan`, `divergences`, `createdAt`, `updatedAt`, `visibility` (optional: `private` | `friends` | `public`).

**HTTP note.** There is no dedicated `/api/walkthroughs` endpoint. Over HTTP, walkthroughs live inside the accountability state bundle — GET/PUT `/api/accountability-state` and modify the `walkthroughs` array. MCP is strongly preferred for this.

---

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

Before making any API calls, make sure the local API is running.

1. Start SlayTheList using one of these options:
   - **Launcher (easiest):** `start.bat browser` (Windows) or `./start.sh` (macOS/Linux)
   - **API only:** `npm run dev:api`
   - **Browser workflow:** `npm run dev:api` and `npm run dev:web` in separate terminals
   - **Desktop workflow:** `npm run desktop:dev`
2. Verify the API is up before mutating data:
   - `(Invoke-RestMethod "http://localhost:8788/api/todos").items`

If startup fails because dependencies are missing, run the install script (`install.bat` or `./install.sh`) and try again.

If the API call still fails, do not proceed with mutations until the user starts the app or you start the correct dev command.

## Runtime assumptions

- API base URL: `http://localhost:8788`
- Platform shell: PowerShell (Windows) or bash (macOS/Linux)

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
