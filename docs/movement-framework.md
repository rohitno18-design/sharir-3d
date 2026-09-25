# Movement framework

How the Movement tab turns a lift into a moving 3D body. Every lift is one file in
`src/data/lifts/`, registered in `src/data/exercises.js`. The player (`src/core/exercise.js`),
the panel (`src/ui/exercisePanel.js`) and Film mode read the same file, so a new lift needs
no code anywhere else.

## The rules every lift obeys

These live in `src/core/lift.js`, so no single lift can break them by accident.

| Rule | How |
|---|---|
| The trunk is one braced, neutral piece | The rig has no spine joints; the trunk is placed by its hips and its lean (`Frame`). A rounded back cannot happen. |
| Feet are planted flat | `plantFeet` solves the legs to fixed points on the floor; knees follow the toes. |
| Hands are on the bar and closed round it | `handsOnBar` solves both arms to the bar and wraps the fingers against its real radius. |
| Standing lifts are in balance | The bar and the body together stay over the middle of the foot (`midfoot`, `leanToBalance`). |
| The bar never passes into the body | Every bar is tested against a tagged skin cloud of the trunk, head and legs in the current pose (`rig.bodyCloud`, `clearOfBody`), approaching from outside the way a real bar arrives. |

World space: metres, y up, floor at y = 0, lifter facing +z standing, the body's left at +x.

## An exercise file

```js
export const LIFT = {
  id, part, name, sub, source,          // part = the body-part picker label
  duration,                             // seconds for one rep at real speed
  bar: { radius, flesh },               // shaft radius; tissue between bar and finger bone

  u: keyCurve([[t, u], ...]),           // time in the rep -> how far through the movement
  phases: [{ key, name, t0, t1, hint, work? }],   // hint = the form cue for that moment;
                                                  // work marks the phase that slows with fatigue
  marks: [{ label, t }],                // jump buttons in the panel
  poster, ready, progress?,             // Film: opening frame, intro caption, live readout

  form: form(setup[], move[], mistakes[], breathing),   // plain full sentences

  equipment: { floor, bar: 'olympic' | 'short', bench? },
  camera(ctx) -> { target, offset, box },

  pose(u, { rig, height }) -> pose map,  // the body at movement point u
  muscles: [{ key, label, role, note, match, effort(t) }],
};
```

`t = 0` is always the start position. Poses are cached per body and per step, and worked
out in the background when a lift opens, so a pose may be slow to compute without making
playback slow.

## How the first set is built

| Part | Lift | What drives it |
|---|---|---|
| Chest | Bench press | Bar path; wrist over elbow; bar measured onto the chest |
| Back | Bent-over row | Held hinge, hips placed for balance; bar pulled to the measured bottom of the chest |
| Shoulders | Overhead press | Bar straight up over mid-foot from a real front rack; body leans back to pass the face |
| Biceps | Barbell curl | Elbows pinned; forearm arcs about the elbow; bar starts resting on the thighs |
| Triceps | Lying triceps extension | Upper arms still; bar arcs about the elbow; stops 3 cm from the measured forehead |
| Traps | Shrug | Only the shoulder girdle moves; straight arms carry the bar |
| Quads | Back squat | Shin lean and thigh angle together; back angle solved for balance |
| Hamstrings | Romanian deadlift | Hinge angle; knees hold a slight bend; bar held snug against the legs |
| Glutes | Hip thrust | Trunk pivots about the bench edge; shins upright at the top |
| Calves | Standing calf raise | Ball of the foot stays planted; straight body leans to stay balanced |

## The spine, the neck and mistakes

The trunk is a chain: pelvis (the root), lower back (turns at L5 on the sacrum), upper back
(T12 on L1), neck (C7 on T1) and head (the skull on the atlas). The shoulder girdles hang
from the upper back. Soft tissue blends across a band at each joint so the body bends
instead of tearing; each vertebra, rib and skull bone moves as one rigid piece with its own
level. Held straight, which every lift does by default, the body is exactly as before.

`bendSpine(pose, { lumbar, thorax, neck, head })` bends it (radians, positive rounds or nods
forward). The arms solve in the upper back's own frame (`armSpace`), so hands stay on the
bar however the back is bent.

A lift can list `faults: [{ key, label, note }]`. The panel shows a "See it on the body"
button for each under Mistakes to avoid; `pose(u, { fault })` then poses the mistake. The
body, the live cue and Film captions all say it is a mistake. So far: rounded back in the
Romanian deadlift, lower back rounding at the bottom of the squat.

The neck is used for correct form too: the hip thrust tucks the chin, and the overhead
press moves the head back to let the bar pass, then forward under it at lockout.

An EZ bar (`equipment.bar: 'ez'`, `ezGrip`) gives each hand its own angled line along the
bar, with the bends lying across the forearms. The lying triceps extension uses it.

## Known limits

- **Effort curves are a teaching aid.** Shaped from published EMG studies; EMG cannot
  measure one person's muscles from a screen.
- **Bars other than the EZ bar lie along the world's x axis.** Dumbbells need each hand
  free of the other.

## Next steps

Dumbbells (each hand its own implement), machines (a handle on a fixed track), bodyweight
lifts (new contacts such as hanging from a bar), then spine joints and plyometrics.
