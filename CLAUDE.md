# Sharir 3D

A 3D human body that shows which muscles work in an exercise and what a habit does to the
organs over time. Rohit uses it to teach people about their health. Wrong anatomy or a
wrong number on screen is the worst thing this repo can ship.

## Adding content

Follow `docs/AUTHORING.md`. It covers a new movement (`src/data/moves.js`) and a new "What
happens if" entry (`src/data/effects/`), step by step, with the gates each must pass.

## Commands

| Command | What it does |
|---|---|
| `npm run gate -- <movement-id>` | One movement through every gate, with photos in `gate-shots/` |
| `npm run gate -- --all` | Every scripted movement |
| `npm run gate -- --model` | The effort model against the hand-written lifts |
| `python tools/review_effect.py <id>` | Review sheet for one effect file |
| `npm run check` | Anatomy, lift and effect audits. Must pass |
| `npm run soak` | Clicks round the app at random and checks the body never vanishes, nothing is left over from another tab, nothing throws. Run after any change in `src/core/` or `src/main.js`. `npm run soak -- 1 20` for more seeds |
| `npm run body` | How well the body holds together when posed: nerves and vessels coming out through the skin, lifting off their muscles, branches pulling away, sticks. Run before and after any change to bindings (rig.js, skinweld.js, batched.js); totals must not go up. `-- --all` for every movement |
| `node tools/probe.mjs "<js>" --gpu` | Run a snippet in the app headless and print the result. For measuring. `tools/shot.mjs out.png "<js>"` saves a photo |
| `npm run build` | Rohit's desktop shortcut serves `dist/`. Always build before saying a change is done |
| `npm run dev` | Live version on port 5180 |

## Rules

- Do not edit `src/core/`, `src/dev/`, `src/data/lifts/`, `tools/gate-baseline.json` or
  `public/` unless Rohit asks for engine work in the chat.
- Never change a gate, a limit or the baseline to make something pass.
- Atlas data faults are repaired at load in `src/core/registry.js`. Never edit
  `public/data/registry.json`.
- Comments and docs here are written in plain full sentences that say why. Keep to that.
- Do not commit or push unless asked.

## Map

| Where | What |
|---|---|
| `src/core/rig.js` | The skeleton, the arm and leg solvers, skinning |
| `src/core/lift.js` | Helpers every lift is built from |
| `src/core/motion.js` | Movement scripts turned into lifts |
| `src/core/biomech.js` | Muscle effort computed from joint torques |
| `src/core/sway.js` | Standing lifts leaning from the ankles to stay balanced |
| `src/core/exercise.js` | The player |
| `src/data/lifts/` | Ten hand-written lifts |
| `src/data/moves.js` | Scripted movements |
| `src/data/effects/` | "What happens if" entries |
| `src/dev/posecheck.js` | The gates |
| `docs/movement-framework.md` | How movement works and why, with every fault that was found |
