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
