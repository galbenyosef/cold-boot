/**
 * Authored animation clips. Channels:
 *   gun      [px,py,pz, rx,ry,rz]  offset from the base pose (pos in base frame, euler local)
 *   lhFree   [w]                    0 = left hand on its socket, 1 = free pose below
 *   lhP/lhF/lhD [x,y,z]             free left-hand wrist position / finger dir / back-of-hand dir (gun space)
 *   lhAttach [w]                    shotgun: follow the live pump socket (1) or its rest position (0)
 *   pistol:  magSlide [m] (mag pulled down the well), magAlign [w] (spare mag hand→well), slide [m]
 *   shotgun: pump [0..1], shellAlign [w] (held shell hand→port), shellSlide [0..1] (into the port)
 * Events: 'lh:<pose>' switch left-hand finger pose; others are handled by the rig / weapon logic.
 */
import type { Clip } from './anim';

const SUPPORT_P = [-0.05, -0.05, 0.066];
const SUPPORT_F = [0.15, -0.35, -0.92];
const SUPPORT_D = [-1, -0.1, 0.1];

const tiltPistol = (t: number, k = 1): number[] => [t, -0.02 * k, 0.035 * k, 0.015 * k, 0.18 * k, 0.22 * k, 0.5 * k];

// hand path shared by both pistol reloads up to the mag seating
const lhPMag: number[][] = [
  [0.0, ...SUPPORT_P],
  [0.2, -0.065, -0.14, 0.075],
  [0.42, -0.11, -0.32, 0.1],
  [0.62, -0.1, -0.31, 0.1],
  [0.84, -0.055, -0.22, 0.085],
  [0.97, -0.034, -0.168, 0.075],
  [1.06, -0.033, -0.128, 0.063],
];
const lhFMag: number[][] = [
  [0.0, ...SUPPORT_F],
  [0.2, 0.0, -0.75, -0.6],
  [0.42, 0.1, -0.9, -0.3],
  [0.62, 0.1, -0.3, -0.9],
  [0.84, 0.0, 0.62, -0.78],
  [1.06, 0.0, 0.72, -0.66],
];
const lhDMag: number[][] = [
  [0.0, ...SUPPORT_D],
  [0.42, -0.9, 0.1, 0.3],
  [0.84, -1, 0.05, 0.1],
  [1.06, -1, 0.0, 0.05],
];

export const PISTOL_CLIPS: Record<string, Clip> = {
  reload: {
    name: 'reload', dur: 1.55,
    tracks: {
      gun: [[0, 0, 0, 0, 0, 0, 0], tiltPistol(0.22), tiltPistol(0.7, 1.08), tiltPistol(1.0), [1.07, -0.02, 0.046, 0.015, 0.24, 0.22, 0.48], [1.38, 0, 0.002, 0, 0.01, 0, 0], [1.55, 0, 0, 0, 0, 0, 0]],
      lhFree: [[0, 0], [0.06, 0], [0.22, 1], [1.12, 1], [1.4, 0]],
      lhP: [...lhPMag, [1.18, -0.05, -0.15, 0.075], [1.4, ...SUPPORT_P]],
      lhF: [...lhFMag, [1.2, 0.05, 0.0, -0.95], [1.4, ...SUPPORT_F]],
      lhD: [...lhDMag, [1.4, ...SUPPORT_D]],
      magSlide: [[0, 0], [0.12, 0], [0.2, 0.038], [0.89, 0.065], [0.97, 0.042], [1.06, 0]],
      magAlign: [[0, 0], [0.84, 0], [0.95, 1], [1.2, 1]],
    },
    events: [[0.08, 'lh:open'], [0.13, 'magRelease'], [0.22, 'magDrop'], [0.52, 'magGrab'], [0.52, 'lh:mag'], [0.95, 'magAttach'], [1.06, 'magIn'], [1.12, 'lh:open'], [1.3, 'lh:support']],
  },
  reloadEmpty: {
    name: 'reloadEmpty', dur: 1.7,
    tracks: {
      gun: [[0, 0, 0, 0, 0, 0, 0], tiltPistol(0.22), tiltPistol(0.7, 1.08), tiltPistol(1.0), [1.07, -0.02, 0.046, 0.015, 0.24, 0.22, 0.48],
        [1.2, -0.012, 0.03, 0.01, 0.12, 0.12, 0.26], [1.27, -0.01, 0.036, 0.0, 0.2, 0.1, 0.22], [1.36, -0.006, 0.02, 0.006, 0.05, 0.05, 0.1], [1.55, 0, 0.002, 0, 0.01, 0, 0], [1.7, 0, 0, 0, 0, 0, 0]],
      lhFree: [[0, 0], [0.06, 0], [0.22, 1], [1.14, 1], [1.4, 0]],
      lhP: [...lhPMag, [1.18, -0.05, -0.15, 0.075], [1.4, ...SUPPORT_P]],
      lhF: [...lhFMag, [1.2, 0.05, 0.0, -0.95], [1.4, ...SUPPORT_F]],
      lhD: [...lhDMag, [1.4, ...SUPPORT_D]],
      magSlide: [[0, 0], [0.12, 0], [0.2, 0.038], [0.89, 0.065], [0.97, 0.042], [1.06, 0]],
      magAlign: [[0, 0], [0.84, 0], [0.95, 1], [1.2, 1]],
      slide: [[0, 0.029], [1.22, 0.029], [1.25, 0.0], [1.7, 0]],
    },
    events: [[0.08, 'lh:open'], [0.13, 'magRelease'], [0.22, 'magDrop'], [0.52, 'magGrab'], [0.52, 'lh:mag'], [0.95, 'magAttach'], [1.06, 'magIn'], [1.12, 'lh:open'], [1.22, 'slideRelease'], [1.3, 'lh:support']],
  },
};

