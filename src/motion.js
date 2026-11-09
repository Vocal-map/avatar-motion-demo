export const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
export const smoothstep = (n) => { const t = clamp(n); return t * t * (3 - 2 * t); };

export function neutralPose() {
  return { y: 0, bodyX: 0, bodyZ: 0, headX: 0, headY: 0, headZ: 0,
    rightArmZ: -.10, rightArmX: 0, rightElbowZ: 0, rightElbowX: 0,
    leftArmZ: .10, leftArmX: 0, leftElbowZ: 0, leftElbowX: 0,
    rightLegX: 0, leftLegX: 0, kneeX: 0, eyeScale: 1 };
}

// Frame-rate-independent, absolute poses: every action starts and ends at rest.
export function poseAt(action, progress, intensity = 1) {
  const p = clamp(progress);
  const pose = neutralPose();
  if (p === 0 || p === 1) return pose;
  const envelope = smoothstep(p / .22) * (1 - smoothstep((p - .76) / .24));
  const rhythm = Math.sin(p * Math.PI * 6);
  if (action === 'wave') {
    const lift = smoothstep(p / .20) * (1 - smoothstep((p - .79) / .21));
    const wave = Math.sin(clamp((p - .20) / .59) * Math.PI * 6);
    pose.rightArmZ -= lift * 2.28;
    pose.rightArmX = -.18 * lift;
    pose.rightElbowZ = lift * (-.32 + wave * .36);
    pose.headZ = -.09 * lift;
    pose.headY = -.09 * lift;
    pose.bodyZ = -.035 * lift;
    pose.leftArmZ += .06 * lift;
  } else if (action === 'bow') {
    const bend = smoothstep(p / .32) * (1 - smoothstep((p - .65) / .35));
    pose.bodyX = .79 * bend;
    pose.headX = .16 * bend;
    pose.rightArmX = pose.leftArmX = -.20 * bend;
    pose.rightArmZ = -.10 + .10 * bend;
    pose.leftArmZ = .10 - .10 * bend;
    pose.rightElbowX = pose.leftElbowX = -.25 * bend;
    pose.eyeScale = 1 - .7 * bend;
  } else if (action === 'jump') {
    let crouch = 0, air = 0;
    if (p < .23) crouch = Math.sin(p / .23 * Math.PI);
    else if (p < .70) air = Math.sin((p - .23) / .47 * Math.PI);
    else crouch = .55 * Math.sin((p - .70) / .30 * Math.PI);
    // The two leg links sum to 1.45. Their symmetric bend compensates the
    // hip height so both soles stay on the platform during the crouch.
    pose.y = -1.45 * (1 - Math.cos(.55 * crouch)) + .88 * air;
    pose.rightLegX = pose.leftLegX = -.55 * crouch + .13 * air;
    pose.kneeX = 1.1 * crouch + .25 * air;
    pose.bodyX = .10 * crouch;
    pose.rightArmZ -= 1.55 * air;
    pose.leftArmZ += 1.55 * air;
    pose.rightArmX = pose.leftArmX = .15 * crouch;
    pose.headX = -.10 * air;
  } else if (action === 'nod') {
    pose.headX = .30 * envelope * (.5 + .5 * Math.sin(p * Math.PI * 6));
  } else if (action === 'shake') {
    pose.headY = .40 * envelope * rhythm;
    pose.headZ = .04 * envelope;
  } else if (action === 'shrug') {
    pose.rightArmZ -= .55 * envelope;
    pose.leftArmZ += .55 * envelope;
    pose.rightElbowX = pose.leftElbowX = -1.35 * envelope;
    pose.headZ = .15 * envelope;
  } else if (action === 'cheer') {
    const pump = .5 + .5 * rhythm;
    pose.rightArmZ -= (2.3 + .18 * pump) * envelope;
    pose.leftArmZ += (2.3 + .18 * pump) * envelope;
    pose.rightElbowZ = -.30 * pump * envelope;
    pose.leftElbowZ = .30 * pump * envelope;
    pose.headX = -.12 * envelope;
    pose.bodyZ = .06 * rhythm * envelope;
  } else if (action === 'dance') {
    pose.bodyZ = .16 * rhythm * envelope;
    pose.headZ = -.12 * rhythm * envelope;
    pose.headY = .18 * Math.sin(p * Math.PI * 3) * envelope;
    pose.rightArmZ -= (.85 + .40 * rhythm) * envelope;
    pose.leftArmZ += (.85 - .40 * rhythm) * envelope;
    pose.rightElbowX = -(.7 + .4 * rhythm) * envelope;
    pose.leftElbowX = -(.7 - .4 * rhythm) * envelope;
  } else if (action === 'stretch') {
    pose.rightArmZ -= 2.65 * envelope;
    pose.leftArmZ += 2.65 * envelope;
    pose.bodyZ = .10 * Math.sin(p * Math.PI * 2) * envelope;
    pose.headX = -.12 * envelope;
    pose.eyeScale = 1 - .55 * envelope;
  } else if (action === 'think') {
    pose.rightArmX = -.65 * envelope;
    pose.rightArmZ -= .25 * envelope;
    pose.rightElbowX = -1.9 * envelope;
    pose.headX = .12 * envelope;
    pose.headY = -.18 * envelope;
    pose.headZ = -.12 * envelope;
  } else if (action === 'salute') {
    pose.rightArmZ -= 1.25 * envelope;
    pose.rightArmX = -.25 * envelope;
    pose.rightElbowZ = -1.15 * envelope;
    pose.rightElbowX = -.35 * envelope;
    pose.headX = -.06 * envelope;
  }
  const amount = clamp(intensity, .5, 1.2);
  if (amount !== 1) {
    const neutral = neutralPose();
    for (const key of Object.keys(pose)) pose[key] = neutral[key] + (pose[key] - neutral[key]) * amount;
    if (action === 'jump' && (p < .23 || p >= .70)) {
      // Recompute ground contact after scaling the leg angles.
      pose.y = -1.45 + .70 * Math.cos(pose.rightLegX) + .75 * Math.cos(pose.rightLegX + pose.kneeX);
    }
    pose.eyeScale = clamp(pose.eyeScale, .1, 1);
  }
  return pose;
}

