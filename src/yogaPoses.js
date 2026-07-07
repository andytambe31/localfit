/* ---------- yoga pose figures + breath patterns (pure data) ------------------
 * Each pose is a tiny side-profile stick figure defined by named joints in a
 * 200×150 box. A pose animates between two keyframes (base+a ↔ base+b), which
 * shows the movement — cat arches to cow, chest lifts in cobra, hips sink in a
 * lunge. The renderer (YogaAnim) interpolates; this file is just coordinates.
 *
 * Joints (all optional except sh + hip):
 *   H head[x,y] · S spine control[x,y] · sh shoulder · hip · E/Ha arm elbow/hand
 *   E2/Ha2 second arm · K/F front knee/foot · KB/FB back knee/foot
 * base = shared joints; a/b override the few that move.
 *
 * Breath patterns are [inhale, holdFull, exhale, holdEmpty] seconds.
 * -------------------------------------------------------------------------- */

export const BREATH_DEFAULT = [4, 1, 6, 0] // calm, long exhale — down-regulating
export const BREATH_PATTERNS = {
  ujjayi: [4, 0, 6, 0],
  box: [4, 4, 4, 4],
}

export const FIGURES = {
  cat_cow: {
    loopMs: 2600,
    base: { sh: [130, 86], hip: [74, 86], E: [140, 112], Ha: [146, 140], K: [70, 140], F: [46, 140] },
    a: { S: [102, 104], H: [156, 74] },   // cow — belly drops, gaze up
    b: { S: [102, 64], H: [150, 98] },    // cat — spine rounds, gaze down
  },
  down_dog: {
    loopMs: 3200,
    base: { Ha: [40, 140], E: [56, 116], sh: [72, 96], H: [60, 104] },
    a: { hip: [110, 70], K: [140, 112], F: [166, 140] },  // bent-knee entry
    b: { hip: [114, 56], K: [144, 100], F: [170, 140] },  // heels reach, hips lift
  },
  low_lunge: {
    loopMs: 3200,
    base: { E: [96, 30], Ha: [99, 12], K: [136, 94], F: [140, 140], KB: [64, 140], FB: [44, 140] },
    a: { hip: [96, 84], sh: [95, 52], H: [93, 40] },
    b: { hip: [92, 96], sh: [93, 54], H: [91, 42] },  // sink the hips forward
  },
  warrior2: {
    loopMs: 3400,
    base: { sh: [100, 56], H: [100, 42], hip: [100, 92], E: [124, 56], Ha: [152, 56], E2: [76, 56], Ha2: [48, 56], F: [150, 140], KB: [60, 140], FB: [42, 140] },
    a: { K: [142, 84] },
    b: { K: [147, 100] },  // bend into the front knee
  },
  triangle: {
    loopMs: 3400,
    base: { hip: [96, 80], E: [142, 92], Ha: [150, 120], E2: [124, 44], Ha2: [120, 28], K: [124, 110], F: [150, 140], KB: [70, 110], FB: [44, 140] },
    a: { sh: [112, 58], H: [112, 44] },
    b: { sh: [130, 62], H: [142, 54] },  // hinge over the front leg
  },
  cobra: {
    loopMs: 3000,
    base: { hip: [70, 138], K: [46, 140], F: [22, 140], E: [122, 124], Ha: [122, 140] },
    a: { sh: [118, 120], H: [130, 114], S: [95, 126] }, // sphinx — low
    b: { sh: [122, 100], H: [138, 92], S: [96, 116] },  // cobra — chest lifts
  },
  thread_needle: {
    loopMs: 3200,
    base: { hip: [74, 86], K: [70, 140], F: [48, 140], E: [146, 128], Ha: [166, 138], E2: [112, 96], Ha2: [104, 74] },
    a: { sh: [126, 106], H: [142, 112] },
    b: { sh: [120, 124], H: [139, 132] },  // shoulder melts to the mat
  },
  bridge: {
    loopMs: 3000,
    base: { sh: [58, 140], H: [44, 140], E: [52, 140], Ha: [46, 140], K: [140, 108], F: [150, 140] },
    a: { hip: [110, 120] },
    b: { hip: [112, 92] },  // drive the hips up
  },
  malasana: {
    loopMs: 3200,
    base: { sh: [100, 80], H: [100, 66], E: [120, 100], Ha: [100, 96], K: [130, 108], F: [140, 140], KB: [70, 108], FB: [60, 140] },
    a: { hip: [100, 100] },
    b: { hip: [100, 122] },  // sink into the squat
  },
  pigeon: {
    loopMs: 3600,
    base: { hip: [100, 112], E: [150, 128], Ha: [168, 138], K: [110, 138], F: [72, 140], KB: [56, 138], FB: [30, 140] },
    a: { sh: [112, 96], H: [112, 80] },
    b: { sh: [136, 122], H: [151, 130] },  // fold forward over the front leg
  },
  lizard: {
    loopMs: 3600,
    base: { E: [128, 128], Ha: [130, 140], K: [140, 100], F: [140, 140], KB: [56, 138], FB: [36, 140] },
    a: { sh: [112, 96], H: [126, 102], hip: [100, 100] },
    b: { sh: [126, 120], H: [140, 126], hip: [100, 112] },  // lower toward forearms
  },
  forward_fold: {
    loopMs: 3400,
    base: { hip: [70, 122], E: [118, 120], Ha: [138, 132], K: [112, 132], F: [152, 138] },
    a: { sh: [72, 82], H: [72, 66] },
    b: { sh: [96, 108], H: [116, 114] },  // hinge from the hips
  },
  happy_baby: {
    loopMs: 3000,
    base: { sh: [54, 138], H: [42, 138], hip: [96, 130], E: [70, 110], Ha: [80, 88], K: [96, 96] },
    a: { F: [86, 74] },
    b: { F: [78, 90] },  // draw the knees toward the armpits
  },
  seated_twist: {
    loopMs: 3400,
    base: { hip: [80, 124], E: [96, 96], Ha: [112, 100], E2: [66, 110], Ha2: [56, 120], K: [110, 108], F: [96, 138] },
    a: { sh: [80, 84], H: [80, 68] },
    b: { sh: [90, 86], H: [92, 72] },  // rotate from the mid-back
  },
  childs_pose: {
    loopMs: 3400,
    base: { hip: [70, 130], E: [140, 132], Ha: [168, 138], K: [62, 138], F: [46, 140] },
    a: { sh: [100, 116], H: [110, 110] },
    b: { sh: [112, 130], H: [128, 134] },  // melt the chest down
  },
  legs_up_wall: {
    loopMs: 4000,
    base: { sh: [54, 140], H: [42, 140], hip: [120, 138], E: [60, 140], Ha: [48, 140] },
    a: { K: [121, 98], F: [121, 58] },
    b: { K: [123, 94], F: [128, 54] },  // gentle sway, legs vertical
  },
}
