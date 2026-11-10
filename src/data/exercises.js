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
import { SCRIPTS } from './moves.js';
import { movement } from '../core/motion.js';

export { pressPhase };
/** The ten lifts written by hand, each with its own bar path and effort curves shaped from EMG studies. */
export const LIFTS = [
  BENCH_PRESS, BARBELL_ROW, OVERHEAD_PRESS, BARBELL_CURL, LYING_TRICEPS_EXTENSION, BARBELL_SHRUG,
  BACK_SQUAT, ROMANIAN_DEADLIFT, HIP_THRUST, CALF_RAISE,
];
/** Movements written as scripts: poses from joint angles, effort computed from joint torques. */
export const MOVES = SCRIPTS.map(movement);
export const EXERCISES = [...LIFTS, ...MOVES];
/** The body parts in the picker's order, each with its movements. */
export const PARTS = [...new Set(EXERCISES.map(e => e.part))].map(part => ({ part, list: EXERCISES.filter(e => e.part === part) }));
export const exerciseById = (id) => EXERCISES.find((e) => e.id === id) || null;
