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

## Muscles that cross the hip and shoulder

The lats, pecs, teres major, psoas and obturator externus are bound by their fibres
(`ANCHORED` in `rig.js`): each point moves towards the insertion's new place in proportion
to how far along the muscle it sits, so the muscle stretches instead of swinging. Tissue
that runs on past the insertion, down along the bone, turns with the bone instead. It
blends in over the first few centimetres past the insertion. "Past" is measured along the
way the fibres run and only counts close to the bone.

The glutes, the small rotators under them, the iliotibial tract and the sheets and bursae
round the back of the hip follow the skin over them (`FOLLOW_SKIN` in `rig.js`,
`followSkin` in `skinweld.js`). Each point takes the skin's smoothed weights near it, so
every layer there moves by one smooth field and none can pass through another. Bound
along their fibres, the gluteus maximus slid off the buttock at the bottom of a Romanian
deadlift and the deep rotators and pelvic floor showed through. The hamstrings and
adductors keep their own binding: given the skin's weights near the groin, they tore.

## Elbows, forearms and knees

- **The elbow and the knee are hinges.** Each bends about one fixed axis (the line between
  the epicondyles at the lower end of the humerus or femur) and about nothing else. The
  solvers (`solveArm`, `solveLeg` in `rig.js`) find the hinge angle first, from how far the
  grip or the ankle has to be from the shoulder or hip, and then turn the upper bone as a
  whole, about its own length as well, to aim the elbow or knee at its pole. Solved as the
  shortest turn of each bone, the elbow bent 40 to 100 degrees off its axis and the knee
  110 degrees at the bottom of the squat. With the limb near straight there is nothing to
  aim, so the upper bone takes its shortest turn and blends into aiming as it bends.
- **The palm turns the way a real one does.** The ulna stays on the elbow's hinge and the
  radius rolls round it, carrying the hand, about the line from the head of the radius to
  the head of the ulna. Both bones are rigid. Soft tissue in the forearm turns with the
  radius by how far down the forearm it lies. Past 140 degrees of turn the humerus rolls
  in to share it, as it does for an overhand grip on a hanging bar.
- **A straight arm is a little shorter than its two bones end to end**, because the elbow
  carries the forearm out of line and turning the palm down draws the hand in by about a
  centimetre. `straightReach` gives the real figure, and the lifts plan their reach with it.

The lat, teres major and pec major are bound along their fibres from where each muscle
starts: its far edge seen from the insertion, and the midline for the lat's spine and the
pec's breastbone. Each point takes its side from its own muscle. Read from its position, the
strip of the left lat over the spine went with the right arm, and the lats tore apart along
the back whenever the humerus turned.

## Creases: where two sides of a bend meet

Skinning bends each side about the joint but cannot stop one side passing into the other.
So the knees, the elbows and the front of the hips have a contact (`CREASES` in
`rig.js`, run in the shader after posing and mirrored on the CPU by `Rig.creasePoint`).

- **Knee and elbow.** The contact is the plane through the joint that halves the angle
  between the two bones. Tissue that would cross it is squeezed into a thin layer on its
  own side, so the layers keep their order and the skin stays outermost. Tissue shared
  between the two bones is first lifted out of the crease, like a bowstring: a hamstring
  tendon runs straight across the back of a bent knee instead of making a U-turn into it.
- **Front of the hip.** Only the thigh's tissue is held back, and the contact sits at the
  underside of the belly over that thigh, found pose by pose from skin samples taken at
  load. At the bottom of a deep squat the front of the thigh no longer passes into the
  belly. Deep tissue by the joint and the fibre-bound psoas are left alone: pushed, the
  psoas came out through the skin of the groin.

Checked by slicing the body front to back and drawing the skin outline over every muscle
point, and by counting muscle points that end up outside the posed skin. Rays are cast in
seven directions and a point counts as outside only when six agree, because a single ray
through a tangle of skin elsewhere gives a false result.

## Known limits

- **Effort curves are a teaching aid.** Shaped from published EMG studies; EMG cannot
  measure one person's muscles from a screen.
- **Bars other than the EZ bar lie along the world's x axis.** Dumbbells need each hand
  free of the other.

## Next steps

Dumbbells (each hand its own implement), machines (a handle on a fixed track), bodyweight
lifts (new contacts such as hanging from a bar), then spine joints and plyometrics.
