/**
 * Authored animation clips. Channels:
 *   gun      [px,py,pz, rx,ry,rz]  offset from the base pose (pos in base frame, euler local)
 *   lhFree   [w]                    0 = left hand on its socket, 1 = free pose below
 *   lhP/lhF/lhD [x,y,z]             free left-hand wrist position / finger dir / back-of-hand dir (gun space)
 *   lhAttach [w]                    shotgun: follow the live pump socket (1) or its rest position (0)
 *   pistol:  magSlide [m] (mag pulled down the well), magAlign [w] (steer the hand so its magazine lines up
 *            with the well at magSlide), slide [m]
 *   shotgun: pump [0..1], shellGrabW [w] (steer the hand onto the next side-saddle shell),
 *            shellAlign [w] (steer the hand so its shell sits at the loading port), shellSlide [0..1] (into the port)
 * `poses` key named finger poses per hand (blended continuously); events are handled by the rig / weapon logic.
 */
import type { Clip } from './anim';

/*
 * Pistol reload. The gun never leaves the lower right: it rolls ~35° so the well faces the support side and the
 * muzzle lifts a little (the `gun` channel is only a *target* — the rig chases it with mass, so holds drift and
 * every stop overshoots and settles). Beats overlap: the support hand is already leaving while the gun is still
 * rolling, the fresh magazine is on its way up before the old one has finished falling, and the gun starts back
 * to the eye line while the hand is still rolling into the grip.
 *
 *   0.00 anticipation dip      0.10 thumb on the catch (wrist flick)      0.20 old magazine drops free
 *   0.06–0.47 hand peels off, down to the belt     0.52 fresh magazine in hand     0.60–0.80 back up along an arc
 *   0.80–0.87 magazine guided into the well    0.87–0.97 fingers let go, palm rolls under the baseplate
 *   0.99–1.01 palm strike seats it (knock through the frame)     1.07–1.38 fingers roll back into the grip
 */
const CANT = [0.008, 0.024, 0.052, 0.16, -0.32, -0.94];
const cantKey = (t: number, dx = 0, dy = 0, dz = 0, rx = 0, ry = 0, rz = 0): number[] =>
  [t, CANT[0] + dx, CANT[1] + dy, CANT[2] + dz, CANT[3] + rx, CANT[4] + ry, CANT[5] + rz];
const gunIn: number[][] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0.07, 0.002, -0.005, -0.006, -0.035, 0.01, 0.05],
  cantKey(0.27, 0, 0.004, 0, 0.04, 0, -0.04),
  cantKey(0.5, -0.002, -0.002, 0.003, -0.01, 0.015, 0.02),
  cantKey(0.78, -0.006, -0.008, 0.002, 0.02, 0.03, -0.03), // goes down to meet the magazine
  cantKey(0.99, -0.006, -0.006, 0.002, 0.02, 0.03, -0.03),
  cantKey(1.1, -0.002, 0.006, 0, 0.05, 0.02, 0),
];

