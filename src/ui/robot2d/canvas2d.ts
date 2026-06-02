import type { HexapodGeometry, LegAnchor } from "../../model/hexapod";
import type { ServoDimsM } from "../../model/servoTypes";

/**
 * Transform vue de dessus ↔ écran.
 *
 * Convention (cohérente avec la 3D — cf. kinematics.computeFootTip) :
 *   - X monde = avant du robot  → vers le HAUT de l'écran
 *   - Z monde = côté droit      → vers la DROITE de l'écran
 *   - `scale` = pixels par mètre.
 */
export interface View {
  cx: number; // origine écran (px) — centre du robot
  cy: number;
  scale: number; // px / m
}

export function worldToScreen(x: number, z: number, v: View): { sx: number; sy: number } {
  return { sx: v.cx + z * v.scale, sy: v.cy - x * v.scale };
}

export function screenToWorld(sx: number, sy: number, v: View): { x: number; z: number } {
  return { x: (v.cy - sy) / v.scale, z: (sx - v.cx) / v.scale };
}

/** Direction monde XZ d'une patte d'après son yaw (deg). */
export function yawToDir(yawDeg: number): { dx: number; dz: number } {
  const r = (yawDeg * Math.PI) / 180;
  return { dx: Math.cos(r), dz: -Math.sin(r) };
}

/** Yaw (deg, dans [-180,180]) depuis un vecteur monde XZ (ancrage → pointeur). */
export function dirToYaw(dx: number, dz: number): number {
  return (Math.atan2(-dz, dx) * 180) / Math.PI;
}

/** Magnétise une valeur (mètres) sur une grille de `stepCm` centimètres. */
export function snapMeters(v: number, stepCm: number): number {
  const step = stepCm / 100;
  return Math.round(v / step) * step;
}

/**
 * Détecte si un polygone est (approximativement) un cercle : assez de sommets et
 * rayons quasi égaux autour du centroïde. Renvoie le rayon, sinon null.
 */
export function circleInfo(poly: { x: number; z: number }[]): { cx: number; cz: number; radius: number } | null {
  const n = poly.length;
  if (n < 12) return null;
  let sx = 0, sz = 0;
  for (const p of poly) { sx += p.x; sz += p.z; }
  const cx = sx / n, cz = sz / n;
  const rs = poly.map((p) => Math.hypot(p.x - cx, p.z - cz));
  const mean = rs.reduce((a, b) => a + b, 0) / n;
  if (mean < 1e-6) return null;
  const maxDev = Math.max(...rs.map((r) => Math.abs(r - mean)));
  return maxDev / mean < 0.02 ? { cx, cz, radius: mean } : null;
}

/** Centroïde (moyenne des sommets) d'un polygone. */
export function centroid(pts: { x: number; z: number }[]): { x: number; z: number } {
  if (pts.length === 0) return { x: 0, z: 0 };
  let sx = 0, sz = 0;
  for (const p of pts) { sx += p.x; sz += p.z; }
  return { x: sx / pts.length, z: sz / pts.length };
}

export interface Pt { x: number; z: number }

/** Point dans polygone (ray casting, plan XZ). */
export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const zi = poly[i].z, xi = poly[i].x, zj = poly[j].z, xj = poly[j].x;
    const intersect = (zi > p.z) !== (zj > p.z) && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Aimante un point monde sur le sommet le plus proche d'une liste, si la distance
 * écran est sous le seuil px. Renvoie le point aimanté (ou l'original).
 */
export function snapToVertices(p: Pt, verts: Pt[], pxThresh: number, v: View): Pt {
  let best: Pt | null = null;
  let bestD = pxThresh;
  const ps = worldToScreen(p.x, p.z, v);
  for (const w of verts) {
    const s = worldToScreen(w.x, w.z, v);
    const d = Math.hypot(s.sx - ps.sx, s.sy - ps.sy);
    if (d < bestD) { bestD = d; best = w; }
  }
  return best ?? p;
}

/** Géométrie écran d'une cote a→b décalée de `offset` (m), + longueur mesurée. */
export function measureGeom(a: Pt, b: Pt, offset: number, v: View) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const nx = len > 1e-9 ? -dz / len : 0; // normale unité (XZ)
  const nz = len > 1e-9 ? dx / len : 0;
  const ao = { x: a.x + nx * offset, z: a.z + nz * offset };
  const bo = { x: b.x + nx * offset, z: b.z + nz * offset };
  const mid = { x: (ao.x + bo.x) / 2, z: (ao.z + bo.z) / 2 };
  return {
    len,
    a: worldToScreen(a.x, a.z, v),
    b: worldToScreen(b.x, b.z, v),
    ao: worldToScreen(ao.x, ao.z, v),
    bo: worldToScreen(bo.x, bo.z, v),
    mid: worldToScreen(mid.x, mid.z, v),
  };
}

