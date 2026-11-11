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

// gun brought up and rolled so the mag well faces the incoming support hand
const tiltPistol = (t: number, k = 1): number[] => [t, -0.045 * k, 0.058 * k, 0.03 * k, 0.34 * k, 0.12 * k, -0.52 * k];

// support-hand path: peel off the grip, down to the belt, back up under the mag well, then away and home
const lhPMag: number[][] = [
  [0.0, -0.04, -0.03, 0.09],
  [0.2, -0.075, -0.12, 0.1],
  [0.42, -0.13, -0.36, 0.17],
  [0.6, -0.12, -0.34, 0.16],
  [0.86, -0.0255, -0.25, 0.07],
  [1.0, -0.0255, -0.2, 0.056],
  [1.12, -0.04, -0.2, 0.085],
  [1.42, -0.04, -0.03, 0.09],
];
const lhFMag: number[][] = [
  [0.0, -0.15, -0.5, -0.85],
  [0.2, -0.1, -0.75, -0.65],
  [0.42, 0.1, -0.95, -0.2],
  [0.6, 0.1, -0.3, -0.9],
  [0.86, 0.0, 0.96, -0.28],
  [1.0, 0.0, 0.96, -0.28],
  [1.12, -0.05, 0.75, -0.6],
  [1.42, -0.15, -0.5, -0.85],
];
const lhDMag: number[][] = [
  [0.0, -1, 0, 0.17],
  [0.42, -0.95, 0.1, 0.3],
  [0.86, -1, 0, 0],
  [1.12, -1, 0.05, 0.1],
  [1.42, -1, 0, 0.17],
];
const magSlide: number[][] = [[0, 0], [0.12, 0], [0.2, 0.04], [0.3, 0.115], [0.86, 0.115], [0.95, 0.07], [1.0, 0.03], [1.06, 0], [1.2, 0]];
const magAlign: number[][] = [[0, 0], [0.68, 0], [0.86, 1], [1.0, 1], [1.12, 0]];
const lhMagPoses: [number, string][] = [[0, 'rest'], [0.18, 'open'], [0.42, 'relaxed'], [0.52, 'mag'], [1.0, 'mag'], [1.14, 'open'], [1.42, 'rest']];
const magEvents: [number, string][] = [[0.13, 'magRelease'], [0.22, 'magDrop'], [0.52, 'magGrab'], [0.95, 'magAttach'], [1.06, 'magIn']];

export const PISTOL_CLIPS: Record<string, Clip> = {
  reload: {
    name: 'reload', dur: 1.55,
    tracks: {
      gun: [[0, 0, 0, 0, 0, 0, 0], tiltPistol(0.24), tiltPistol(0.7, 1.06), tiltPistol(1.0), [1.07, -0.045, 0.068, 0.03, 0.38, 0.12, -0.5], [1.4, 0, 0.002, 0, 0.01, 0, 0], [1.55, 0, 0, 0, 0, 0, 0]],
      lhFree: [[0, 0], [0.05, 0], [0.22, 1], [1.16, 1], [1.42, 0]],
      lhP: lhPMag, lhF: lhFMag, lhD: lhDMag, magSlide, magAlign,
    },
    poses: { lh: lhMagPoses },
    events: magEvents,
  },
  reloadEmpty: {
    name: 'reloadEmpty', dur: 1.7,
    tracks: {
      gun: [[0, 0, 0, 0, 0, 0, 0], tiltPistol(0.24), tiltPistol(0.7, 1.06), tiltPistol(1.0), [1.07, -0.045, 0.068, 0.03, 0.38, 0.12, -0.5],
        [1.2, -0.015, 0.03, 0.015, 0.14, 0.06, -0.22], [1.27, -0.012, 0.036, 0.004, 0.22, 0.05, -0.18], [1.38, -0.006, 0.018, 0.006, 0.05, 0.02, -0.08], [1.56, 0, 0.002, 0, 0.01, 0, 0], [1.7, 0, 0, 0, 0, 0, 0]],
      lhFree: [[0, 0], [0.05, 0], [0.22, 1], [1.16, 1], [1.42, 0]],
      lhP: lhPMag, lhF: lhFMag, lhD: lhDMag, magSlide, magAlign,
      slide: [[0, 0.029], [1.22, 0.029], [1.25, 0.0], [1.7, 0]],
    },
    poses: { lh: lhMagPoses, rh: [[0, 'grip'], [1.12, 'grip'], [1.21, 'release'], [1.34, 'grip']] },
    events: [...magEvents, [1.22, 'slideRelease']],
  },
};

