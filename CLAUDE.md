# SlayTheList

Personal productivity overlay app, plus a personal-agent workspace you talk to in Claude Code. An MCP server (`.mcp.json`) gives the agent direct read/write access to todos, habits, predictions, reflections, and gold.

## Where to open

This file loads in every session under the repo (it is an ancestor), so it stays short on purpose. Open the folder that matches your task:

- **Coding / app work:** open `app/`. It has its own `CLAUDE.md` with the repo layout, MCP tool contract, data shapes, and setup notes.
- **Agent sessions (you or an end user):** open `workspace/`. It has its own `CLAUDE.md` with the interaction modes, logging, and gold conventions.

```
SlayTheList/
├── app/          # all code + dev docs (open this for development)
├── workspace/    # personal-agent home (open this for agent sessions)
└── start.* / update.* / install.*   # launchers, updater, installers
```

## Workspace setup (bootstrap)

The workspace ships a tracked scaffold and keeps everything personal private:

- `workspace/templates/` is the tracked base that receives upstream updates: the agent-behavior `CLAUDE.md` and document skeletons.
- `workspace/CLAUDE.md` and `workspace/documents/` are the user's own copies, private and gitignored, so edits never conflict with updates.

**Agent instruction:** when a session opens `workspace/` and `workspace/CLAUDE.md` is missing, the workspace isn't set up yet. Offer to bootstrap it: copy `templates/CLAUDE.md` to `workspace/CLAUDE.md`, then walk the user through `templates/` and copy the document skeletons they want into `documents/`, filling them in conversationally. To update later, `git pull` refreshes `templates/`; offer to fold new changes into the user's private copies without clobbering their edits.