export function idlePose(time, reducedMotion = false) {
  const pose = neutralPose();
  if (reducedMotion) return pose;
  // Different slow rhythms keep the head, breath and hands from moving in lockstep.
  const breath = Math.sin(time * 1.45);
  const shift = Math.sin(time * .38) * .7 + Math.sin(time * .17 + .9) * .3;
  pose.bodyX = .008 + breath * .012;
  pose.bodyZ = shift * .022;
  pose.headX = -.018 + Math.sin(time * .63 + 1.1) * .018;
  pose.headY = Math.sin(time * .43) * .075 + Math.sin(time * .19 + .8) * .025;
  pose.headZ = -shift * .018 + Math.sin(time * .71) * .009;
  pose.rightArmX = -.055 + breath * .008;
  pose.leftArmX = -.04 + Math.sin(time * 1.45 - .25) * .008;
  pose.rightElbowX = -.17 + Math.sin(time * .49 + .6) * .025;
  pose.leftElbowX = -.13 + Math.sin(time * .41 + 1.9) * .02;
  pose.rightArmZ -= .025 + Math.sin(time * .57) * .012;
  pose.leftArmZ += .018 + Math.sin(time * .51 + 1.3) * .012;
  // Smooth eyelid closure; a second blink occasionally breaks up the rhythm.
  const phase = ((time % 13.7) + 13.7) % 13.7;
  for (const start of [1.4, 5.6, 5.96, 10.8]) {
    const p = (phase - start) / .21;
    if (p > 0 && p < 1) pose.eyeScale = 1 - .95 * Math.sin(Math.PI * p) ** 2;
  }
  return pose;
}

export function blendPose(from, to, alpha) {
  const t = smoothstep(alpha);
  return Object.fromEntries(Object.keys(to).map((key) => [key, from[key] + (to[key] - from[key]) * t]));
}

// Bounded FIFO: rapid input never overlaps animations or grows without limit.
export class ActionQueue {
  constructor(limit = 3) { this.limit = limit; this.items = []; }
  add(action) {
    if (this.items.length >= this.limit) return false;
    this.items.push(action);
    return true;
  }
  next() { return this.items.shift() ?? null; }
  clear() { this.items.length = 0; }
  get length() { return this.items.length; }
}