// support hand, wrist position / finger direction / back-of-hand direction
const lhP: number[][] = [
  [0.0, -0.04, -0.03, 0.09],
  [0.16, -0.078, -0.08, 0.108],
  [0.32, -0.125, -0.23, 0.15],
  [0.47, -0.15, -0.4, 0.2],
  [0.6, -0.14, -0.37, 0.18],
  [0.72, -0.075, -0.35, 0.125],
  [0.8, -0.025, -0.34, 0.1],
  [0.87, -0.025, -0.275, 0.085],
  [0.97, -0.02, -0.17, 0.07],
  [1.07, -0.02, -0.14, 0.066],
  [1.2, -0.07, -0.085, 0.085],
  [1.38, -0.04, -0.03, 0.09],
];
const lhF: number[][] = [
  [0.0, -0.15, -0.5, -0.85],
  [0.16, -0.2, -0.62, -0.76],
  [0.32, -0.05, -0.92, -0.4],
  [0.47, 0.2, -0.95, -0.1],
  [0.6, 0.05, -0.3, -0.95],
  [0.72, 0.0, 0.6, -0.8],
  [0.8, 0.0, 0.96, -0.28],
  [0.87, 0.0, 0.96, -0.28],
  [0.97, -0.72, 0.0, -0.7],
  [1.07, -0.7, -0.02, -0.72],
  [1.2, -0.3, -0.3, -0.9],
  [1.38, -0.15, -0.5, -0.85],
];
const lhD: number[][] = [
  [0.0, -1, 0, 0.17],
  [0.16, -0.97, 0.1, 0.2],
  [0.32, -0.9, 0.1, 0.4],
  [0.47, -0.85, 0.1, 0.5],
  [0.6, -0.95, 0.05, 0.3],
  [0.72, -1, 0, 0.05],
  [0.8, -1, 0, 0],
  [0.87, -1, 0, 0],
  [0.97, -0.2, -0.95, 0.2],
  [1.07, -0.25, -0.93, 0.2],
  [1.2, -0.8, -0.55, 0.2],
  [1.38, -1, 0, 0.17],
];
const lhFree: number[][] = [[0, 0], [0.04, 0], [0.2, 1], [1.1, 1], [1.38, 0]];
// belt trip in the un-canted body frame (the hand does not swing around with the gun's roll)
const lhBase: number[][] = [[0, 0], [0.08, 0], [0.3, 1], [0.6, 1], [0.78, 0]];
const magSlide: number[][] = [[0, 0], [0.11, 0], [0.16, 0.012], [0.22, 0.06], [0.3, 0.125], [0.8, 0.125], [0.87, 0.055], [0.985, 0.055], [1.005, 0], [1.2, 0]];
const magAlign: number[][] = [[0, 0], [0.64, 0], [0.8, 1], [0.87, 1], [0.95, 0]];
// [weight, gap]: heel under the baseplate — hovers, strikes, stays on through the knock, lets go
const strike: number[][] = [[0, 0, 0.04], [0.87, 0, 0.04], [0.955, 1, 0.034], [0.972, 1, 0.03], [0.99, 1, 0], [1.05, 1, 0], [1.16, 0, 0.012]];
const lhMagPoses: [number, string][] = [[0, 'rest'], [0.16, 'open'], [0.4, 'relaxed'], [0.5, 'mag'], [0.87, 'mag'], [0.96, 'push'], [1.08, 'push'], [1.24, 'relaxed'], [1.38, 'rest']];
const rhMagPoses: [number, string][] = [[0, 'grip'], [0.06, 'grip'], [0.12, 'release'], [0.17, 'release'], [0.27, 'grip']];
const magEvents: [number, string][] = [[0.11, 'magRelease'], [0.2, 'magDrop'], [0.52, 'magGrab'], [0.87, 'magAttach'], [1.01, 'magIn']];
// eyes: a glance down at the well, deepest as the magazine goes in ([pitch, yaw] degrees)
const camIn: number[][] = [[0, 0, 0], [0.12, 0, 0], [0.4, -1.2, -0.5], [0.8, -1.5, -0.6], [1.0, -2.0, -0.7]];

export const PISTOL_CLIPS: Record<string, Clip> = {
  reload: {
    name: 'reload', dur: 1.55,
    tracks: {
      gun: [...gunIn, [1.36, 0, 0.002, 0, 0.012, 0, 0.01], [1.55, 0, 0, 0, 0, 0, 0]],
      lhFree, lhBase, lhP, lhF, lhD, magSlide, magAlign, strike,
      cam: [...camIn, [1.2, -0.6, -0.2], [1.4, 0, 0], [1.55, 0, 0]],
    },
    poses: { lh: lhMagPoses, rh: rhMagPoses },
    events: magEvents,
  },
  reloadEmpty: {
    name: 'reloadEmpty', dur: 1.7,
    tracks: {
      // comes most of the way back, the thumb drops the slide (the rig dips the gun), then it settles on target
      gun: [...gunIn, [1.26, -0.003, -0.004, 0.012, 0.1, 0.01, -0.2], [1.36, -0.002, -0.002, 0.008, 0.07, 0.005, -0.13], [1.56, 0, 0.002, 0, 0.012, 0, 0.01], [1.7, 0, 0, 0, 0, 0, 0]],
      lhFree, lhBase, lhP, lhF, lhD, magSlide, magAlign, strike,
      slide: [[0, 0.029], [1.27, 0.029], [1.295, 0.0], [1.7, 0]],
      cam: [...camIn, [1.25, -0.9, -0.3], [1.5, 0, 0], [1.7, 0, 0]],
    },
    poses: { lh: lhMagPoses, rh: [...rhMagPoses, [1.16, 'grip'], [1.25, 'release'], [1.38, 'grip']] },
    events: [...magEvents, [1.27, 'slideRelease']],
  },
};

