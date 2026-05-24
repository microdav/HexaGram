import { Matrix4, Vector3 } from "three";
import { degToRad } from "./servo";
import type { HexapodGeometry, LegMount } from "./hexapod";

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Solve inverse kinematics for one leg (elbow-up configuration).
 *
 * Given a target foot position in chassis-local frame, returns the three servo
 * angles needed to place the foot there.  If the target is out of reach the
 * foot direction is preserved and the distance is clamped to the reachable
 * range [|F-T|, F+T].
 *
 * Matches the FK in kinematics.ts:
 *   T_mount · R_Y(mountYaw) · R_Y(coxa) · T(coxa,0,0)
 *   · R_Z(femur) · T(femur,0,0) · R_Z(tibia) · T(tibia,0,0)
 */
export function solveIK(
  mount: LegMount,
  targetChassisLocal: Vector3,
  geometry: HexapodGeometry
): { coxaDeg: number; femurDeg: number; tibiaDeg: number } {
  const { coxa, femur: F, tibia: T } = geometry.segments;

  // Transform target into mount-local frame (undo mount translation + yaw).
  const invYaw = new Matrix4().makeRotationY(-degToRad(mount.yawDeg));
  const p = targetChassisLocal
    .clone()
    .sub(new Vector3(mount.position[0], mount.position[1], mount.position[2]))
    .applyMatrix4(invYaw);

  // ── Coxa angle (horizontal sweep in the XZ plane) ──────────────────────
  // Three.js R_Y(θ) maps (r,0,0) → (r·cos θ, 0, −r·sin θ), so
  // solving for θ: sin θ = −p.z/r → atan2(−p.z, p.x).
  const coxaDeg = Math.atan2(-p.z, p.x) * RAD_TO_DEG;

  // ── 2-D IK in the plane after coxa rotation ─────────────────────────────
  // Horizontal reach from the coxa joint origin.
  const r = Math.sqrt(p.x * p.x + p.z * p.z);
  let dx = r - coxa; // horizontal distance from femur pivot
  let dy = p.y;      // vertical distance from femur pivot
  let L = Math.hypot(dx, dy);

  // Clamp to the reachable interval [|F-T|, F+T].
  const maxReach = F + T;
  const minReach = Math.abs(F - T);

  if (L < 1e-6) {
    // Degenerate: target sits exactly at the femur pivot — push it downward.
    dy = -Math.max(minReach, 1e-4);
    dx = 0;
    L = Math.abs(dy);
  } else if (L > maxReach) {
    const s = maxReach / L;
    dx *= s;
    dy *= s;
    L = maxReach;
  } else if (L < minReach && minReach > 1e-6) {
    const s = minReach / L;
    dx *= s;
    dy *= s;
    L = minReach;
  }

  // ── Tibia angle (law of cosines) ─────────────────────────────────────────
  // Interior angle at the knee vertex in the femur-tibia-reach triangle.
  // tibiaDeg = 0  →  straight (collinear), tibiaDeg < 0  →  knee bends up.
  const cosKnee = (F * F + T * T - L * L) / (2 * F * T);
  const angleKnee = Math.acos(Math.max(-1, Math.min(1, cosKnee)));
  const tibiaDeg = (angleKnee - Math.PI) * RAD_TO_DEG; // always in [-180, 0]

  // ── Femur angle (elbow-up: knee above the femur-pivot→foot line) ─────────
  const phi = Math.atan2(dy, dx); // angle of foot direction from horizontal
  const cosAtFemur = (F * F + L * L - T * T) / (2 * F * L);
  const angleAtFemur = Math.acos(Math.max(-1, Math.min(1, cosAtFemur)));
  const femurDeg = (phi + angleAtFemur) * RAD_TO_DEG;

  return { coxaDeg, femurDeg, tibiaDeg };
}
