# Authoring playbook

How to add a movement or a "What happens if" entry to Sharir 3D so that it is right, without
needing the model that built the engine. Accuracy here does not come from being clever. It
comes from four things this repo already does for you:

1. **You say what should happen before you run it.** A movement states which muscles it
   should work. An effect names the source of every number.
2. **A machine checks it.** `npm run gate` and `npm run check`.
3. **You look at it.** The gate saves ten photographs. You open them.
4. **A second reader checks it cold.** For effects, a fresh reviewer who has not seen your
   reasoning, with the review sheet in hand.

If a step fails, fix the content. Never change the gate, the baseline, the limits or the
engine to make something pass.

---

## What you may and may not touch

**Yours to edit**

| To add | Edit |
|---|---|
| A movement | `src/data/moves.js` (one script object) |
| A "What happens if" entry | one new file in `src/data/effects/<food|exercise|substances>/<id>.json` |

**Do not edit without Rohit saying so in the chat**

`src/core/*` (the rig, the solvers, `biomech.js`, `motion.js`, `sway.js`), `src/dev/*`,
`tools/gate-baseline.json`, the ranges in `motion.js`, the limits in `posecheck.js`, the
hand-written lifts in `src/data/lifts/`, and `public/` (models and registry).

If a movement cannot be written with the script format (see "cannot do yet" in
`movement-scripts.md`), **stop and say so**. Report which ability is missing. Do not
approximate it with a different movement under the same name, and do not patch the engine.

---

## A. Adding a movement

Read `docs/movement-scripts.md` once for the format. Then:

### 1. Write down the anatomy first

