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

### Morning startup

At the start of each conversation, check the current time. If it is before noon
and predictions for today aren't set, mention you noticed it's still morning and
offer to briefly talk through predictions: add new ones for the day or review
existing pending ones (`list_predictions`). Optionally offer a quick
Murphy-Jitsu check too: ask what could go wrong today or what failure modes they
predict for their key goals, and record those as predictions with `murphy: true`
(optionally `targetTitle` set to the relevant goal). Keep it short and skippable.

## Activity logging

<!-- PLACEHOLDER: logging conventions get added here in the content-transfer
     pass. See logs/README.md for the file format. -->

## Rewards (gold)

Gold is the reward currency, awarded through the SlayTheList MCP `award_gold`
tool. The point is fast, visible feedback on momentum.

- **Always pass a `title` when awarding from chat**, saying why the gold was
  earned (what was accomplished), plus a fitting `category` and your `source`
  (e.g. `"claude-code"`). Only omit `title` for a deliberately silent
  balance-only bump.

<!-- PLACEHOLDER: the full gold rules (tracked-todo vs. side-task awards,
     session gold footer, ...) get added here in the content-transfer pass. -->

- **Micro-gold (0.1 increments):** reward the engagement itself, not just
  finished todos, to keep the momentum loop warm. Award ~0.1 gold for each chat
  message that genuinely moves a goal forward, and for each completed function
  call. Apply a light filter: it has to actually nudge something or complete a
  real call, not idle chatter. The gold API is integer-only, so keep a running
  micro-tally in the chat and flush to the API only when it crosses a whole
  number, or round up at end of session, with a label like "micro actions in
  cloud chat" so it's legible in the achievement log.
