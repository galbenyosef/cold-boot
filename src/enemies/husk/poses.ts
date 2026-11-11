/**
 * Keyed FK poses for the husk (dormant poses, wake-up keys, collapse keys). Angles in degrees.
 * Conventions (bind pose = standing, facing +Z, left = +X):
 *   +rx on spine/hips = lean forward; thigh −rx = leg forward; shin +rx = knee flex; uarm −rx = arm forward;
 *   larm −rx = elbow flex; uarm rz = raise sideways (sign handled per side: positive = outward).
 */
import * as THREE from 'three';
import type { Rig } from '../shared/rig';

type A3 = [number, number, number];
export interface PoseSpec {
  hips?: { pos?: A3; rot?: A3 };
  spine1?: A3; spine2?: A3; neck?: A3; head?: A3;
  /** [pitch, twist, rollOut] per arm, elbow flex (positive = bend). */
  armL?: A3; armR?: A3; elbowL?: number; elbowR?: number; handL?: A3; handR?: A3;
  /** [pitch (− = forward), yaw, spread out] per leg, knee flex, foot pitch (+ toes down). */
  legL?: A3; legR?: A3; kneeL?: number; kneeR?: number; footL?: number; footR?: number;
  fingers?: number;
}

const D = Math.PI / 180;
const _e = new THREE.Euler();

function rot(b: THREE.Bone, a: A3 | undefined, side = 1, order: THREE.EulerOrder = 'XYZ') {
  if (!a) { b.quaternion.identity(); return; }
  _e.set(a[0] * D, a[1] * D * side, a[2] * D * side, order);
  b.quaternion.setFromEuler(_e);
}

export function applySpec(rig: Rig, s: PoseSpec): void {
  const B = rig.byName;
  B.hips.position.set(s.hips?.pos?.[0] ?? 0, s.hips?.pos?.[1] ?? 0.98, s.hips?.pos?.[2] ?? 0);
  rot(B.hips, s.hips?.rot);
  rot(B.spine1, s.spine1); rot(B.spine2, s.spine2); rot(B.neck, s.neck); rot(B.head, s.head);
  B.clav_l.quaternion.identity(); B.clav_r.quaternion.identity();
  rot(B.uarm_l, s.armL, 1); rot(B.uarm_r, s.armR, -1);
  B.larm_l.quaternion.setFromEuler(_e.set(-(s.elbowL ?? 0) * D, 0, 0));
  B.larm_r.quaternion.setFromEuler(_e.set(-(s.elbowR ?? 0) * D, 0, 0));
  rot(B.hand_l, s.handL, 1); rot(B.hand_r, s.handR, -1);
  rot(B.thigh_l, s.legL, 1); rot(B.thigh_r, s.legR, -1);
  B.shin_l.quaternion.setFromEuler(_e.set((s.kneeL ?? 0) * D, 0, 0));
  B.shin_r.quaternion.setFromEuler(_e.set((s.kneeR ?? 0) * D, 0, 0));
  B.foot_l.quaternion.setFromEuler(_e.set((s.footL ?? 0) * D, 0, 0));
  B.foot_r.quaternion.setFromEuler(_e.set((s.footR ?? 0) * D, 0, 0));
  const f = (s.fingers ?? 25) * D;
  B.fing_l.quaternion.setFromEuler(_e.set(-f, 0, 0));
  B.fing2_l.quaternion.setFromEuler(_e.set(-f * 1.2, 0, 0));
  B.thumb_l.quaternion.identity();
}