Before any angles, write (in the chat, then in the script's `expect`):

- **lead**: the muscle groups that should be the prime movers.
- **working**: those that clearly help.
- **quiet**: groups that should NOT be working hard. Pick the ones a wrong pose would light
  up: the biceps in a lateral raise, the quadriceps in a good morning, the lats in a curl.

Use the model's group keys:
`pec, delt-front, delt-side, delt-rear, lats, cuff, trap-upper, mid-back, serratus, biceps,
triceps, forearm, erector, abs, neck, glute-max, glute-med, hip-flexors, adductors, hams,
quads, gastroc, soleus, shin`.

Take the anatomy from a standard source (Delavier's *Strength Training Anatomy*, an EMG
review, a physiotherapy text), not from memory alone. Put the source in the script's
`source` field.

### 2. Write the script

Copy the nearest existing script in `moves.js` and change it. Positions that are known to
work:

| Position | Arm pose |
|---|---|
| Hanging by the sides, weights in hand | `raise: 2, plane: 0, elbow: 8, palm: 'in'` |
| Arms out to the sides, level | `raise: 86, plane: 20, elbow: 14, palm: 'in'` |
| Arms straight forward, level | `raise: 88, plane: 90, elbow: 12, palm: 'down'` |
| Shoulder press, bottom (forearms upright) | `raise: 72, plane: 25, turn: 90, elbow: 118, palm: 'in'` |
| Shoulder press, top | `raise: 168, plane: 25, turn: 90, elbow: 14, palm: 'in'` |
| Curl, top | `raise: 10, plane: 90, elbow: 132, palm: 'up'` |
| Arms overhead, elbows bent behind the head | `raise: 166, plane: 82, elbow: 126, palm: 'in'` |
| Lying: weights straight up off the chest | `raise: 90, plane: 86, turn: -78, elbow: 16, palm: 'in'` |
| Lying: arms opened wide | `raise: 92, plane: 2, turn: 0, elbow: 30, palm: 'in'` |

Rules that have each cost a failed attempt already:

- **`palm` is the forearm's own turn, not where the palm faces.** Hanging, `'in'` faces the
  thigh. Out to the side, `'in'` faces the floor. In a press with `turn: 90`, `'in'` faces
  forward. Check the photo.
- **`turn: 90` points the forearm up** when the arm is out to the side. Without it the
  forearm bends forward.
- **Never write `elbow: 0` or `knee: 0`.** Joints here do not lock. Use 8 to 14 for a
  "straight" arm and 6 for a "straight" leg.
- **Standing with weights: `balance: 'hips'`.** Squats: `balance: true`. Lying and split
  stance: leave it out.
- **Dumbbells are limited by grip.** If the target muscle is far stronger than the hands
  (calves, sometimes traps), put the load on the back (`equipment: 'barbell-back'`).
- **If the movement starts by lowering** (squat, fly, triceps extension), write the four
  `phases` yourself with `work: true` on the way up, and use the timing
  `[[0, 0], [0.42, 1], [0.5, 1], [0.9, 0], [1, 0]]`.
- **A split stance is left foot forward only.**
- Form text: plain, full sentences. No jargon the gym floor would not use.

### 3. Run the gate

```bash
npm run gate -- <movement-id>
```

About three minutes. It prints PASS or FAIL and why:

| It says | It means | Do this |
|---|---|---|
| `expect: "x" should lead … works at only N%` | The pose does not load the muscle you meant, or your anatomy is wrong | Look at the effort line. If another muscle is unexpectedly high, a joint is turned wrong (usually `turn`, `plane` or `palm`). If the pose is right, your `expect` was wrong: check the source again |
| `expect: "x" should be quiet but works at N%` | Same, the other way | Same |
| `range: …` | A joint is past what a human joint does | Reduce that angle |
| `balance: … cm outside the feet` | The body would fall over | Add or change `balance`; for a split stance change `legs.forward` |
| `tissue: N stretched … edges` | Muscle or skin is tearing | Reduce the range at the joint named in "most stretched". If it still fails, the engine cannot do this pose yet: stop and report |
| `script: … is outside …` | A number is outside its range | Fix the number |

A load that looks absurd (see below) is also a failure even if the gate passes.

| Body weight 65 kg | Believable working load, in all |
|---|---|
| Raises, flyes | 12 to 30 kg |
| Curls, triceps work | 20 to 45 kg |
| Presses | 30 to 60 kg |
| Squats, hinges, split squats | 40 to 100 kg |

### 4. Look at the photographs

Open all ten files in `gate-shots/<id>/` (start and top, each from front, side, back,
below, above) and answer every line. If you cannot answer yes, it is not done.

- [ ] The hands are closed round the handles, and the handles lie the way a hand would hold them.
- [ ] Both feet are flat on the floor (or on the ball, where the script says so).
- [ ] No hand, weight or limb passes through the body, the bench or the floor.
- [ ] Left and right match (unless the script makes them differ).
- [ ] The brightest muscle is the one in `expect.lead`.
- [ ] From behind and from below: no spikes, no sheets, no muscle lifted off the body, no gap opening at the shoulder, armpit, hip or groin.
- [ ] It looks like the exercise. Someone who trains would name it from the picture.

### 5. Finish

```bash
npm run check
```

```bash
npm run build
```

Then tell Rohit: the movement's name, its working load, its lead muscles, the gate result,
and anything in the photographs you were unsure of. Do not commit unless he asks.

---

## B. Adding a "What happens if" entry

Read `docs/EFFECTS-SCHEMA.md` once for the format and the list of body targets. Then:

### 1. Fix the dose and the person

One exact dose, written in the `dose` field: how much, how often, in whom. Every number in
the file must be about **that** dose in **that** kind of person. This is where most of the
mistakes in the 2026-11-10 audit came from.

### 2. Gather sources before writing

Find 3 to 5 real sources: a guideline body (WHO, ICMR-NIN, ACSM, NIH), a meta-analysis or
Cochrane review, and where possible a named landmark trial. Search for them; do not cite
from memory. For each number you plan to show, note which source it is from and what dose
and population that source studied.

No source for a number means no number. Say what happens in words instead.

### 3. Write the file

Copy the nearest existing file in the same folder. Then hold to these, each of which was a
real error found and fixed:

| Rule | The mistake it prevents |
|---|---|
| **Match the dose.** A statistic from heavy users does not go on a moderate dose. If you must show it, the label says whose number it is | "Fatty liver in daily drinkers: 90%" on a 2-drinks-a-day file. That figure is for 4 or more drinks |
| **Match the time.** A risk that takes decades does not appear as a number at 5 years | "Lung cancer 10 to 15 times" shown after 5 years of 10 cigarettes |
| **Draw the typical result, not the worst case.** `scale` below 1 or `opacity` below 0.85 means tissue is being lost. Use it only when that is what usually happens at this dose and time | A shrunken, cirrhotic liver on 2 drinks a day |
| **Not helping is not harming.** If something simply does not build or improve a tissue, it is `neutral`, not `negative` | Swimming and cycling shown as damaging bone |
| **The headline agrees with its own numbers** | "Dependence in one in ten" above "25 to 50%" |
| **Harm builds.** Early steps of a slow harm are `strain` or low `negative`; the big red comes later | |
| **Geography is checked, not assumed** | "No vitamin D in winter north of 30° N" (Delhi is at 28° N; the real figure is about 35° N) |
| **Hedge honestly.** "typically", "about", "in trials of…" where the evidence is a range | "+1 to 2 kg a month" stated as typical |

Tone: a sharp doctor explaining to a smart friend. Specific, not preachy. English in the
notes, natural spoken Hindi in `name.hi` and `summary.hi`.

### 4. Check the shape

```bash
python tools/validate_effects.py
```

### 5. Check the claims

```bash
python tools/review_effect.py <id>
```

It prints every claim in the file and marks the places mistakes have been found before
(LOSS, DOSE, TIME, BIG, HEADLINE, HARM, ABSOLUTE, SOURCE, NEUTRAL). A mark is a place to
look, not a mistake. For each mark, either fix it or be able to say in one line why it is
right, naming the source.

### 6. A second reader, cold

Hand the review sheet to a fresh reviewer who has not seen your working (a new subagent at
high effort, or a new session). Give it only: the printed sheet, the table of rules above,
and this instruction:

> For every number on this sheet, say whether it is true for the dose in the DOSE line and
> at the time step it sits under, and which of the listed sources supports it. List every
> number you cannot support. List every place the picture (kind, intensity, scale, opacity)
> says more than the evidence does.

Fix what it finds. If you and the reviewer disagree, the more cautious wording wins.

### 7. Finish

```bash
npm run check
```

```bash
npm run build
```

Open the entry in the app, step through all seven time steps and confirm the body shows
what the text says. Then tell Rohit: the entry, its evidence grade, the numbers the
reviewer questioned and how each was settled. Do not commit unless he asks.

---

## Which model and effort

| Job | Use |
|---|---|
| Writing a movement script and running the gate | Sonnet or Opus, medium. The gate carries the accuracy |
| Writing an effect file | Opus, medium |
| The cold review of an effect file | Opus, high, in a fresh context |
| Anything in `src/core/` | Stop. Ask Rohit. That is engine work |

---

## Why this is enough

Everything that went wrong while the engine was being built fell into a class this playbook
now catches by machine or by checklist:

- a pose that loads the wrong muscle (an elbow turned a quarter turn): caught by `expect`
- a pose no body can make: caught by the range gate
- a body that would fall over: caught by the balance gate
- torn muscle or skin: caught by the tissue gate, then by the photographs
- a muscle pattern matching the wrong part of the body (the hamstring in a bench press): caught by `npm run check`
- a true number on the wrong dose or the wrong year: caught by the review sheet and the cold reader

What it cannot catch: a wrong fact that is self-consistent and well-hedged. That is what
the sources are for. When in doubt, say less.
