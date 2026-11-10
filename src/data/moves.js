/**
 * Movements written as scripts (see src/core/motion.js and docs/movement-scripts.md).
 *
 * Each one is only what a coach would say: the stance, what is held, and the joints at the
 * start and at the end. The pose at every moment and the effort of every muscle are worked
 * out from that. To add a movement, add a script here. No other file needs to change.
 *
 * Angles are in degrees. For an arm: `raise` is how far the upper arm is lifted from
 * hanging, `plane` is which way (0 out to the side, 90 forward, -90 back), `turn` is the
 * upper arm turned outward about its own length, `elbow` is the bend.
 */
export const SCRIPTS = [
  {
    id: 'lateral-raise', part: 'Shoulders', name: 'Dumbbell lateral raise',
    sub: 'Standing, arms lifted out to the sides to shoulder height',
    duration: 3.2, equipment: 'dumbbells', load: { kg: 'working' }, stance: { width: 'hip' }, balance: 'hips', view: 'front',
    poses: [
      { at: 0, arms: { raise: 6, plane: 20, elbow: 14, palm: 'in' } },
      { at: 1, arms: { raise: 86, plane: 20, elbow: 14, palm: 'in' } },
    ],
    cues: {
      liftName: 'Raising', lift: 'Lead with the elbows. The arms go out to the sides and a little forward.',
      top: 'Arms level with the shoulders, no higher. This is where the side of the shoulder works hardest.',
      lower: 'Lower the weights slowly. Do not let them drop.',
      start: 'Arms by your sides, with the elbows a little bent.',
    },
    ready: 'Standing tall, a dumbbell in each hand by the thighs.',
    form: {
      setup: ['Stand tall with your feet at hip width.', 'Hold a dumbbell in each hand by your sides, with your palms facing in.', 'Bend your elbows a little and keep them bent the same amount all through.'],
      move: ['Lift both arms out to the sides, and a little in front of your body.', 'Stop when your arms are level with your shoulders.', 'Lower the weights slowly, taking about twice as long as you took to lift them.'],
      mistakes: ['Swinging the body to throw the weights up. Use a lighter weight instead.', 'Shrugging the shoulders up towards the ears. The trapezius then takes over from the shoulder.', 'Lifting the arms above shoulder height. It adds no work for the shoulder and pinches the joint.'],
      breathe: 'Breathe out as you lift. Breathe in as you lower.',
    },
  },
  {
    id: 'front-raise', part: 'Shoulders', name: 'Dumbbell front raise',
    sub: 'Standing, arms lifted straight forward to shoulder height',
    duration: 3.2, equipment: 'dumbbells', load: { kg: 'working' }, stance: { width: 'hip' }, balance: 'hips',
    poses: [
      { at: 0, arms: { raise: 6, plane: 90, elbow: 12, palm: 'down' } },
      { at: 1, arms: { raise: 88, plane: 90, elbow: 12, palm: 'down' } },
    ],
    cues: {
      liftName: 'Raising', lift: 'Lift the arms straight forward. The body stays still.',
      top: 'Arms level with the shoulders. The front of the shoulder works hardest here.',
      lower: 'Lower the weights slowly to the thighs.',
      start: 'Arms hanging in front of the thighs.',
    },
    ready: 'Standing tall, the dumbbells in front of the thighs.',
    form: {
      setup: ['Stand tall with your feet at hip width.', 'Hold the dumbbells in front of your thighs with your palms facing your body.', 'Tighten your stomach so your back does not arch.'],
      move: ['Lift both arms straight forward until they are level with your shoulders.', 'Hold for a moment.', 'Lower slowly to the thighs.'],
      mistakes: ['Leaning back as the weights go up. The lower back takes the strain.', 'Lifting higher than the shoulders.', 'Using a weight so heavy that you have to swing it.'],
      breathe: 'Breathe out as you lift. Breathe in as you lower.',
    },
  },
  {
    id: 'dumbbell-press', part: 'Shoulders', name: 'Dumbbell shoulder press',
    sub: 'Standing, dumbbells pressed from the shoulders to overhead',
    duration: 3.2, equipment: 'dumbbells', load: { kg: 'working' }, stance: { width: 'hip' }, balance: 'hips', view: 'front',
    poses: [
      { at: 0, arms: { raise: 72, plane: 25, turn: 90, elbow: 118, palm: 'in' } },
      { at: 1, arms: { raise: 168, plane: 25, turn: 90, elbow: 14, palm: 'in' } },
    ],
    cues: {
      liftName: 'Pressing up', lift: 'Press the weights straight up. They come a little closer together at the top.',
      top: 'Arms nearly straight above the shoulders. Do not lock the elbows.',
      lower: 'Lower the weights to shoulder height under control.',
      start: 'Dumbbells beside the shoulders, forearms upright.',
    },
    ready: 'Standing tall, a dumbbell beside each shoulder, forearms upright.',
    form: {
      setup: ['Stand tall with your feet at hip width and your stomach tight.', 'Bring the dumbbells up beside your shoulders, with your palms facing forward.', 'Keep your forearms upright, with each wrist over its elbow.'],
      move: ['Press both weights straight up until your arms are nearly straight.', 'Keep your ribs down. Do not lean back.', 'Lower the weights slowly to shoulder height.'],
      mistakes: ['Arching the lower back to push the weights up.', 'Letting the elbows drift far behind the body.', 'Locking the elbows hard at the top.'],
      breathe: 'Breathe out as you press. Breathe in as you lower.',
    },
  },
  {
    id: 'dumbbell-curl', part: 'Biceps', name: 'Dumbbell curl',
    sub: 'Standing, palms up, both arms together',
    duration: 3.2, equipment: 'dumbbells', load: { kg: 'working' }, stance: { width: 'hip' }, balance: 'hips',
    poses: [
      { at: 0, arms: { raise: 2, plane: 90, elbow: 10, palm: 'up' } },
      { at: 1, arms: { raise: 10, plane: 90, elbow: 132, palm: 'up' } },
    ],
    cues: {
      liftName: 'Curling up', lift: 'Only the forearms move. The elbows stay at your sides.',
      top: 'Squeeze the biceps for a moment with the weights in front of the shoulders.',
      lower: 'Lower slowly. The biceps are still working as they lengthen.',
      start: 'Arms straight by your sides, palms forward.',
    },
    ready: 'Standing tall, dumbbells by the thighs with the palms forward.',
    form: {
      setup: ['Stand tall with your feet at hip width.', 'Hold a dumbbell in each hand with your palms facing forward.', 'Keep your elbows close to your sides.'],
      move: ['Bend your elbows and curl the weights up towards your shoulders.', 'Squeeze at the top for a moment.', 'Lower slowly until your arms are straight.'],
      mistakes: ['Swinging the body to help the weights up.', 'Letting the elbows travel forward. The shoulders then take over.', 'Stopping halfway down.'],
      breathe: 'Breathe out as you curl up. Breathe in as you lower.',
    },
  },
  {
    id: 'reverse-fly', part: 'Back', name: 'Bent-over reverse fly',
    sub: 'Hinged forward, arms opened out to the sides',
    duration: 3.2, equipment: 'dumbbells', load: { kg: 'working' }, stance: { width: 'hip' }, balance: 'hips', view: 'three-quarter',
    poses: [
      { at: 0, legs: { knee: 22 }, trunk: { lean: 62 }, arms: { raise: 2, plane: 0, elbow: 16, palm: 'in' } },
      { at: 1, legs: { knee: 22 }, trunk: { lean: 62 }, arms: { raise: 86, plane: -6, elbow: 16, palm: 'in' }, girdle: { back: 12 } },
    ],
    cues: {
      liftName: 'Opening out', lift: 'Open the arms out to the sides. The back stays flat and still.',
      top: 'Squeeze the shoulder blades together. The back of the shoulder works hardest here.',
      lower: 'Lower the weights slowly until they hang under the shoulders.',
      start: 'Hinged forward with a flat back, the weights hanging under the shoulders.',
    },
    ready: 'Hinged forward at the hips with a flat back, the dumbbells hanging under the shoulders.',
    form: {
      setup: ['Stand with your feet at hip width and bend your knees a little.', 'Push your hips back and lean forward with a flat back.', 'Let the dumbbells hang under your shoulders, with your palms facing each other.'],
      move: ['Lift both arms out to the sides until they are level with your back.', 'Squeeze your shoulder blades together.', 'Lower the weights slowly.'],
      mistakes: ['Rounding the back.', 'Standing up as the weights rise. The lean should not change.', 'Using the momentum of a swing.'],
      breathe: 'Breathe out as you open the arms. Breathe in as you lower.',
    },
  },
  {
    id: 'dumbbell-shrug', part: 'Traps', name: 'Dumbbell shrug',
    sub: 'Standing, dumbbells by the sides, shoulders straight up',
    duration: 3.0, equipment: 'dumbbells', load: { kg: 'working' }, stance: { width: 'hip' }, balance: 'hips', view: 'front',
    poses: [
      { at: 0, arms: { raise: 3, plane: 0, elbow: 8, palm: 'in' }, girdle: { lift: -4 } },
      { at: 1, arms: { raise: 3, plane: 0, elbow: 8, palm: 'in' }, girdle: { lift: 22 } },
    ],
    cues: {
      liftName: 'Shoulders up', lift: 'Lift the shoulders straight up towards the ears. The arms stay straight.',
      top: 'Hold the shoulders high for a moment.',
      lower: 'Let the shoulders down slowly, all the way.',
      start: 'Shoulders low, arms hanging straight.',
    },
    ready: 'Standing tall, a dumbbell in each hand by the sides.',
    form: {
      setup: ['Stand tall with a dumbbell in each hand by your sides.', 'Keep your arms straight and your chest up.'],
      move: ['Lift your shoulders straight up as high as they go.', 'Hold for a moment.', 'Lower them slowly, all the way down.'],
      mistakes: ['Rolling the shoulders in circles. Straight up and down is enough.', 'Bending the elbows to help.', 'Pushing the head forward.'],
      breathe: 'Breathe out as you lift. Breathe in as you lower.',
    },
  },
  {
    id: 'bodyweight-squat', part: 'Quads', name: 'Bodyweight squat',
    sub: 'No weight, arms forward for balance, down to thighs level',
    duration: 3.4, equipment: 'none', stance: { width: 'shoulder', toeOut: 18 }, balance: true,
    timing: [[0, 0], [0.42, 1], [0.5, 1], [0.9, 0], [1, 0]],
    poses: [
      { at: 0, legs: { knee: 6, shin: 2.3 }, arms: { raise: 8, plane: 90, elbow: 8, palm: 'in' } },
      { at: 0.5, legs: { knee: 54, shin: 17 }, arms: { raise: 55, plane: 90, elbow: 10, palm: 'in' } },
      { at: 1, legs: { knee: 104, shin: 29 }, arms: { raise: 82, plane: 90, elbow: 10, palm: 'in' } },
    ],
    cues: {
      liftName: 'Going down', lift: 'Hips back and knees forward together. The knees follow the toes.',
      topName: 'The bottom', top: 'Thighs level with the floor, heels down, back straight.',
      lowerName: 'Standing up', lower: 'Push the floor away. Hips and chest rise together.',
      startName: 'Standing tall', start: 'Stand tall and get ready for the next one.',
    },
    phases: [
      { key: 'down', name: 'Going down', t0: 0, t1: 0.42, hint: 'Hips back and knees forward together. The knees follow the toes.' },
      { key: 'bottom', name: 'The bottom', t0: 0.42, t1: 0.5, hint: 'Thighs level with the floor, heels down, back straight.' },
      { key: 'up', name: 'Standing up', t0: 0.5, t1: 0.9, work: true, hint: 'Push the floor away. Hips and chest rise together.' },
      { key: 'stand', name: 'Standing tall', t0: 0.9, t1: 1, hint: 'Stand tall and get ready for the next one.' },
    ],
    ready: 'Standing tall, feet a little wider than the hips, toes turned out a little.',
    form: {
      setup: ['Stand with your feet a little wider than your hips and your toes turned out a little.', 'Tighten your stomach and keep your chest up.'],
      move: ['Sit down and back, as if onto a low chair. Your arms come forward to balance you.', 'Go down until your thighs are level with the floor.', 'Keep your heels on the floor and your knees in line with your toes.', 'Push through your whole foot to stand up.'],
      mistakes: ['Letting the knees fall inward.', 'Lifting the heels.', 'Rounding the lower back at the bottom.'],
      breathe: 'Breathe in as you go down. Breathe out as you stand up.',
    },
  },
  {
    id: 'good-morning', part: 'Hamstrings', name: 'Barbell good morning',
    sub: 'Bar on the upper back, hips pushed back, back flat',
    duration: 3.8, equipment: 'barbell-back', load: { kg: 'working' }, stance: { width: 'hip', toeOut: 8 }, balance: 'hips',
    timing: [[0, 0], [0.42, 1], [0.5, 1], [0.9, 0], [1, 0]],
    poses: [
      { at: 0, legs: { knee: 8 }, trunk: { lean: 4 } },
      { at: 1, legs: { knee: 22 }, trunk: { lean: 68 } },
    ],
    phases: [
      { key: 'down', name: 'Hinging down', t0: 0, t1: 0.42, hint: 'Push the hips back. The back stays flat and the knees bend only a little.' },
      { key: 'bottom', name: 'The stretch', t0: 0.42, t1: 0.5, hint: 'The hamstrings are stretched. The back is still flat.' },
      { key: 'up', name: 'Standing up', t0: 0.5, t1: 0.9, work: true, hint: 'Drive the hips forward to stand up.' },
      { key: 'top', name: 'Standing tall', t0: 0.9, t1: 1, hint: 'Hips straight. Do not lean back.' },
    ],
    ready: 'Standing tall with the bar across the upper back.',
    form: {
      setup: ['Set the bar across your upper back, as for a squat.', 'Stand with your feet at hip width and your knees a little bent.', 'Tighten your stomach and keep your back flat.'],
      move: ['Push your hips straight back and let your chest come forward.', 'Stop when you feel a strong stretch in the back of your thighs, or before your back starts to round.', 'Drive your hips forward to stand up.'],
      mistakes: ['Rounding the back. Stop higher instead.', 'Bending the knees so much that it turns into a squat.', 'Starting too heavy. This lift loads the lower back strongly.'],
      breathe: 'Breathe in as you hinge down. Breathe out as you stand up.',
    },
  },
];