export const HUSK_POSES: Record<string, PoseSpec> = {
  stand: {
    hips: { pos: [0, 0.965, 0] }, spine1: [3, 0, 0], spine2: [4, 0, 0], head: [4, 0, 0],
    armL: [4, 0, 7], armR: [6, 0, 8], elbowL: 14, elbowR: 20, legL: [-6, 0, 2], legR: [-6, 0, 2], kneeL: 12, kneeR: 12, footL: -6, footR: -6,
  },
  /** Sitting on the floor, back against a wall, head on chest. */
  slumped: {
    hips: { pos: [0, 0.135, 0], rot: [-24, 0, 3] },
    spine1: [9, 0, -4], spine2: [13, 4, -3], neck: [26, 0, 6], head: [30, 10, 12],
    armL: [4, 10, 16], elbowL: 22, handL: [0, 0, -20],
    armR: [-8, -20, 10], elbowR: 48, handR: [10, 0, 0],
    legL: [-63, 6, 9], kneeL: 6, footL: 28,
    legR: [-98, -8, 14], kneeR: 96, footR: 4,
    fingers: 40,
  },
  /** Halfway up: one knee down, weight on the left hand. */
  kneel: {
    hips: { pos: [0, 0.5, 0.05], rot: [28, 0, -4] },
    spine1: [14, 0, 0], spine2: [16, -6, 0], neck: [-20, 0, 0], head: [-26, 0, 6],
    armL: [-38, 0, 14], elbowL: 12, armR: [8, 0, 16], elbowR: 50,
    legL: [-36, 0, 6], kneeL: 128, footL: 62,
    legR: [-118, 0, 6], kneeR: 104, footR: -12,
    fingers: 10,
  },
  /** Frozen mid-task: bent over a bench, arms forward. */
  bent: {
    hips: { pos: [0, 0.93, -0.06], rot: [24, 0, 0] },
    spine1: [14, 6, 0], spine2: [12, 8, 0], neck: [14, 0, 0], head: [16, -8, 5],
    armL: [-62, 0, 8], elbowL: 38, handL: [-20, 0, 0],
    armR: [-48, 0, 10], elbowR: 62,
    legL: [-30, 0, 3], kneeL: 16, footL: -10, legR: [-14, 0, 3], kneeR: 18, footR: -28,
    fingers: 55,
  },
  /** Hanging limp from a hook between the shoulder blades. */
  hang: {
    hips: { pos: [0, 0.98, 0], rot: [6, 0, 2] },
    spine1: [8, 0, -2], spine2: [10, 0, 0], neck: [24, 0, 4], head: [28, -6, 8],
    armL: [-2, 0, 5], elbowL: 8, armR: [-4, 0, 6], elbowR: 12,
    legL: [-10, 0, 3], kneeL: 14, footL: 42, legR: [-4, 0, 2], kneeR: 8, footR: 48,
    fingers: 30,
  },
  fall: {
    hips: { pos: [0, 0.95, 0], rot: [10, 0, 0] },
    spine1: [6, 0, 0], spine2: [4, 0, 0], neck: [-10, 0, 0], head: [-14, 0, 0],
    armL: [-30, 0, 55], elbowL: 40, armR: [-20, 0, 60], elbowR: 50,
    legL: [-34, 0, 8], kneeL: 50, footL: 20, legR: [-18, 0, 8], kneeR: 40, footR: 25,
    fingers: 0,
  },
  /** Landing crouch after the drop. */
  crouch: {
    hips: { pos: [0, 0.5, -0.06], rot: [38, 0, 0] },
    spine1: [16, 0, 0], spine2: [14, 0, 0], neck: [-6, 0, 0], head: [-10, 0, 0],
    armL: [-52, 0, 18], elbowL: 18, armR: [-40, 0, 20], elbowR: 30,
    legL: [-116, 0, 12], kneeL: 122, footL: -44, legR: [-100, 0, 12], kneeR: 130, footR: -8,
    fingers: 5,
  },
  buckle: {
    hips: { pos: [0, 0.56, -0.02], rot: [12, 0, 6] },
    spine1: [18, 0, 5], spine2: [16, 0, 4], neck: [20, 0, 8], head: [20, 0, 10],
    armL: [6, 0, 14], elbowL: 14, armR: [2, 0, 12], elbowR: 12,
    legL: [-70, 0, 8], kneeL: 118, footL: 20, legR: [-52, 0, 10], kneeR: 110, footR: 35,
  },
  /** Prone base pose for the legless crawl (arms are driven by IK on top of this). */
  crawl: {
    hips: { pos: [0, 0.26, -0.32], rot: [64, 0, 0] },
    spine1: [-6, 0, 0], spine2: [-12, 0, 0], neck: [-30, 0, 0], head: [-24, 0, 0],
    armL: [-60, 0, 20], elbowL: 40, armR: [-60, 0, 20], elbowR: 40,
    legL: [16, 4, 8], kneeL: 14, footL: 40, legR: [12, -4, 8], kneeR: 22, footR: 46,
    fingers: 30,
  },
  deadFront: {
    hips: { pos: [0, 0.155, 0.1], rot: [84, 0, 8] },
    spine1: [4, 6, 3], spine2: [3, 8, 4], neck: [-8, 20, 0], head: [-14, 40, 0],
    armL: [-140, 0, 40], elbowL: 70, armR: [20, 0, 34], elbowR: 30,
    legL: [-4, 0, 14], kneeL: 12, footL: 50, legR: [-22, 0, 22], kneeR: 62, footR: 55,
    fingers: 15,
  },
  deadBack: {
    hips: { pos: [0, 0.16, -0.1], rot: [-86, 0, -6] },
    spine1: [-3, -5, 0], spine2: [-2, -8, 0], neck: [-6, -25, 0], head: [-10, -35, 0],
    armL: [10, 0, 62], elbowL: 30, armR: [6, 0, 48], elbowR: 14,
    legL: [-3, 0, 16], kneeL: 4, footL: 40, legR: [-34, 0, 26], kneeR: 58, footR: 30,
    fingers: 15,
  },
  deadSide: {
    hips: { pos: [0, 0.2, 0], rot: [20, 0, 82] },
    spine1: [16, 0, 4], spine2: [18, 0, 4], neck: [10, 0, 14], head: [12, 0, 16],
    armL: [-50, 0, 20], elbowL: 60, armR: [-30, 0, 4], elbowR: 40,
    legL: [-50, 0, 6], kneeL: 70, footL: 30, legR: [-24, 0, 2], kneeR: 46, footR: 40,
  },
};
