# SlayTheList Agent Workspace

This folder is the home of your personal agent. Open **this folder** in Claude
Code — the agent picks up these instructions plus the SlayTheList MCP tools
(todos, habits, predictions, gold, reflections) and works with you
conversationally: talking through your day, managing todos, running structured
modes.

Everything you create in here is **private by default**: only this file, the
templates, and the folder READMEs are tracked in git (see `.gitignore`). Your
filled-in documents, logs, and archives never leave your machine.

## Layout

```
workspace/
├── CLAUDE.md              # this file — agent behavior and modes
├── documents/
│   ├── templates/         # tracked skeletons explaining each document's structure
│   └── *.md               # your filled-in live documents (private)
├── logs/                  # daily activity logs, YYYY-MM-DD.md (private)
└── archive/               # completed/retired material by month (private)
```

## Grounding documents

The documents in `documents/` ground the agent's behavior — your values, your
strategy, notes on people, and so on. They start out not existing; templates in
`documents/templates/` explain what each one is for and how it's structured.

**Agent instruction:** when a mode or conversation would benefit from a
grounding document that doesn't exist yet, offer to fill it out together with
the user — copy the template from `documents/templates/` to `documents/` and
work through it conversationally. Only if the user wants that; never push it.

## Interaction modes

<!-- PLACEHOLDER: mode instructions (driver mode, mirror mode, co-working,
     standard startup, reflection, ...) get added here in the content-transfer
     pass, item by item. -->

## Activity logging

<!-- PLACEHOLDER: logging conventions get added here in the content-transfer
     pass. See logs/README.md for the file format. -->
