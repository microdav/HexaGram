import { Matrix3, Matrix4, Quaternion, Vector3 } from "three";
import { degToRad } from "./servo";
import { servoIndex, type Pose } from "./pose";
import { mountingOffsetOf, type HexapodGeometry, type LegMount } from "./hexapod";

/** Foot tip position expressed in the chassis-local frame. */
export function computeFootTip(
  mount: LegMount,
  pose: Pose,
  geometry: HexapodGeometry
): Vector3 {
  // Angle géométrique = angle de pose (repère servo) + offset de montage.
  const ci = servoIndex(mount.index, "coxa");
  const fi = servoIndex(mount.index, "femur");
  const ti = servoIndex(mount.index, "tibia");
  const coxaDeg = pose[ci] + mountingOffsetOf(geometry, ci);
  const femurDeg = pose[fi] + mountingOffsetOf(geometry, fi);
  const tibiaDeg = pose[ti] + mountingOffsetOf(geometry, ti);
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
  /** CoG world position (after transform applied). */
  cogWorld: Vector3;
  /** Dynamic CoG: weighted center of mass of body + all leg segments in world space. */
  cogDynamic: Vector3;
  /** True if dynamic CoG vertical projection is strictly inside support polygon. */
  cogDynamicInside: boolean;
  /** Convex hull of contact tips, in world xz (clockwise or CCW from hull algorithm). */
  supportPolygon: { x: number; z: number }[];
  /** True if CoG vertical projection is strictly inside support polygon. */
  cogInside: boolean;
}

const CONTACT_THRESHOLD = 0.005;
const SUPPORT_TOL = 0.0015;
const LEVEL_EPS = 5e-4;
const MAX_ITER = 20;

interface SimState {
  q: Quaternion;
  t: Vector3;
}

function transformPoint(p: Vector3, q: Quaternion, t: Vector3): Vector3 {
  return p.clone().applyQuaternion(q).add(t);
}

function applyBodyRotation(state: SimState, dq: Quaternion): void {
  state.q.premultiply(dq);
}

function applyEdgeRotation(
  state: SimState,
  pivot: Vector3,
  axis: Vector3,
  angle: number
): void {
  const dq = new Quaternion().setFromAxisAngle(axis, angle);
  const newT = state.t.clone().sub(pivot).applyQuaternion(dq).add(pivot);
  state.q.premultiply(dq);
  state.t.copy(newT);
}

function fitPlaneNormal(points: Vector3[]): Vector3 {
  if (points.length === 3) {
    const v1 = points[1].clone().sub(points[0]);
    const v2 = points[2].clone().sub(points[0]);
    const n = new Vector3().crossVectors(v1, v2);
    if (n.lengthSq() < 1e-12) return new Vector3(0, 1, 0);
    n.normalize();
    if (n.y < 0) n.negate();
    return n;
  }
  let sx = 0, sz = 0, sy = 0;
  let sxx = 0, sxz = 0, szz = 0;
  let sxy = 0, syz = 0;
  for (const p of points) {
    sx += p.x; sz += p.z; sy += p.y;
    sxx += p.x * p.x; sxz += p.x * p.z; szz += p.z * p.z;
    sxy += p.x * p.y; syz += p.z * p.y;
  }
  const N = points.length;
  const M = new Matrix3().set(sxx, sxz, sx, sxz, szz, sz, sx, sz, N);
  let a = 0, b = 0;
  const det = M.determinant();
  if (Math.abs(det) > 1e-9) {
    const inv = new Matrix3().copy(M).invert();
    const rhs = new Vector3(sxy, syz, sy).applyMatrix3(inv);
    a = rhs.x;
    b = rhs.y;
  }
  const n = new Vector3(-a, 1, -b);
  n.normalize();
  return n;
}

interface HullPoint {
  x: number;
  z: number;
  idx: number;
}