/*
 * Shotgun. The pump is a two-handed shove: the support hand hauls the fore-end back while the gun rides into the
 * shoulder, then drives it forward; the rig adds the knock when the slide hits each stop. Reloading rolls the gun
 * outboard so the loading port faces up-left, the support hand strips a shell out of the side saddle, tucks under
 * the receiver and thumbs it in — already swinging back toward the saddle as the insert ends, so consecutive
 * shells flow into each other (the rig varies path, tempo and the push per shell).
 */
// support hand waits below-left of the receiver between shells
const READY_P = [-0.125, -0.085, -0.15];
const READY_F = [0.72, 0.3, -0.62];
const READY_D = [-0.5, -0.85, 0.1];
// gun rolled so the loading port and the side saddle face the support hand, butt dropped off the shoulder
const TILT = [-0.014, 0.016, 0.02, 0.045, -0.08, -0.7];
const tilt = (t: number, dx = 0, dy = 0, dz = 0, rx = 0, ry = 0, rz = 0): number[] =>
  [t, TILT[0] + dx, TILT[1] + dy, TILT[2] + dz, TILT[3] + rx, TILT[4] + ry, TILT[5] + rz];
const GLANCE = [-1.6, 0.3];

export const SHOTGUN_CLIPS: Record<string, Clip> = {
  pump: {
    name: 'pump', dur: 0.56,
    tracks: {
      // rides back with the haul (muzzle lifts, rolls toward the working hand), is shoved forward and down, settles
      gun: [[0, 0, 0, 0, 0, 0, 0], [0.13, 0, 0, 0, 0, 0, 0], [0.25, 0.004, 0.003, 0.02, 0.05, -0.015, -0.09], [0.37, -0.002, -0.004, -0.012, -0.035, 0.01, 0.04], [0.47, 0, 0, 0, 0, 0, 0], [0.56, 0, 0, 0, 0, 0, 0]],
      pump: [[0, 0], [0.13, 0], [0.17, 0.12], [0.245, 1], [0.275, 1], [0.3, 0.8], [0.36, 0], [0.56, 0]],
    },
    events: [[0.25, 'eject'], [0.37, 'chamber']],
  },
  rack: {
    name: 'rack', dur: 0.62,
    tracks: {
      gun: [[0, 0, 0, 0, 0, 0, 0], [0.05, 0, -0.002, -0.004, -0.01, 0, 0.01], [0.2, 0.004, 0.003, 0.02, 0.05, -0.015, -0.1], [0.34, -0.002, -0.004, -0.012, -0.035, 0.01, 0.04], [0.46, 0, 0, 0, 0, 0, 0], [0.62, 0, 0, 0, 0, 0, 0]],
      pump: [[0, 0], [0.07, 0], [0.11, 0.12], [0.19, 1], [0.225, 1], [0.25, 0.8], [0.32, 0], [0.62, 0]],
    },
    events: [[0.19, 'eject'], [0.33, 'chamber']],
  },
  reloadEnter: {
    name: 'reloadEnter', dur: 0.4,
    tracks: {
      gun: [[0, 0, 0, 0, 0, 0, 0], [0.06, 0.002, -0.004, -0.004, -0.02, 0.01, 0.04], tilt(0.34, 0, 0.004, 0, 0.02, 0, -0.03), tilt(0.4)],
      lhFree: [[0, 0], [0.03, 0], [0.3, 1], [0.4, 1]],
      lhP: [[0, -0.07, -0.06, -0.26], [0.16, -0.12, -0.1, -0.22], [0.34, ...READY_P]],
      lhF: [[0, ...READY_F]], lhD: [[0, ...READY_D]],
      shellGrabW: [[0, 0], [0.28, 0], [0.4, 0.3]],
      cam: [[0, 0, 0], [0.4, ...GLANCE]],
    },
    poses: { lh: [[0, 'rest'], [0.06, 'rest'], [0.2, 'relaxed'], [0.36, 'reach']] },
  },
  reloadInsert: {
    name: 'reloadInsert', dur: 0.6,
    tracks: {
      // leans into the hand as the shell comes round, then eases back up (the push itself is the rig's knock)
      gun: [tilt(0), tilt(0.2, 0.001, 0.002, 0, 0.01, 0, 0.02), tilt(0.38, -0.002, -0.005, 0.002, -0.015, 0.01, -0.04), tilt(0.5, 0, 0.003, -0.003, 0.02, 0, 0.01), tilt(0.6)],
      lhFree: [[0, 1], [0.6, 1]],
      lhP: [[0, ...READY_P]], lhF: [[0, ...READY_F]], lhD: [[0, ...READY_D]],
      shellGrabW: [[0, 0.3], [0.11, 1], [0.165, 1], [0.3, 0], [0.47, 0], [0.6, 0.3]],
      shellAlign: [[0, 0], [0.18, 0], [0.33, 1], [0.45, 1], [0.57, 0]],
      shellSlide: [[0, 0], [0.34, 0], [0.37, 0.2], [0.42, 1], [0.6, 1]],
      cam: [[0, ...GLANCE], [0.42, GLANCE[0] - 0.3, GLANCE[1]], [0.6, ...GLANCE]],
    },
    poses: { lh: [[0, 'reach'], [0.12, 'shell'], [0.44, 'shell'], [0.55, 'reach']] },
    events: [[0.145, 'shellGrab'], [0.42, 'shellIn']],
  },
  reloadExit: {
    name: 'reloadExit', dur: 0.42,
    tracks: {
      gun: [tilt(0), tilt(0.06, 0, 0.003, 0, 0.01, 0, -0.02), [0.32, 0, 0.002, 0, 0.012, 0, 0.015], [0.42, 0, 0, 0, 0, 0, 0]],
      lhFree: [[0, 1], [0.05, 1], [0.32, 0]],
      lhP: [[0, ...READY_P]], lhF: [[0, ...READY_F]], lhD: [[0, ...READY_D]],
      cam: [[0, ...GLANCE], [0.3, 0, 0], [0.42, 0, 0]],
    },
    poses: { lh: [[0, 'reach'], [0.16, 'relaxed'], [0.32, 'rest']] },
  },
};

