# Templates

Tracked base files that ship with SlayTheList and keep receiving upstream
updates. Your filled-in copies live outside this folder and stay private, so your
content never conflicts with updates here.

- **`CLAUDE.md`** — the base agent-behavior instructions (modes, style, startup,
  todos, gold, logging). On setup it's copied to `../CLAUDE.md`, your private
  working copy; edit that one, not this.
- **document skeletons** — one per grounding document, each explaining what the
  live doc is for and how to structure it. To enable one, copy it to
  `../documents/<name>.md` and fill it out, ideally with the agent in a session.

Current document skeletons: `strategy`, `values`, `style-notes`,
`reflection-prompts`, `heuristics`, `projects`, `backlog`, `state-notes`.
`style-notes` ships
with real default content the agent uses as-is unless you override it with your
own copy in `../documents/`.
