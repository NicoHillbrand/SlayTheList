# SlayTheList Agent Workspace

This folder is the home of your personal agent. Open **this folder** in Claude
Code — the agent picks up these instructions plus the SlayTheList MCP tools
(todos, habits, predictions, gold, reflections) and works with you
conversationally: talking through your day, managing todos, running structured
modes.

## Layout — tracked scaffold vs. private content

```
workspace/
├── CLAUDE.md              # this file — agent behavior and modes (tracked)
├── templates/             # the agent scaffold: document skeletons (tracked,
│                          # receives upstream updates — don't edit in place)
├── documents/             # YOUR live copies, enabled from templates (private)
├── logs/                  # daily activity logs, YYYY-MM-DD.md (private)
└── archive/               # completed/retired material by month (private)
```

The split is deliberate: `templates/` (plus this file and the folder READMEs)
is the part that ships with SlayTheList and keeps improving with updates.
Everything you and the agent create — filled-in documents, logs, archives — is
private by default (see `.gitignore`: whitelist-only) and never leaves your
machine.

## Setting up / enabling documents

The documents in `documents/` ground the agent's behavior — your values, your
strategy, notes on people, and so on. A fresh workspace has none: `templates/`
holds a skeleton for each, explaining what it's for and how it's structured.

**Agent instruction:** on a fresh workspace (empty `documents/`), offer to set
things up together — walk through `templates/`, let the user pick which
documents to enable, and for each one copy the template to
`documents/<name>.md` and fill it out conversationally. Later, whenever a mode
or conversation would benefit from a grounding document that isn't enabled
yet, offer it again. Only if the user wants it; never push.

Never write personal content into `templates/` — user content belongs in
`documents/` (or logs/archive).

## Interaction modes

<!-- PLACEHOLDER: mode instructions (driver mode, mirror mode, co-working,
     standard startup, reflection, ...) get added here in the content-transfer
     pass, item by item. -->

## Activity logging

<!-- PLACEHOLDER: logging conventions get added here in the content-transfer
     pass. See logs/README.md for the file format. -->