/*
 * Carbine (stage 3b §8.3). Magazine change with the support hand: the gun rolls right so the well and the left flank
 * face the eye, the hand closes on the old magazine, thumbs the paddle, strips it out and lets it fall, goes to the
 * pouch at the belt, brings the fresh one up from below, steers it into the well and shoves it home (the rig steers
 * the hand so the held magazine is exactly where the well wants it). Empty: the charging handle was locked back by
 * the last round — after the magazine the hand reaches over the left flank, pinches the knob, draws it off its
 * notch and lets it slam forward, then returns to the handguard.
 *
 *   reload 2.2 s:  0.36 magRelease · 0.40 magOut · 0.76 magDrop · 1.06 magGrab · 1.46 magAttach · 1.61 magIn
 *   reloadEmpty 2.6 s: same, then 1.99 boltRelease
 *   raise 0.38 s (0.29 raised: the support hand lands on the handguard) · lower 0.22 s
 * Channels: magHold [w] (steer the hand so its magazine sits at the well, `magSlide` below the seat), magSlide [m],
 * chHold [w] (steer the pinch onto the charging-handle knob), chPull [m] (extra pull past the locked position).
 */
const CC = [-0.06, 0.05, 0.0, 0.4, -0.14, -0.32];
const cc = (t: number, dx = 0, dy = 0, dz = 0, rx = 0, ry = 0, rz = 0): number[] =>
  [t, CC[0] + dx, CC[1] + dy, CC[2] + dz, CC[3] + rx, CC[4] + ry, CC[5] + rz];