// shotgun: support hand waits below-left of the receiver between shells
const READY_P = [-0.125, -0.085, -0.15];
const READY_F = [0.72, 0.3, -0.62];
const READY_D = [-0.5, -0.85, 0.1];
// gun rolled so the loading port and the side saddle face the support hand
const TILT = [-0.03, 0.022, -0.01, 0.14, 0.1, -0.5];

export const SHOTGUN_CLIPS: Record<string, Clip> = {
  pump: {
    name: 'pump', dur: 0.56,
    tracks: {
      gun: [[0, 0, 0, 0, 0, 0, 0], [0.16, 0, 0, 0, 0, 0, 0], [0.27, 0.004, -0.006, 0.014, -0.025, -0.01, -0.07], [0.39, 0.0, -0.002, -0.004, 0.0, 0, -0.02], [0.56, 0, 0, 0, 0, 0, 0]],
      pump: [[0, 0], [0.15, 0], [0.265, 1], [0.38, 0], [0.56, 0]],
    },
    events: [[0.25, 'eject'], [0.37, 'chamber']],
  },
  rack: {
    name: 'rack', dur: 0.62,
    tracks: {
      gun: [[0, 0, 0, 0, 0, 0, 0], [0.2, 0.004, -0.006, 0.014, -0.025, -0.01, -0.08], [0.36, 0, -0.002, -0.004, 0, 0, -0.02], [0.62, 0, 0, 0, 0, 0, 0]],
      pump: [[0, 0], [0.06, 0], [0.2, 1], [0.34, 0], [0.62, 0]],
    },
    events: [[0.19, 'eject'], [0.33, 'chamber']],
  },
  reloadEnter: {
    name: 'reloadEnter', dur: 0.4,
    tracks: {
      gun: [[0, 0, 0, 0, 0, 0, 0], [0.34, ...TILT], [0.4, ...TILT]],
      lhFree: [[0, 0], [0.06, 0], [0.32, 1], [0.4, 1]],
      lhP: [[0, ...READY_P]], lhF: [[0, ...READY_F]], lhD: [[0, ...READY_D]],
    },
    poses: { lh: [[0, 'rest'], [0.1, 'rest'], [0.32, 'reach']] },
  },
  reloadInsert: {
    name: 'reloadInsert', dur: 0.6,
    tracks: {
      gun: [[0, ...TILT], [0.38, ...TILT], [0.43, TILT[0], TILT[1] + 0.004, TILT[2] - 0.006, TILT[3] + 0.03, TILT[4], TILT[5] - 0.03], [0.52, ...TILT], [0.6, ...TILT]],
      lhFree: [[0, 1], [0.6, 1]],
      lhP: [[0, ...READY_P]], lhF: [[0, ...READY_F]], lhD: [[0, ...READY_D]],
      shellGrabW: [[0, 0], [0.12, 1], [0.17, 1], [0.31, 0]],
      shellAlign: [[0, 0], [0.19, 0], [0.33, 1], [0.45, 1], [0.58, 0]],
      shellSlide: [[0, 0], [0.34, 0], [0.42, 1], [0.6, 1]],
    },
    poses: { lh: [[0, 'reach'], [0.13, 'shell'], [0.44, 'shell'], [0.56, 'reach']] },
    events: [[0.145, 'shellGrab'], [0.42, 'shellIn']],
  },
  reloadExit: {
    name: 'reloadExit', dur: 0.42,
    tracks: {
      gun: [[0, ...TILT], [0.34, 0, 0.002, 0, 0.01, 0, 0], [0.42, 0, 0, 0, 0, 0, 0]],
      lhFree: [[0, 1], [0.08, 1], [0.34, 0]],
      lhP: [[0, ...READY_P]], lhF: [[0, ...READY_F]], lhD: [[0, ...READY_D]],
    },
    poses: { lh: [[0, 'reach'], [0.12, 'open'], [0.34, 'rest']] },
  },
};
