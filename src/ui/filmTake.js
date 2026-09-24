import * as THREE from 'three';

/**
 * One filmed take: which moment of which rep is on screen at each second of the video,
 * how tired the lifter is by then, and where the camera is.
 *
 * Kept apart from the recorder so the preview, the frame-by-frame render and the
 * real-time fallback all play exactly the same take.
 */

/** The four moments of a rep, as spans of the player's own rep time (0..1). */
export const PHASES = [
  { key: 'lower', t0: 0.00, t1: 0.42 },
  { key: 'chest', t0: 0.42, t1: 0.52 },
  { key: 'press', t0: 0.52, t1: 0.92 },
  { key: 'lock',  t0: 0.92, t1: 1.00 },
];

/**
 * The share of a one-rep max that a set of `reps` to failure is done with (Epley's
 * relation): about 97% for 1 rep, 91% for 3, 75% for 10, 60% for 20. It is also where the
 * muscles' effort starts on the first rep: a heavy triple is hard from the first rep,
 * a light set of twenty only gets hard as the lifter tires.
 */
export const loadFor = (reps) => 1 / (1 + reps / 30);

/** Pace choices: seconds each phase stays on screen, or real speed. */
export const PACES = [
  { key: 'teach:2', label: 'Each phase 2 s', teach: 'all', secs: 2 },
  { key: 'teach:3', label: 'Each phase 3 s', teach: 'all', secs: 3 },
  { key: 'teach:4', label: 'Each phase 4 s', teach: 'all', secs: 4 },
  { key: 'teach:5', label: 'Each phase 5 s', teach: 'all', secs: 5 },
  { key: 'ends:3',  label: 'Real speed, first and last rep slow', teach: 'ends', secs: 3 },
  { key: 'real',    label: 'Real speed', teach: 'none', secs: 0 },
];
export const REP_CHOICES = [1, 3, 5, 8, 10, 12, 15, 20];

/**
 * Build a take.
 * @param repSecs how long one rep takes at real speed
 */
export function buildTake({ reps = 1, pace = 'teach:3', repSecs = 3.4 }) {
  const pc = PACES.find(p => p.key === pace) || PACES[1];
  const segs = [];
  let time = 0;
  const push = (seg) => { seg.start = time; time += seg.dur; segs.push(seg); };
  // A moment at the top before the first rep, so the video does not open mid-movement.
  push({ rep: -1, phase: 3, dur: 0.8, hold: 0.96 });
  for (let i = 0; i < reps; i++) {
    const teach = pc.teach === 'all' || (pc.teach === 'ends' && (i === 0 || i === reps - 1));
    const f = reps > 1 ? i / (reps - 1) : 1;
    PHASES.forEach((ph, k) => {
      let real = (ph.t1 - ph.t0) * repSecs;
      // The press slows as the muscles tire: the last rep of a hard set is the slowest.
      if (ph.key === 'press') real *= 1 + 1.1 * f * f;
      push({ rep: i, phase: k, dur: teach ? Math.max(pc.secs, real) : real, taught: teach });
    });
  }
  push({ rep: reps - 1, phase: 3, dur: 0.6, hold: 0.99 });
  return { reps, pace: pc, segs, total: time, s0: loadFor(reps) };
}

/**
 * What is on screen at `ts` seconds into the take: rep time, which rep, which phase, and
 * how far through the set the lifter is (0 fresh, 1 at the last rep's lockout).
 */
export function sampleTake(take, ts) {
  const segs = take.segs;
  let seg = segs[segs.length - 1];
  for (const s of segs) { if (ts < s.start + s.dur) { seg = s; break; } }
  const k = Math.min(1, Math.max(0, (ts - seg.start) / seg.dur));
  const ph = PHASES[seg.phase];
  const t = seg.hold != null ? seg.hold : ph.t0 + k * (ph.t1 - ph.t0);
  const rep = Math.max(0, seg.rep);
  const within = seg.rep < 0 ? 0 : (t >= 0.999 ? 1 : t);
  const set = seg.rep < 0 ? 0 : Math.min(1, (rep + within) / take.reps);
  return { t: t % 1, rep, phase: ph.key, set, intro: seg.rep < 0, taught: !!seg.taught };
}

/**
 * How hard each muscle is working at this moment of the set, and how tired it is.
 * Effort rises from the load's own level on the first rep to near maximum at the last,
 * because a tiring muscle recruits more of itself to keep the same bar moving. Tiredness
 * builds with the set, and in proportion to how much work each muscle does over a rep.
 */
export function fatigueAt(take, sample, share) {
  const s0 = take.s0;
  const lift = s0 + (1 - s0) * Math.pow(sample.set, 1.6);
  const tired = Math.pow(sample.set, 1.3);
  return { lift, tired: tired * share };
}

/** Each muscle group's share of a rep's work, relative to the hardest-working group. */
export function workShares(groups) {
  const mean = groups.map(g => {
    let sum = 0;
    for (let i = 0; i < 120; i++) sum += Math.max(0, Math.min(1, g.def.effort(i / 120)));
    return sum / 120;
  });
  const top = Math.max(...mean, 1e-6);
  return new Map(groups.map((g, i) => [g, mean[i] / top]));
}

/** Camera choices. */
export const CAMERAS = [
  { key: 'still', label: 'Camera still' },
  { key: 'sweep', label: 'Camera sweeps' },
  { key: 'orbit', label: 'Camera circles' },
];

/**
 * Where the camera is `ts` seconds into the take, as an offset from the target.
 * `base` is the framed shot's own offset. A sweep swings 45 degrees either side of it and
 * back; a circle goes all the way round in 24 seconds, rising and dipping as it goes. Both
 * stay high enough to see over the plates, which hide the lifter from a level side view.
 */
export function cameraOffset(mode, base, ts, total, out = new THREE.Vector3()) {
  const r = base.length();
  const az0 = Math.atan2(base.x, base.z);
  const el0 = Math.asin(Math.max(-1, Math.min(1, base.y / r)));
  let az = az0, el = el0;
  if (mode === 'sweep') {
    const period = Math.min(14, Math.max(8, total));
    az = az0 + THREE.MathUtils.degToRad(45) * Math.sin((2 * Math.PI * ts) / period);
  } else if (mode === 'orbit') {
    // Turn at 15 degrees a second, easing up to speed at the start and down at the end,
    // so the first and last frames sit still instead of starting and stopping with a jolt.
    az = az0 + THREE.MathUtils.degToRad(15) * easedTime(ts, total, 1.5);
    // Rise from the framed height and settle back every 12 seconds. The framed shot already
    // sits near the lowest height that clears the plates, so dipping below it is not an option.
    el = Math.max(el0, THREE.MathUtils.degToRad(28))
      + THREE.MathUtils.degToRad(16) * (0.5 - 0.5 * Math.cos((2 * Math.PI * ts) / 12));
  }
  el = Math.max(THREE.MathUtils.degToRad(28), Math.min(THREE.MathUtils.degToRad(70), el));
  return out.set(r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az));
}

/**
 * Seconds of movement by time `t` for something that speeds up over `ramp` seconds, runs
 * at full speed, and slows to a stop over the last `ramp` seconds of `total`.
 */
function easedTime(t, total, ramp) {
  const r = Math.min(ramp, total / 2);
  if (r <= 0) return t;
  const T = total, x = Math.min(Math.max(t, 0), T);
  if (x < r) return (x * x) / (2 * r);
  if (x <= T - r) return r / 2 + (x - r);
  const left = T - x;
  return r / 2 + (T - 2 * r) + (r / 2 - (left * left) / (2 * r));
}
