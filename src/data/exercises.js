/**
 * Every lift the Movement tab can show, in the order of the body-part picker.
 *
 * Each one is a plain description in the shape the movement framework reads (see
 * src/core/lift.js and docs/movement-framework.md): the pose at each point of the rep, the
 * phases with a form cue for each, the full form guide, the muscles and how hard each one
 * works, the equipment, and the camera.
 */
import { BENCH_PRESS, pressPhase } from './lifts/bench-press.js';
import { BARBELL_CURL } from './lifts/barbell-curl.js';
import { BARBELL_SHRUG } from './lifts/barbell-shrug.js';
import { OVERHEAD_PRESS } from './lifts/overhead-press.js';
import { BACK_SQUAT } from './lifts/back-squat.js';
import { CALF_RAISE } from './lifts/calf-raise.js';
import { ROMANIAN_DEADLIFT } from './lifts/romanian-deadlift.js';
import { BARBELL_ROW } from './lifts/barbell-row.js';
import { LYING_TRICEPS_EXTENSION } from './lifts/lying-triceps-extension.js';
import { HIP_THRUST } from './lifts/hip-thrust.js';

export { pressPhase };
export const EXERCISES = [
  BENCH_PRESS, BARBELL_ROW, OVERHEAD_PRESS, BARBELL_CURL, LYING_TRICEPS_EXTENSION, BARBELL_SHRUG,
  BACK_SQUAT, ROMANIAN_DEADLIFT, HIP_THRUST, CALF_RAISE,
];
export const exerciseById = (id) => EXERCISES.find((e) => e.id === id) || null;