/** Décalage (m) d'une cote depuis la position monde du pointeur (projection sur la normale). */
export function offsetFromPointer(a: Pt, b: Pt, p: Pt): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return 0;
  const nx = -dz / len, nz = dx / len;
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  return (p.x - mx) * nx + (p.z - mz) * nz;
}

/**
 * Empreinte vue de dessus d'un servo coxa, dans le repère monde XZ (mètres).
 * Le pignon (axe de sortie) coïncide avec l'ancrage de la patte ; le corps est
 * orienté le long de la patte (yaw) + un décalage, et reculé du `shaftOffset`
 * pour que la sortie tombe sur le pignon.
 */
export function coxaServoGeom(
  anchor: LegAnchor,
  dims: ServoDimsM,
  angleOffsetDeg: number
): { corners: Pt[]; pinion: { x: number; z: number; r: number }; bodyAngleDeg: number } {
  const bodyAngleDeg = anchor.yawDeg + angleOffsetDeg;
  const u = yawToDir(bodyAngleDeg); // axe « longueur », vers la sortie (patte)
  const w = { dx: -u.dz, dz: u.dx }; // axe « largeur » (perpendiculaire)
  // Centre du corps : on recule du décalage d'axe depuis le pignon (= ancrage).
  const cx = anchor.x - u.dx * dims.shaftOffsetM;
  const cz = anchor.z - u.dz * dims.shaftOffsetM;
  const hl = dims.lengthM / 2;
  const hw = dims.widthM / 2;
  const corner = (sl: number, sw: number): Pt => ({
    x: cx + u.dx * sl * hl + w.dx * sw * hw,
    z: cz + u.dz * sl * hl + w.dz * sw * hw,
  });
  return {
    corners: [corner(+1, -1), corner(+1, +1), corner(-1, +1), corner(-1, -1)],
    pinion: { x: anchor.x, z: anchor.z, r: dims.pinionRadiusM },
    bodyAngleDeg,
  };
}

export interface JointPoint {
  servoId: number;
  joint: "coxa" | "femur" | "tibia";
  x: number;
  z: number;
}

/**
 * Positions schématiques des 3 servos d'une patte en vue de dessus : le long de
 * la direction `yaw`, aux longueurs cumulées des segments (coxa puis fémur).
 * Le pied (bout du tibia) est renvoyé pour tracer la patte.
 */
export function legJointPoints(
  anchor: LegAnchor,
  seg: HexapodGeometry["segments"],
  markers: { servoId: number; x: number; z: number }[] | undefined
): { joints: JointPoint[]; foot: { x: number; z: number } } {
  const { dx, dz } = yawToDir(anchor.yawDeg);
  const at = (len: number) => ({ x: anchor.x + dx * len, z: anchor.z + dz * len });
  const cumulative: Record<JointPoint["joint"], number> = {
    coxa: 0,
    femur: seg.coxa,
    tibia: seg.coxa + seg.femur,
  };
  const joints: JointPoint[] = (["coxa", "femur", "tibia"] as const).map((joint, j) => {
    const servoId = anchor.index * 3 + j;
    const override = markers?.find((m) => m.servoId === servoId);
    const base = at(cumulative[joint]);
    return { servoId, joint, x: override?.x ?? base.x, z: override?.z ?? base.z };
  });
  const foot = at(seg.coxa + seg.femur + seg.tibia);
  return { joints, foot };
}
