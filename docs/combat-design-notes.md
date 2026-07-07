# Arena — design research notes

## Fork-vs-build verdict (researched 2026-07-05): BUILD

An exhaustive sweep for forkable open-source autobattlers found nothing usable —
everything with the right loop has the wrong license, everything with the right
license is the wrong game:

- **creature-chess** (TS/React, full TFT loop, maintained) — AGPL-3.0, and grid
  combat rather than attack-speed timelines. Read `@shoki` for architecture only.
- **teamfight-simulator** (ISC) — tick-based attack-speed/mana scheduler, exactly
  our target combat model, but a sandbox (no game loop) built on Riot's real TFT
  champion data (IP-unsafe). **Best read-only reference for the timeline sim.**
- **OpenDuelyst** — CC0 code+assets (cleanest license found), but a manual-tactics
  CCG on a dead CoffeeScript/Backbone/Cocos2d stack. Not worth bridging.
- Forge/Cockatrice (GPL, wrong genre), Godot card kits (player-driven card UX,
  wrong engine), SAP/Backpack/Bazaar "clones" (tools consuming commercial data).

Do not vendor AGPL/GPL code. No ECS library needed at 12-units-per-fight scale.


Distilled from designer talks, postmortems, and analyses of Slay the Spire, Super Auto
Pets, TFT, The Bazaar, and Hearthstone Battlegrounds (researched 2026-07-05). Kept here
so future combat work builds on evidence, not vibes.

## What the successful games actually teach

1. **Depth = composability, not content volume.** Super Auto Pets is three orthogonal
   tables — *Triggers* (on-faint, on-hurt, on-battle-start, on-summon…) × *Effects*
   (buff, damage, summon, status) × *Targets* (self, ally-ahead, random enemy,
   strongest enemy…). Every unit is one row from each. New depth = new rows or new
   combos, never bespoke text per card. SAP launched with just ~60 pets; Slay the Spire
   settled at ~75 cards/character on purpose.
   (a327ex.com SAP mechanics breakdown; STS GDC 2019.)

2. **Imbalance is fine in PvE — "obviously correct" is the only real bug.** STS treats
   rare OP combos as dopamine, but any card that improves *every* deck regardless of
   context gets nerfed immediately. TFT: "embrace extreme outcomes." Battlegrounds:
   redesign cards, don't remove them — players get attached.

3. **Deterministic combat is a load-bearing invariant.** Same lineup must give the same
   result — required for async snapshot PvP (Clash Royale / Marvel Snap pattern: client
   replays a server-verified deterministic sim) and for legible "my prep decision paid
   off" watching. Any future randomness must be seeded/replayable. (Cliffski's
   deterministic auto-battler postmortem: retrofitting determinism is much harder than
   protecting it.)

4. **Watching is fun because it validates prep decisions.** The payoff phase is
   feedback on choices already made, not a new decision point. Keep battles legible.

5. **Single-player ladders have nothing to check degenerate lineups.** (Hand of the
   Divine postmortem.) One dominant deck that trivializes the ladder is a real failure
   mode — and it would then also wreck async PvP. Mitigations: faction synergy bonuses
   to fragment the "one best lineup" space; watch pick/win rates.

6. **Difficulty floor ("Fixed Layer", Cogmind):** always guarantee a skill-accessible
   path past the next rung without lucky draws. RNG adds upside, never gates the floor.

7. **Habitica's economy failure is our attack surface too.** Rewards decoupled from
   real effort get farmed (click-spam habits, throwaway todos). Our gold is minted
   externally (`award_gold` via MCP / todo completion) — same vulnerability class.
   Consider diminishing returns per completion window, or weight big rewards toward
   rate-limited events (deadlines, streaks) before scaling the game economy.

8. **Calibration betting (the moat) — one warning from the literature.** A 2025 study
   found scoring-rule feedback *alone* does not improve calibration. If the prediction
   betting should feel like a skill that grows, show the **calibration curve**
   (reliability diagram), not just points — cf. Clearer Thinking's "Calibrate Your
   Judgment" app, the nearest UX precedent. No shipped game fuses calibration scoring
   with a battler economy — genuine white space.

## Build order (research-backed)

1. Trigger/effect/target ability system in the engine (small closed sets; every combo
   is free content). Before positioning, before bespoke keywords.
2. Positioning as a depth multiplier (lineup order + ally-adjacent/front-back targets).
3. Protect determinism while doing 1–2 (seeded RNG only).
4. Instrument pick-rate/win-rate per card early — intuition fails once combinatorics
   grow (STS's core lesson).
5. Stress-test the NPC ladder for the difficulty floor once abilities exist.
6. Rework gold-award granularity (anti-farm) before scaling the economy.
7. Prediction/Brier betting last — and prototype its calibration-curve UI separately
   before fusing it into the gold economy.

Key sources: STS GDC 2019 (metrics-driven balance), a327ex.com (SAP mechanics),
Noisy Pixel Reynad interview (async PvP rationale), TFT GDC 2020, Cliffski deterministic
auto-battler blog, Hand of the Divine postmortem, Grid Sage Games difficulty-curve blog,
arXiv 1808.07501 (practical scoring rule), Wiley FFO2.199 (2025 calibration-feedback
negative result), Trophy.so Habitica case study.
