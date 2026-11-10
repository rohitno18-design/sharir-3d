# Movement scripts

A movement written as data. Add one object to `src/data/moves.js` and it appears in the
Movement tab, plays, films, and shows which muscles work. No other file changes.

A hand-written lift (`src/data/lifts/`) is a few hundred lines that work out a bar path and
hand-drawn effort curves. A script says only what a coach would say: the stance, what is
held, and each joint's position at the start and at the end. The rest is computed:

- **The pose** at every moment, by `src/core/motion.js`, on the rig's own arm and leg
  solvers. So the rules in `movement-framework.md` still hold: feet planted flat, elbows
  and knees true hinges that never lock, hands closed round what they hold.
- **Muscle effort**, by `src/core/biomech.js`, from the turning force each joint has to
  hold against gravity and the load.

## The format

```js
{
  id: 'lateral-raise',            // unique, kebab-case
  part: 'Shoulders',              // the body-part chip it sits under
  name: 'Dumbbell lateral raise',
  sub: 'Standing, arms lifted out to the sides to shoulder height',
  duration: 3.2,                  // seconds for one rep
  equipment: 'dumbbells',         // 'none' | 'dumbbells' | 'barbell-back'
  load: { kg: 'working' },        // total kg, or 'working' (see below)
  stance: { width: 'hip', toeOut: 8 },   // 'narrow' | 'hip' | 'shoulder' | 'wide', or metres from the midline
  balance: 'hips',                // true | 'hips' | omitted (see below)
  view: 'front',                  // 'front' | 'side' | 'back' | 'three-quarter' (default)
  timing: [[0, 0], [0.38, 1], [0.48, 1], [0.9, 0], [1, 0]],   // [time in rep, how far through]; this is the default
  poses: [
    { at: 0, arms: { raise: 6,  plane: 20, elbow: 14, palm: 'in' } },
    { at: 1, arms: { raise: 86, plane: 20, elbow: 14, palm: 'in' } },
  ],
  cues: { liftName, lift, topName, top, lowerName, lower, startName, start },   // the live form cue per phase
  phases: [...],                  // optional: write the four phases yourself (a squat goes down first)
  ready: 'Standing tall, a dumbbell in each hand by the thighs.',
  form: { setup: [], move: [], mistakes: [], breathe: '' },   // plain full sentences
}
```

`poses` needs at least two, `at: 0` (start) and `at: 1` (end). More can go between
(`at: 0.5`). A pose only writes what differs from the one before it; the first starts from
standing. Everything is in **degrees**.

### A pose

| Group | Field | Meaning | Range |
|---|---|---|---|
| `legs` | `knee` | Knee bend, both legs, feet planted | 0 to 150 |
| | `shin` | How far the shins lean forward (ankle bend). Negative leans them back | -14 to 40 |
| | `heel` | Heels raised, the ball of the foot staying put | 0 to 45 |
| `trunk` | `lean` | Whole trunk tipped forward from the hips, back kept flat | -20 to 95 |
| | `lumbar`, `thorax` | Lower and upper back rounded forward (negative arches) | -25 to 50, -20 to 40 |
| | `neck`, `head` | Chin tucked (negative tips back) | -40 to 45, -25 to 25 |
| | `side`, `twist` | Bent to the left, turned to the left (negative: right) | ±35, ±45 |
| `arms` | `raise` | Upper arm lifted from hanging: 0 down, 90 level, 180 overhead | 0 to 180 |
| | `plane` | Which way it is lifted: 0 out to the side, 90 forward, -90 back | -90 to 135 |
| | `turn` | Upper arm turned about its own length, outward positive. With the arm out to the side, `turn: 90` points the forearm up | -80 to 90 |
| | `elbow` | Elbow bend, 0 straight | 0 to 150 |
| | `palm` | Forearm turn: `'up'` (0), `'in'` (90, thumbs forward), `'down'` (160), or degrees | 0 to 180 |
| | `wrist` | Wrist bent back | -60 to 60 |
| `girdle` | `lift` | Shoulders shrugged up | -8 to 28 |
| | `back` | Shoulder blades squeezed back | -20 to 20 |

