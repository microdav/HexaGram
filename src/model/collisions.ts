import { Matrix4, Vector3 } from "three";
import { degToRad } from "./servo";
import { servoIndex, type Pose } from "./pose";
import type { HexapodGeometry, LegMount } from "./hexapod";

export interface CollisionPrefs {
  enabled: boolean;
  includeBody: boolean;
  showArrow: boolean;
}

export const DEFAULT_COLLISION_PREFS: CollisionPrefs = {
  enabled: true,
  includeBody: false,
  showArrow: true,
};

export interface CollisionResult {
  /** Set of segment keys (format: `${legIndex}-${seg}`, seg=0/1/2) involved in at least one collision. */
  collidingSegments: Set<string>;
  /** Centre de la collision la plus sévère, en coordonnées locales du châssis. */
  center: Vector3 | null;
  hasCollision: boolean;
}

// Rayon de capsule utilisé pour le test (en mètres)
const SEG_RADIUS = 0.016;

/** Retourne les 4 positions articulaires d'une patte dans le repère local châssis :
 *  [origine coxa, origine fémur, origine tibia, pointe du pied] */
export function computeLegJointPositions(
  mount: LegMount,
  pose: Pose,
  geometry: HexapodGeometry
): [Vector3, Vector3, Vector3, Vector3] {
  const coxaDeg = pose[servoIndex(mount.index, "coxa")];
  const femurDeg = pose[servoIndex(mount.index, "femur")];
  const tibiaDeg = pose[servoIndex(mount.index, "tibia")];
  const { coxa, femur, tibia } = geometry.segments;

  const base = new Matrix4()
    .makeTranslation(mount.position[0], mount.position[1], mount.position[2])
    .multiply(new Matrix4().makeRotationY(degToRad(mount.yawDeg)));

  const p0 = new Vector3().applyMatrix4(base);

  const mCoxa = base.clone()
    .multiply(new Matrix4().makeRotationY(degToRad(coxaDeg)))
    .multiply(new Matrix4().makeTranslation(coxa, 0, 0));
  const p1 = new Vector3().applyMatrix4(mCoxa);

  const mFemur = mCoxa.clone()
    .multiply(new Matrix4().makeRotationZ(degToRad(femurDeg)))
    .multiply(new Matrix4().makeTranslation(femur, 0, 0));
  const p2 = new Vector3().applyMatrix4(mFemur);

  const mTibia = mFemur.clone()
    .multiply(new Matrix4().makeRotationZ(degToRad(tibiaDeg)))
    .multiply(new Matrix4().makeTranslation(tibia, 0, 0));
  const p3 = new Vector3().applyMatrix4(mTibia);

  return [p0, p1, p2, p3];
}

/** Distance minimale entre deux segments 3D. Retourne la distance et les points les plus proches. */
function segSegClosest(
  p1: Vector3, p2: Vector3,
  p3: Vector3, p4: Vector3
): { dist: number; pa: Vector3; pb: Vector3 } {
  const d1 = new Vector3().subVectors(p2, p1);
  const d2 = new Vector3().subVectors(p4, p3);
  const r  = new Vector3().subVectors(p1, p3);

  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);

  let s: number, t: number;

  if (a <= 1e-10 && e <= 1e-10) {
    s = 0; t = 0;
  } else if (a <= 1e-10) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= 1e-10) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      if (Math.abs(denom) > 1e-10) {
        s = Math.max(0, Math.min(1, (b * f - c * e) / denom));
      } else {
        s = 0;
      }
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }

  const pa = new Vector3().copy(p1).addScaledVector(d1, s);
  const pb = new Vector3().copy(p3).addScaledVector(d2, t);
  return { dist: pa.distanceTo(pb), pa, pb };
}

/** Distance minimale entre un segment et une AABB centrée à l'origine.
 *  Retourne le point sur le segment au plus proche. */
function segToAABBClosest(
  a: Vector3, b: Vector3,
  halfL: number, halfH: number, halfW: number
): { dist: number; segPoint: Vector3 } {
  const N = 12;
  let minDist = Infinity;
  let minPoint = a.clone();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = new Vector3().lerpVectors(a, b, t);
    const dx = Math.max(0, Math.abs(p.x) - halfL);
    const dy = Math.max(0, Math.abs(p.y) - halfH);
    const dz = Math.max(0, Math.abs(p.z) - halfW);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < minDist) {
      minDist = dist;
      minPoint = p.clone();
    }
  }
  return { dist: minDist, segPoint: minPoint };
}

export function detectCollisions(
  mounts: LegMount[],
  pose: Pose,
  geometry: HexapodGeometry,
  prefs: CollisionPrefs
): CollisionResult {
  if (!prefs.enabled) {
    return { collidingSegments: new Set(), center: null, hasCollision: false };
  }

  const collidingSegments = new Set<string>();
  let bestCenter: Vector3 | null = null;
  let bestDist = Infinity;
  let hasCollision = false;

  // Calcul des positions articulaires pour chaque patte
  const allJoints = mounts.map((m) => computeLegJointPositions(m, pose, geometry));

  interface Seg {
    legIndex: number;
    seg: 0 | 1 | 2;
    a: Vector3;
    b: Vector3;
  }

  const segments: Seg[] = [];
  for (let li = 0; li < mounts.length; li++) {
    const legIndex = mounts[li].index;
    const j = allJoints[li];
    segments.push({ legIndex, seg: 0, a: j[0], b: j[1] }); // coxa
    segments.push({ legIndex, seg: 1, a: j[1], b: j[2] }); // fémur
    segments.push({ legIndex, seg: 2, a: j[2], b: j[3] }); // tibia
  }

  // ── Collisions patte-patte ───────────────────────────────────────────────
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const sA = segments[i];
      const sB = segments[j];
      if (sA.legIndex === sB.legIndex) continue;
      const { dist, pa, pb } = segSegClosest(sA.a, sA.b, sB.a, sB.b);
      if (dist < SEG_RADIUS * 2) {
        hasCollision = true;
        collidingSegments.add(`${sA.legIndex}-${sA.seg}`);
        collidingSegments.add(`${sB.legIndex}-${sB.seg}`);
        if (dist < bestDist) {
          bestDist = dist;
          bestCenter = new Vector3().addVectors(pa, pb).multiplyScalar(0.5);
        }
      }
    }
  }

  // ── Collisions patte-corps ───────────────────────────────────────────────
  if (prefs.includeBody) {
    const halfL = geometry.chassis.length / 2;
    const halfH = geometry.chassis.height / 2;
    const halfW = geometry.chassis.width / 2;

    for (const seg of segments) {
      // La coxa part du bord du châssis → toujours "en contact" → on l'ignore
      if (seg.seg === 0) continue;
      const { dist, segPoint } = segToAABBClosest(seg.a, seg.b, halfL, halfH, halfW);
      if (dist < SEG_RADIUS) {
        hasCollision = true;
        collidingSegments.add(`${seg.legIndex}-${seg.seg}`);
        if (dist < bestDist) {
          bestDist = dist;
          bestCenter = segPoint.clone();
        }
      }
    }
  }

  return { collidingSegments, center: bestCenter, hasCollision };
}