/** Andrew's monotone chain — returns CCW polygon in the xz plane. */
function convexHull2D(points: HullPoint[]): HullPoint[] {
  if (points.length <= 2) return [...points];
  const pts = [...points].sort((p, q) => p.x - q.x || p.z - q.z);
  const cross = (O: HullPoint, A: HullPoint, B: HullPoint) =>
    (A.x - O.x) * (B.z - O.z) - (A.z - O.z) * (B.x - O.x);

  const lower: HullPoint[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: HullPoint[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function pointInPolygonXZ(
  point: { x: number; z: number },
  polygon: { x: number; z: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, zi = polygon[i].z;
    const xj = polygon[j].x, zj = polygon[j].z;
    const dz = zj - zi || 1e-12;
    const intersect =
      ((zi > point.z) !== (zj > point.z)) &&
      point.x < ((xj - xi) * (point.z - zi)) / dz + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * For a CCW polygon, find the exterior edge that the point is on the outside of
 * with the largest outward signed distance — the body tips over this edge.
 */
function findTippingEdge(
  point: { x: number; z: number },
  polygon: HullPoint[]
): { A: HullPoint; B: HullPoint } | null {
  let best: { A: HullPoint; B: HullPoint } | null = null;
  let bestOutward = -Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const A = polygon[i];
    const B = polygon[(i + 1) % polygon.length];
    const dx = B.x - A.x;
    const dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-12) continue;
    // CCW polygon → outward normal = (dz, -dx)/len
    const nx = dz / len;
    const nz = -dx / len;
    const outward = nx * (point.x - A.x) + nz * (point.z - A.z);
    if (outward > 1e-9 && outward > bestOutward) {
      bestOutward = outward;
      best = { A, B };
    }
  }
  return best;
}

/**
 * Smallest strictly-positive θ such that A·cos θ + B·sin θ = −C.
 * Returns null when no solution exists.
 */
function solveTrigEvent(A: number, B: number, C: number): number | null {
  const R = Math.hypot(A, B);
  if (R < 1e-12) return null;
  const target = -C / R;
  if (target < -1 - 1e-9 || target > 1 + 1e-9) return null;
  const clamped = Math.max(-1, Math.min(1, target));
  const phi = Math.atan2(B, A);
  const ac = Math.acos(clamped);
  const norm = (x: number) => {
    let v = x % (2 * Math.PI);
    if (v < 0) v += 2 * Math.PI;
    return v;
  };
  const candidates = [norm(phi + ac), norm(phi - ac)].filter((t) => t > 1e-5);
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

/** Fraction of total mass attributed to the chassis body vs. all six legs combined. */
const BODY_MASS_FRACTION = 0.6;

/**
 * Center of mass of a single leg in the chassis body frame.
 * Each segment's mass is proportional to its length; mass center = segment midpoint.
 */
function computeLegCom(mount: LegMount, pose: Pose, geometry: HexapodGeometry): Vector3 {
  const ci = servoIndex(mount.index, "coxa");
  const fi = servoIndex(mount.index, "femur");
  const ti = servoIndex(mount.index, "tibia");
  const coxaDeg = pose[ci] + mountingOffsetOf(geometry, ci);
  const femurDeg = pose[fi] + mountingOffsetOf(geometry, fi);
  const tibiaDeg = pose[ti] + mountingOffsetOf(geometry, ti);
  const { coxa, femur, tibia } = geometry.segments;

  const mBase = new Matrix4()
    .makeTranslation(mount.position[0], mount.position[1], mount.position[2])
    .multiply(new Matrix4().makeRotationY(degToRad(mount.yawDeg)));

  const mFemurJoint = mBase.clone()
    .multiply(new Matrix4().makeRotationY(degToRad(coxaDeg)))
    .multiply(new Matrix4().makeTranslation(coxa, 0, 0));

  const mTibiaJoint = mFemurJoint.clone()
    .multiply(new Matrix4().makeRotationZ(degToRad(femurDeg)))
    .multiply(new Matrix4().makeTranslation(femur, 0, 0));

  const mTip = mTibiaJoint.clone()
    .multiply(new Matrix4().makeRotationZ(degToRad(tibiaDeg)))
    .multiply(new Matrix4().makeTranslation(tibia, 0, 0));

  const p0 = new Vector3().applyMatrix4(mBase);
  const p1 = new Vector3().applyMatrix4(mFemurJoint);
  const p2 = new Vector3().applyMatrix4(mTibiaJoint);
  const p3 = new Vector3().applyMatrix4(mTip);

  const midCoxa = new Vector3().addVectors(p0, p1).multiplyScalar(0.5);
  const midFemur = new Vector3().addVectors(p1, p2).multiplyScalar(0.5);
  const midTibia = new Vector3().addVectors(p2, p3).multiplyScalar(0.5);

  const totalLen = coxa + femur + tibia;
  return new Vector3()
    .addScaledVector(midCoxa, coxa / totalLen)
    .addScaledVector(midFemur, femur / totalLen)
    .addScaledVector(midTibia, tibia / totalLen);
}

/**
 * Compute the rigid-body transform under static physics:
 *  - foot tips at lowest level form the support polygon
 *  - if CoG projects inside polygon → body rests on that polygon, leveled
 *  - if CoG projects outside → body tips around the closest exterior edge
 *    until either another foot touches the ground or CoG reaches the edge
 */
export function computeBodyTransform(
  pose: Pose,
  geometry: HexapodGeometry,
  mounts: LegMount[],
  gravityEnabled: boolean
): BodyTransform {
  const tipsBody = mounts.map((m) => computeFootTip(m, pose, geometry));
  const cogBody = new Vector3(geometry.cog.x, geometry.cog.y, geometry.cog.z);

  if (!gravityEnabled) {
    const chassisBottomY = -geometry.chassis.height / 2;
    let lowest = chassisBottomY;
    for (const p of tipsBody) if (p.y < lowest) lowest = p.y;
    const t = new Vector3(0, -lowest, 0);
    const contacts: LegContact[] = [];
    tipsBody.forEach((p, i) => {
      const worldY = p.y - lowest;
      if (worldY < CONTACT_THRESHOLD) {
        contacts.push({
          legIndex: mounts[i].index,
          position: new Vector3(p.x, worldY, p.z),
        });
      }
    });
    const qId = new Quaternion();
    const cogBodyWorld = cogBody.clone().add(t);
    const legMassFrac = (1 - BODY_MASS_FRACTION) / mounts.length;
    const cogDynamic = cogBodyWorld.clone().multiplyScalar(BODY_MASS_FRACTION);
    for (const mount of mounts) {
      const legComBody = computeLegCom(mount, pose, geometry);
      cogDynamic.addScaledVector(transformPoint(legComBody, qId, t), legMassFrac);
    }
    return {
      position: t,
      quaternion: new Quaternion(),
      contacts,
      cogWorld: cogBodyWorld,
      cogDynamic,
      cogDynamicInside: false,
      supportPolygon: [],
      cogInside: false,
    };
  }

  // Ground-contact candidates: 6 foot tips + 8 chassis corners. The body can
  // rest on its belly, flank, or a corner — not only on its feet.
  const halfL = geometry.chassis.length / 2;
  const halfH = geometry.chassis.height / 2;
  const halfW = geometry.chassis.width / 2;
  const chassisCornersBody: Vector3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    chassisCornersBody.push(new Vector3(sx * halfL, sy * halfH, sz * halfW));
  }
  const candidatesBody = [...tipsBody, ...chassisCornersBody];
  const NUM_TIPS = tipsBody.length;

  const state: SimState = { q: new Quaternion(), t: new Vector3() };
  let contactIndices: number[] = [];
  let stableOnEdge = false;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const candsW = candidatesBody.map((p) => transformPoint(p, state.q, state.t));
    const cogW = transformPoint(cogBody, state.q, state.t);

    let minY = Infinity;
    for (const p of candsW) if (p.y < minY) minY = p.y;

    let supportIdx = candsW
      .map((p, i) => (p.y < minY + SUPPORT_TOL ? i : -1))
      .filter((i) => i >= 0);

    if (supportIdx.length < 2) {
      // Force the next-lowest tip into support, level the implied triangle.
      const sorted = candsW
        .map((p, i) => ({ y: p.y, i }))
        .sort((a, b) => a.y - b.y);
      const tri = [sorted[0].i, sorted[1].i, sorted[2].i];
      const normal = fitPlaneNormal(tri.map((i) => candsW[i]));
      const up = new Vector3(0, 1, 0);
      const angle = Math.acos(Math.max(-1, Math.min(1, normal.dot(up))));
      if (angle > LEVEL_EPS) {
        applyBodyRotation(state, new Quaternion().setFromUnitVectors(normal, up));
        continue;
      }
      supportIdx = tri;
    }

    if (supportIdx.length >= 3) {
      const planeTips = supportIdx.map((i) => candsW[i]);
      const normal = fitPlaneNormal(planeTips);
      const up = new Vector3(0, 1, 0);
      const angle = Math.acos(Math.max(-1, Math.min(1, normal.dot(up))));

      if (angle > LEVEL_EPS) {
        applyBodyRotation(state, new Quaternion().setFromUnitVectors(normal, up));
        continue;
      }

      const hullPts: HullPoint[] = supportIdx.map((i) => ({
        x: candsW[i].x,
        z: candsW[i].z,
        idx: i,
      }));
      const hull = convexHull2D(hullPts);
      const cogXZ = { x: cogW.x, z: cogW.z };

      if (pointInPolygonXZ(cogXZ, hull)) {
        contactIndices = hull.map((h) => h.idx);
        state.t.y += -minY;
        break;
      }

      const edge = findTippingEdge(cogXZ, hull);
      if (!edge) {
        contactIndices = hull.map((h) => h.idx);
        state.t.y += -minY;
        break;
      }
      supportIdx = [edge.A.idx, edge.B.idx];
    }

    if (supportIdx.length === 2) {
      const a = candsW[supportIdx[0]];
      const b = candsW[supportIdx[1]];
      const axis = new Vector3().subVectors(b, a);
      if (axis.lengthSq() < 1e-12) break;
      axis.normalize();

      const cogRel = cogW.clone().sub(a);
      // Orient axis so +θ is the gravity direction (decreases cog.y).
      const omega = new Vector3().crossVectors(axis, cogRel);
      if (omega.y > 0) axis.negate();

      // Tip-touch events: smallest θ where another tip reaches the support
      // y-level (the edge tips a and b stay at y=a.y throughout the rotation
      // since they lie on the rotation axis — they're not yet lifted to y=0).
      let touchAngle = Infinity;
      for (let i = 0; i < candsW.length; i++) {
        if (i === supportIdx[0] || i === supportIdx[1]) continue;
        const rel = candsW[i].clone().sub(a);
        const para = axis.clone().multiplyScalar(rel.dot(axis));
        const perp = rel.clone().sub(para);
        const cross = new Vector3().crossVectors(axis, perp);
        const A = perp.y;
        const B = cross.y;
        const C = para.y;
        const ang = solveTrigEvent(A, B, C);
        if (ang !== null && ang < touchAngle) touchAngle = ang;
      }

      // CoG-balance event: smallest θ where CoG xz projection reaches the AB line.
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenXZ = Math.hypot(dx, dz);
      let cogStopAngle = Infinity;
      if (lenXZ > 1e-9) {
        let nx = dz / lenXZ;
        let nz = -dx / lenXZ;
        const currOut = nx * (cogW.x - a.x) + nz * (cogW.z - a.z);
        if (currOut < 0) { nx = -nx; nz = -nz; }
        const rel = cogW.clone().sub(a);
        const para = axis.clone().multiplyScalar(rel.dot(axis));
        const perp = rel.clone().sub(para);
        const cross = new Vector3().crossVectors(axis, perp);
        const Av = nx * perp.x + nz * perp.z;
        const Bv = nx * cross.x + nz * cross.z;
        const Cv = nx * para.x + nz * para.z;
        const ang = solveTrigEvent(Av, Bv, Cv);
        if (ang !== null) cogStopAngle = ang;
      }

      const applyAngle = Math.min(touchAngle, cogStopAngle);
      if (!isFinite(applyAngle) || applyAngle < 1e-5) {
        contactIndices = supportIdx;
        state.t.y += -Math.min(a.y, b.y);
        stableOnEdge = true;
        break;
      }

      applyEdgeRotation(state, a, axis, applyAngle);

      if (touchAngle <= cogStopAngle) {
        // Another tip joins next iter.
        continue;
      }

      // CoG now balanced exactly over the edge.
      const finalCandsW = candidatesBody.map((p) => transformPoint(p, state.q, state.t));
      let newMinY = Infinity;
      for (const p of finalCandsW) if (p.y < newMinY) newMinY = p.y;
      state.t.y += -newMinY;
      contactIndices = supportIdx;
      stableOnEdge = true;
      break;
    }
  }

  const finalCandsW = candidatesBody.map((p) => transformPoint(p, state.q, state.t));
  const cogWorld = transformPoint(cogBody, state.q, state.t);

  const contacts: LegContact[] = [];
  const polyPts: HullPoint[] = [];
  finalCandsW.forEach((p, i) => {
    if (p.y < CONTACT_THRESHOLD) {
      if (i < NUM_TIPS) {
        contacts.push({
          legIndex: mounts[i].index,
          position: new Vector3(p.x, p.y, p.z),
        });
      }
      polyPts.push({ x: p.x, z: p.z, idx: i });
    }
  });

  let supportPolygon: { x: number; z: number }[] = [];
  let cogInside = false;
  if (polyPts.length >= 3) {
    const hull = convexHull2D(polyPts);
    supportPolygon = hull.map((h) => ({ x: h.x, z: h.z }));
    cogInside =
      !stableOnEdge && pointInPolygonXZ({ x: cogWorld.x, z: cogWorld.z }, supportPolygon);
  } else if (polyPts.length === 2) {
    supportPolygon = polyPts.map((h) => ({ x: h.x, z: h.z }));
    cogInside = false;
  }

  const legMassFrac = (1 - BODY_MASS_FRACTION) / mounts.length;
  const cogDynamic = cogWorld.clone().multiplyScalar(BODY_MASS_FRACTION);
  for (const mount of mounts) {
    const legComBody = computeLegCom(mount, pose, geometry);
    cogDynamic.addScaledVector(transformPoint(legComBody, state.q, state.t), legMassFrac);
  }
  const cogDynamicInside = supportPolygon.length >= 3
    ? !stableOnEdge && pointInPolygonXZ({ x: cogDynamic.x, z: cogDynamic.z }, supportPolygon)
    : false;

  // Avoid unused warning while keeping the variable for potential future use.
  void contactIndices;

  return {
    position: state.t.clone(),
    quaternion: state.q.clone(),
    contacts,
    cogWorld,
    cogDynamic,
    cogDynamicInside,
    supportPolygon,
    cogInside,
  };
}