Arms can differ: `arms: { l: {...}, r: {...} }`.

`palm` is the forearm's own turn, so where the palm ends up facing depends on the upper
arm. Hanging, `'in'` faces the thigh. Lifted out to the side, `'in'` faces the floor. In a
shoulder press (`raise: 72, turn: 90`), `'in'` faces forward.

Arm angles are measured **in the room**, not against the trunk. `raise: 0` hangs plumb
however far the trunk leans, the way a held weight does. So a bent-over fly is simply
`raise: 2` to `raise: 86` with `trunk.lean: 62`.

A number outside its range is held to the range and reported by `npm run check`.

### Balance

- `balance: 'hips'`: keep the written trunk lean and send the hips back (or forward) until
  the weight is over the middle of the foot. Use it for anything standing: raises, curls,
  presses, hinges such as a good morning.
- `balance: true`: keep the legs as written and lean the trunk until it balances. Use it
  for a squat, where the knees and shins are the point and the back angle follows.
- Omitted: nothing is solved. The balance gate will fail it if it is off.

### Load

`load: { kg: 20 }` is the whole implement (both dumbbells together). `'working'` finds the
load that takes the hardest-working muscle to about 85% of its strength somewhere in the
rep, for the body on screen. That is what a working set is, so the weight shown is
believable for that body and the hard muscles light up fully.

## How effort is computed

`biomech.js`, for the body as posed:

1. The body is split into the standard segments, each with its share of the body's mass at
   its centre of mass (de Leva 1996).
2. The load is a weight at the hands, on the upper back or across the hips.
3. The floor's push is shared between the feet so the whole body is in balance.
4. At each joint, everything beyond it makes a turning force. The muscles must make the
   opposite one.
5. That is read in the joint's own terms (elbow flexion, the arm pulled across the chest,
   hip extension) and divided by what that muscle group can produce at that joint angle.
6. Muscles that cross two joints are accounted for: the hamstrings bend the knee while
   they straighten the hip, so the quadriceps work against them too.

Limits: it treats each moment as held still, each joint action has a fixed set of muscles,
and the strength figures are those of a typical trained adult scaled by body size. It is a
teaching model.

It is tested against the ten hand-written lifts, whose efforts were shaped from EMG
studies. In the app's console:

```js
(await import('/src/dev/validate-biomech.js')).run()
```

On 2026-11-10 it ranks the same muscles first in eight of the ten. The two it disagrees
with are the bent-over row and the Romanian deadlift, and the reason is in the poses, not
the model: the row holds the bar directly under the shoulder joint, where the shoulder has
no turning force to hold, and the deadlift carries the shoulders 23 cm in front of the bar.

## The gates

No scripted movement should be shown until it passes. In the app's console:

```js
const g = await import('/src/dev/posecheck.js');
g.baseline();              // once per machine: measures the hand-written lifts
g.check('lateral-raise');  // one movement
g.checkAll();              // every scripted movement
```

| Gate | Passes when |
|---|---|
| range | every joint, measured from the posed bones, stays inside human limits |
| balance | the weight stays within 3 cm of the feet |
| floor | no joint goes through the floor |
| tissue | no more muscle or skin edges are stretched (2.6 times their standing length) than in the worst hand-written lift |

The tissue gate is a count, and a count misses some faults (see the anatomy verification
notes in `movement-framework.md`). A new kind of movement still needs looking at from the
front, the side, behind and below before it is filmed.

## What scripts cannot do yet

- Lying, seated, hanging or hands-on-floor positions. Both feet are planted.
- One leg off the floor, or the feet at different places (lunges, step-ups).
- One-arm loads, cables, machines, bands.
- A barbell in the hands. Use a hand-written lift for those.
