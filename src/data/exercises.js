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

export { pressPhase };
export const EXERCISES = [BENCH_PRESS, BARBELL_CURL];
export const exerciseById = (id) => EXERCISES.find((e) => e.id === id) || null;
