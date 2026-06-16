import { Matrix4, Vector3 } from "three";
import { degToRad } from "./servo";
import { servoIndex, type Pose } from "./pose";
import { mountingOffsetOf, type HexapodGeometry, type LegMount } from "./hexapod";
import type { LegContact } from "./kinematics";

const G = 9.81;

/** Joint positions in chassis-local frame for a given leg. */
export interface LegJoints {
  coxaBase: Vector3;   // where the coxa rotates (= mount position)
  femurBase: Vector3;  // where the femur rotates (= end of coxa)
  tibiaBase: Vector3;  // where the tibia rotates (= end of femur)
  footTip: Vector3;    // end of tibia
}

export function computeLegJoints(
  mount: LegMount,
  pose: Pose,
  geometry: HexapodGeometry
): LegJoints {
  const ci = servoIndex(mount.index, "coxa");
  const fi = servoIndex(mount.index, "femur");
  const ti = servoIndex(mount.index, "tibia");
  const coxaDeg = pose[ci] + mountingOffsetOf(geometry, ci);
  const femurDeg = pose[fi] + mountingOffsetOf(geometry, fi);
  const tibiaDeg = pose[ti] + mountingOffsetOf(geometry, ti);
  const { coxa, femur, tibia } = geometry.segments;

  const base = new Matrix4()
    .makeTranslation(mount.position[0], mount.position[1], mount.position[2])
    .multiply(new Matrix4().makeRotationY(degToRad(mount.yawDeg)));

  const afterCoxa = base
    .clone()
    .multiply(new Matrix4().makeRotationY(degToRad(coxaDeg)))
    .multiply(new Matrix4().makeTranslation(coxa, 0, 0));

  const afterFemur = afterCoxa
    .clone()
    .multiply(new Matrix4().makeRotationZ(degToRad(femurDeg)))
    .multiply(new Matrix4().makeTranslation(femur, 0, 0));

  const afterTibia = afterFemur
    .clone()
    .multiply(new Matrix4().makeRotationZ(degToRad(tibiaDeg)))
    .multiply(new Matrix4().makeTranslation(tibia, 0, 0));

  return {
    coxaBase: new Vector3().applyMatrix4(base),
    femurBase: new Vector3().applyMatrix4(afterCoxa),
    tibiaBase: new Vector3().applyMatrix4(afterFemur),
    footTip: new Vector3().applyMatrix4(afterTibia),
  };
}

/** Horizontal distance (XZ plane) between two points in chassis frame. */
function horizDist(a: Vector3, b: Vector3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

/**
 * Estimate static gravitational torque (N·cm) at each servo for the current pose.
 *
 * Model: each contact leg carries an equal fraction of total weight.
 * Torque at joint = leg_load × horizontal_distance_from_joint_to_foot_tip.
 *
 * Returns a map: servoId → torque in N·cm.
 * Non-contact legs return 0 (no load bearing).
 */
export function estimateTorques(
  pose: Pose,
  geometry: HexapodGeometry,
  mounts: LegMount[],
  contacts: LegContact[],
  totalWeightG: number
): Record<number, number> {
  const result: Record<number, number> = {};
  for (let i = 0; i < 18; i++) result[i] = 0;

  if (contacts.length === 0 || totalWeightG <= 0) return result;

  const totalWeightN = (totalWeightG / 1000) * G;
  const legLoadN = totalWeightN / contacts.length;
  const contactSet = new Set(contacts.map((c) => c.legIndex));

  for (const mount of mounts) {
    if (!contactSet.has(mount.index)) continue;
    const joints = computeLegJoints(mount, pose, geometry);

    // Tibia servo: lever = distance from tibia base to foot tip
    const tibiaDist = horizDist(joints.tibiaBase, joints.footTip);
    const tibiaTorqueNcm = legLoadN * tibiaDist * 100;

    // Femur servo: lever = distance from femur base to foot tip
    const femurDist = horizDist(joints.femurBase, joints.footTip);
    const femurTorqueNcm = legLoadN * femurDist * 100;

    // Coxa servo: lever = distance from coxa base to foot tip (horizontal plane)
    const coxaDist = horizDist(joints.coxaBase, joints.footTip);
    const coxaTorqueNcm = legLoadN * coxaDist * 100;

    result[servoIndex(mount.index, "coxa")] = coxaTorqueNcm;
    result[servoIndex(mount.index, "femur")] = femurTorqueNcm;
    result[servoIndex(mount.index, "tibia")] = tibiaTorqueNcm;
  }

  return result;
}

/** Convert N·cm to kg·cm */
export function ncmToKgcm(ncm: number): number {
  return ncm / (G * 1);
}

/** Torque ratio [0, 1] relative to servo max torque (at 7.4V or 6V fallback). */
export function torqueRatio(ncm: number, maxKgcm: number): number {
  if (maxKgcm <= 0) return 0;
  return Math.min(1, ncmToKgcm(ncm) / maxKgcm);
}

/** Color from ratio: green → yellow → orange → red */
export function torqueColor(ratio: number): string {
  if (ratio < 0.4) return "#22c55e";
  if (ratio < 0.65) return "#eab308";
  if (ratio < 0.85) return "#f97316";
  return "#ef4444";
}
