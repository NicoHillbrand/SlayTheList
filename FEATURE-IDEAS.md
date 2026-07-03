# SlayTheList Feature Ideas

Collect feature ideas and improvements here. Add freely, prioritize later.

---

## Ideas

- Make a version that runs on Linux (for testers)
- First-time user tip / onboarding: suggest daily predictions as a practice (e.g. "Did you know you can make predictions for the day? It's a great way to calibrate your intuitions." — offer on first interaction or in a tips section)
- Background music: default ambient/focus music that plays while the app is open, with controls to toggle or swap track
- Screenshot recognition for task completion evidence (take a photo/screenshot to prove you did the thing)
- Hard-locked tasks with friend as fallback unlocker (friend can unlock for you if you're stuck)
- Celebrating another person's achievements gives both parties gold
- Prediction calibration gives recurring gold returns: track how well-calibrated a user is over time (e.g. Brier score or hit rate by confidence band) and pay out a passive gold multiplier/bonus based on their calibration quality — good forecasters earn more gold per prediction resolved, creating an ongoing incentive to make predictions regularly and set honest confidence levels
- Multiplayer / social gameplay via modded game integration: show other users' bases/progress inside a shared game world (starting with Terraria). Let friends see each other's productivity progress reflected in-game — e.g. your completed todos build out your base, and you can visit others' bases
- Chrome tab / video blocking: block specific Chrome tabs or video playback based on productivity state. Should be achievable via screenshot detection (already in the app) or by defining processes and using a Chrome extension API to control tab access
- Social value alignment: explore whether SlayTheList's social features (accountability partners, shared predictions, collaborative goals) can meaningfully contribute to coordination problems — could well-calibrated prediction markets among friends surface better collective decisions?
- Proper double-clickable installer that bundles/downloads Node.js and all dependencies — zero-setup install experience for non-technical users
- Encouragement / celebration feature: positive feedback and celebration moments when completing tasks, hitting streaks, or reaching milestones — make finishing things feel good
- Android app: native or hybrid mobile app so SlayTheList is accessible on the go
- Friend encouragement / celebrations: friends can encourage (on active entries) or celebrate (on completed entries) each other's goals/habits/predictions. Both parties earn a small gold reward. Limited to ~3 interactions per day to keep it meaningful and prevent spam
- API endpoint to add gold directly (with sound playback). Use case: pair Claude Code ultimate driver mode with SlayTheList. Driver mode runs steppified small actions and computes gold rewards per step (e.g. 1 gold for tiny step, 2 for slightly larger), then calls the API to grant gold + play the sound. User gets the dopamine loop without having to manually log every micro-step as a todo. Could also be done by logging fine-grained steps to SlayTheList itself, but that may need a separate fine-grained view. Recommend pairing this with a shareable cleaned-up version of driver mode for other users.
- Interactive AI overlay with screen-aware chat: an always-available overlay where you chat with an AI that watches your screen (screenshot capture is already in the app) and automatically updates the current task's subtasks as you work. The AI infers what you're doing from the screen, breaks the active todo into live subtasks, ticks them off as it sees progress, and lets you steer/refine via chat. Turns the todo list into a live, self-updating checklist rather than something you manually maintain. Could tie into the gold/driver-mode loop (auto-award gold as subtasks complete) and the existing screenshot recognition idea.
- 2D tree-garden visualization: a lightweight 2D scene (no full game integration) where goals/projects grow as trees. Each tree represents a goal, and clicking a tree opens the set of tasks involved in "getting" (growing) that tree — i.e. the todos/subtasks that contribute to it. Completing tasks visibly grows the tree (sapling → full tree), giving an at-a-glance, spatial overview of progress across goals. A simpler, self-contained cousin of the Terraria/modded-game base-building idea.
- Calendar view for goals: a calendar layout that lays out goals (and their tasks/deadlines) across days/weeks/months. See what's due when, when goals were started/completed, and plan ahead by placing goals on dates. Could surface deadlines (`deadlineAt`), completion dates, and habit check-ins on a unified timeline.

## In Progress

## Done

- Windows auto-start on login: "Start automatically when I log in" toggle, available both in the GUI launcher and in the app's in-app Settings modal (Startup section). Creates/removes a Startup-folder shortcut (`SlayTheList.lnk`) that silently runs `start.bat browser` at login via `scripts/autostart.vbs`. Shortcut logic lives in the shared `scripts/autostart-manage.ps1`; the API exposes it at `GET/POST /api/autostart`. No admin required.