const cGun: number[][] = [
  [0, 0, 0, 0, 0, 0, 0],
  [0.08, 0.002, -0.004, -0.004, -0.03, 0.01, 0.04],
  cc(0.3),
  cc(0.5, 0, -0.002, 0, -0.01, 0, 0.01),
  cc(0.62, 0, 0.006, 0, 0.035, 0, -0.03), // magazine yanked out: the gun bucks up off it
  cc(0.9, 0, -0.003, 0.002, -0.01, 0.01, 0.02),
  cc(1.4, -0.002, -0.004, 0.002, 0, 0.01, 0.0),
  cc(1.5, 0, -0.008, 0, -0.025, 0, 0.0), // leans down onto the fresh magazine
  cc(1.62, 0, 0.006, -0.002, 0.04, 0, 0.03), // seated
];
// support hand: wrist / fingers / back of hand (gun frame; the belt trip in the base frame)
const cP: number[][] = [
  [0.0, -0.03, 0.0, -0.21], [0.18, -0.06, -0.06, -0.15], [0.3, -0.035, -0.135, -0.075], [0.62, -0.03, -0.18, -0.07],
  [0.72, -0.07, -0.21, -0.04], [0.82, -0.17, -0.36, 0.2], [1.0, -0.18, -0.38, 0.22], [1.12, -0.16, -0.33, 0.18],
  [1.3, -0.06, -0.25, -0.05], [1.42, -0.03, -0.2, -0.07], [1.62, -0.026, -0.124, -0.068],
];
const cF: number[][] = [
  [0.0, 0.47, 0.1, -0.88], [0.18, 0.25, -0.1, -0.95], [0.3, 0, 0, -1], [0.62, 0, 0, -1], [0.72, 0.1, -0.3, -0.95],
  [0.82, 0.2, -0.95, -0.1], [1.12, 0.2, -0.9, -0.3], [1.3, 0, -0.3, -0.95], [1.42, 0, 0, -1], [1.62, 0, 0, -1],
];
const cD: number[][] = [
  [0.0, -0.28, -0.96, 0.05], [0.18, -0.7, -0.7, 0.05], [0.3, -1, 0, 0], [0.62, -1, 0, 0], [0.72, -0.9, -0.3, 0.1],
  [0.82, -0.85, 0.1, 0.5], [1.12, -0.85, 0.1, 0.4], [1.3, -1, -0.1, 0.1], [1.42, -1, 0, 0], [1.62, -1, 0, 0],
];
const cBase: number[][] = [[0, 0], [0.68, 0], [0.82, 1], [1.12, 1], [1.28, 0]];
const cHold: number[][] = [[0, 0], [0.22, 0], [0.34, 1], [0.64, 1], [0.74, 0], [1.36, 0], [1.46, 1], [1.66, 1], [1.76, 0]];
const cSlide: number[][] = [[0, 0], [0.38, 0], [0.42, 0.006], [0.5, 0.04], [0.6, 0.075], [0.66, 0.08], [1.3, 0.065], [1.46, 0.06], [1.52, 0.035], [1.6, 0.002], [1.62, 0]];
const cEvents: [number, string][] = [[0.36, 'magRelease'], [0.4, 'magOut'], [0.76, 'magDrop'], [1.06, 'magGrab'], [1.46, 'magAttach'], [1.61, 'magIn']];
const cLh: [number, string][] = [[0, 'rest'], [0.12, 'relaxed'], [0.28, 'open'], [0.36, 'mag'], [0.72, 'mag'], [0.8, 'open'], [0.95, 'relaxed'], [1.06, 'mag'], [1.64, 'mag'], [1.72, 'flat']];
const cRh: [number, string][] = [[0, 'grip'], [0.3, 'grip'], [0.35, 'release'], [0.42, 'release'], [0.5, 'grip']];
const cCam: number[][] = [[0, 0, 0], [0.25, -2.4, -1.0], [0.7, -3.0, -1.2], [1.0, -2.0, -0.8], [1.5, -3.4, -1.2], [1.68, -2.0, -0.6]];