// shotgun
const PUMP_P = [-0.041, -0.021, -0.257];
const PUMP_F = [0.5, 0.02, -0.86];
const PUMP_D = [-0.4, -0.9, -0.1];
const READY_P = [-0.07, -0.085, -0.17];
const READY_F = [0.25, 0.55, -0.8];
const READY_D = [-0.9, -0.35, 0.15];
const TILT = [-0.025, 0.02, -0.01, 0.12, 0.1, -0.48];

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
      lhFree: [[0, 0], [0.08, 0], [0.3, 1], [0.4, 1]],
      lhP: [[0, ...PUMP_P], [0.3, ...READY_P]],
      lhF: [[0, ...PUMP_F], [0.3, ...READY_F]],
      lhD: [[0, ...PUMP_D], [0.3, ...READY_D]],
    },
    events: [[0.08, 'lh:open']],
  },
  reloadInsert: {
    name: 'reloadInsert', dur: 0.6,
    tracks: {
      gun: [[0, ...TILT], [0.38, ...TILT], [0.43, TILT[0], TILT[1] + 0.004, TILT[2] - 0.006, TILT[3] + 0.03, TILT[4], TILT[5] - 0.03], [0.52, ...TILT], [0.6, ...TILT]],
      lhFree: [[0, 1], [0.6, 1]],
      lhP: [[0, ...READY_P], [0.13, -0.085, -0.012, -0.135], [0.17, -0.088, -0.026, -0.135], [0.3, -0.05, -0.085, -0.125], [0.36, -0.03, -0.062, -0.13], [0.43, -0.026, -0.046, -0.165], [0.6, ...READY_P]],
      lhF: [[0, ...READY_F], [0.13, 0.25, 0.4, -0.9], [0.3, 0.3, 0.25, -0.92], [0.43, 0.25, 0.3, -0.92], [0.6, ...READY_F]],
      lhD: [[0, ...READY_D], [0.13, -0.95, 0.0, 0.3], [0.3, -0.7, -0.7, 0.15], [0.43, -0.7, -0.7, 0.15], [0.6, ...READY_D]],
      shellAlign: [[0, 0], [0.2, 0], [0.32, 1], [0.6, 1]],
      shellSlide: [[0, 0], [0.33, 0], [0.42, 1], [0.6, 1]],
    },
    events: [[0.05, 'lh:open'], [0.12, 'lh:shell'], [0.145, 'shellGrab'], [0.42, 'shellIn'], [0.45, 'lh:open']],
  },
  reloadExit: {
    name: 'reloadExit', dur: 0.42,
    tracks: {
      gun: [[0, ...TILT], [0.34, 0, 0.002, 0, 0.01, 0, 0], [0.42, 0, 0, 0, 0, 0, 0]],
      lhFree: [[0, 1], [0.1, 1], [0.34, 0]],
      lhP: [[0, ...READY_P], [0.34, ...PUMP_P]],
      lhF: [[0, ...READY_F], [0.34, ...PUMP_F]],
      lhD: [[0, ...READY_D], [0.34, ...PUMP_D]],
    },
    events: [[0.24, 'lh:pump']],
  },
};
