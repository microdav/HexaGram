import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { degToRad } from "./servo";
import { servoIndex, type Pose } from "./pose";
import type { HexapodGeometry, LegMount } from "./hexapod";

/** Foot tip position expressed in the chassis-local frame. */
export function computeFootTip(
  mount: LegMount,
  pose: Pose,
  geometry: HexapodGeometry
): Vector3 {
  const coxaDeg = pose[servoIndex(mount.index, "coxa")];
  const femurDeg = pose[servoIndex(mount.index, "femur")];
  const tibiaDeg = pose[servoIndex(mount.index, "tibia")];
  const { coxa, femur, tibia } = geometry.segments;

  const m = new Matrix4()
    .makeTranslation(mount.position[0], mount.position[1], mount.position[2])
    .multiply(new Matrix4().makeRotationY(degToRad(mount.yawDeg)))
    .multiply(new Matrix4().makeRotationY(degToRad(coxaDeg)))
    .multiply(new Matrix4().makeTranslation(coxa, 0, 0))
    .multiply(new Matrix4().makeRotationZ(degToRad(femurDeg)))
    .multiply(new Matrix4().makeTranslation(femur, 0, 0))
    .multiply(new Matrix4().makeRotationZ(degToRad(tibiaDeg)))
    .multiply(new Matrix4().makeTranslation(tibia, 0, 0));

  return new Vector3().applyMatrix4(m);
}

export interface LegContact {
  legIndex: number;
  position: Vector3;
}

export interface BodyTransform {
  position: Vector3;
  quaternion: Quaternion;
  /** Foot tips touching the ground (within threshold), in world coordinates. */
  contacts: LegContact[];
}

const CONTACT_THRESHOLD = 0.005;

/**
 * Compute the rigid-body transform (rotation + translation) to apply to the hexapod
 * so it rests properly on the ground at y=0.
 *
 * - gravityEnabled=false: simple lift — lowest point (foot tip or chassis bottom)
 *   slides up to y=0 without rotation.
 * - gravityEnabled=true: fit a plane through the 6 foot tips and rotate the body
 *   so that plane becomes horizontal. Lifted legs naturally cause the body to tilt
 *   toward the unsupported side.
 */
export function computeBodyTransform(
  pose: Pose,
  geometry: HexapodGeometry,
  mounts: LegMount[],
  gravityEnabled: boolean
): BodyTransform {
  const tipsBody = mounts.map((m) => computeFootTip(m, pose, geometry));

  if (!gravityEnabled) {
    const chassisBottomY = -geometry.chassis.height / 2;
    let lowest = chassisBottomY;
    for (const p of tipsBody) if (p.y < lowest) lowest = p.y;
    return {
      position: new Vector3(0, -lowest, 0),
      quaternion: new Quaternion(),
      contacts: [] as LegContact[],
    };
  }

  // Least-squares plane y = a*x + b*z + c through the 6 foot tips
  let sx = 0, sz = 0, sy = 0;
  let sxx = 0, sxz = 0, szz = 0;
  let sxy = 0, syz = 0;
  const N = tipsBody.length;
  for (const p of tipsBody) {
    sx += p.x; sz += p.z; sy += p.y;
    sxx += p.x * p.x; sxz += p.x * p.z; szz += p.z * p.z;
    sxy += p.x * p.y; syz += p.z * p.y;
  }

  const M = new Matrix3().set(sxx, sxz, sx, sxz, szz, sz, sx, sz, N);
  let a = 0, b = 0;
  const det = M.determinant();
  if (Math.abs(det) > 1e-9) {
    const inv = new Matrix3().copy(M).invert();
    const rhs = new Vector3(sxy, syz, sy).applyMatrix3(inv);
    a = rhs.x;
    b = rhs.y;
  }

  // Plane normal in body frame (points "up" relative to plane): (-a, 1, -b)
  const normal = new Vector3(-a, 1, -b).normalize();
  const q = new Quaternion().setFromUnitVectors(normal, new Vector3(0, 1, 0));

  // Apply rotation to tips, then lift so the lowest sits at y=0
  const tipsRotated = tipsBody.map((p) => p.clone().applyQuaternion(q));
  let minY = Infinity;
  for (const p of tipsRotated) if (p.y < minY) minY = p.y;
  const lift = -minY;

  const contacts: LegContact[] = [];
  tipsRotated.forEach((p, i) => {
    const worldY = p.y + lift;
    if (worldY < CONTACT_THRESHOLD) {
      contacts.push({
        legIndex: mounts[i].index,
        position: new Vector3(p.x, worldY, p.z),
      });
    }
  });

  return {
    position: new Vector3(0, lift, 0),
    quaternion: q,
    contacts,
  };
}