export const CARBINE_CLIPS: Record<string, Clip> = {
  reload: {
    name: 'reload', dur: 2.2,
    tracks: {
      gun: [...cGun, cc(1.8, 0.002, -0.004, -0.012, -0.06, 0.05, 0.2), [2.05, 0, 0.002, 0, 0.012, 0, 0.012], [2.2, 0, 0, 0, 0, 0, 0]],
      lhFree: [[0, 0], [0.05, 0], [0.28, 1], [1.72, 1], [2.0, 0]], lhBase: cBase,
      lhP: [...cP, [1.75, -0.05, -0.14, -0.07], [1.9, -0.05, -0.03, -0.17], [2.0, -0.03, 0.0, -0.21]],
      lhF: [...cF, [1.8, 0.3, 0.1, -0.95], [2.0, 0.47, 0.1, -0.88]],
      lhD: [...cD, [1.8, -0.6, -0.8, 0], [2.0, -0.28, -0.96, 0.05]],
      magHold: cHold, magSlide: cSlide,
      cam: [...cCam, [2.0, 0, 0], [2.2, 0, 0]],
    },
    poses: { lh: [...cLh, [1.85, 'relaxed'], [2.0, 'rest']], rh: cRh },
    events: cEvents,
  },
  reloadEmpty: {
    name: 'reloadEmpty', dur: 2.6,
    tracks: {
      // after the magazine the gun turns its left flank up to the hand, bucks as the handle slams home, settles
      gun: [...cGun, cc(1.8, 0, 0.006, 0, 0.02, -0.06, -0.1), cc(1.98, 0, 0.004, 0, 0.0, -0.06, -0.1), cc(2.2, 0.003, 0, -0.016, -0.08, 0.08, 0.3), [2.45, 0, 0.002, 0, 0.012, 0, 0.01], [2.6, 0, 0, 0, 0, 0, 0]],
      lhFree: [[0, 0], [0.05, 0], [0.28, 1], [2.12, 1], [2.4, 0]], lhBase: cBase,
      lhP: [...cP, [1.72, -0.07, -0.1, -0.1], [1.85, -0.065, -0.05, -0.08], [2.05, -0.065, -0.05, -0.07], [2.2, -0.06, -0.03, -0.15], [2.4, -0.03, 0.0, -0.21]],
      lhF: [...cF, [1.72, 0.05, 0.25, -0.97], [1.85, 0.05, 0.3, -0.95], [2.05, 0.05, 0.3, -0.95], [2.2, 0.4, 0.0, -0.9], [2.4, 0.47, 0.1, -0.88]],
      lhD: [...cD, [1.72, -1, -0.1, 0], [1.85, -1, -0.2, 0], [2.05, -1, -0.2, 0], [2.2, -0.6, -0.8, 0], [2.4, -0.28, -0.96, 0.05]],
      magHold: cHold, magSlide: cSlide,
      chHold: [[0, 0], [1.7, 0], [1.88, 1], [2.02, 1], [2.1, 0]],
      // the pinched knob is drawn off its notch (a few mm further back), then let go
      chPull: [[0, 0], [1.88, 0], [1.96, 0.007], [1.99, 0.007], [2.0, 0]],
      cam: [...cCam, [1.85, -0.6, -1.2], [2.05, -0.4, -1.0], [2.35, 0, 0], [2.6, 0, 0]],
    },
    poses: { lh: [...cLh, [1.8, 'open'], [1.88, 'pinch'], [1.99, 'pinch'], [2.05, 'open'], [2.2, 'relaxed'], [2.4, 'rest']], rh: cRh },
    events: [...cEvents, [1.99, 'boltRelease']],
  },
  raise: {
    name: 'raise', dur: 0.38,
    tracks: {
      gun: [[0, 0.01, -0.03, 0.02, -0.25, 0.12, -0.55], [0.22, 0.002, -0.004, 0.004, 0.03, 0.02, -0.08], [0.3, 0, 0.002, 0, 0.02, 0, 0.02], [0.38, 0, 0, 0, 0, 0, 0]],
    },
    events: [[0.29, 'raised']],
  },
  lower: {
    name: 'lower', dur: 0.22,
    tracks: { gun: [[0, 0, 0, 0, 0, 0, 0], [0.22, 0.01, -0.02, 0.02, -0.2, 0.1, 0.5]] },
  },
};
