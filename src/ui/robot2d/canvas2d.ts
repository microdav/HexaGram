import type { HexapodGeometry, LegAnchor, MeasureRef } from "../../model/hexapod";
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

/**
 * Projette un point monde sur le segment a→b et renvoie le pied de perpendiculaire
 * (monde, borné au segment) ainsi que la distance écran (px) au point. Sert à
 * accrocher un point de mesure sur la ligne d'un bord (châssis ou partie de patte).
 */
export function projectToSegment(p: Pt, a: Pt, b: Pt, v: View): { pt: Pt; dPx: number; t: number } {
  const P = worldToScreen(p.x, p.z, v);
  const A = worldToScreen(a.x, a.z, v);
  const B = worldToScreen(b.x, b.z, v);
  const dx = B.sx - A.sx, dy = B.sy - A.sy;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-9 ? ((P.sx - A.sx) * dx + (P.sy - A.sy) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const fx = A.sx + t * dx, fy = A.sy + t * dy;
  const w = screenToWorld(fx, fy, v);
  return { pt: { x: w.x, z: w.z }, dPx: Math.hypot(P.sx - fx, P.sy - fy), t };
}

/** Rectangle (4 sommets) d'un segment de patte p→q, épaisseur w centrée sur l'axe. */
export function bandPoly(p: Pt, q: Pt, w: number): Pt[] {
  const dx = q.x - p.x, dz = q.z - p.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * (w / 2), nz = (dx / len) * (w / 2);
  return [
    { x: p.x + nx, z: p.z + nz }, { x: q.x + nx, z: q.z + nz },
    { x: q.x - nx, z: q.z - nz }, { x: p.x - nx, z: p.z - nz },
  ];
}

/**
 * Accès géométrique injecté pour re-résoudre les liaisons de cote depuis l'état
 * courant : chaque fonction renvoie la position monde (ou null si indisponible).
 */
export interface MeasureCtx {
  coxaPinion: (leg: number) => Pt | null;
  legJoint: (leg: number, joint: "coxa" | "femur" | "tibia") => Pt | null;
  legFoot: (leg: number) => Pt | null;
  legBandCorners: (leg: number, part: "coxa" | "femur" | "tibia") => Pt[] | null;
  coxaBodyCorners: (leg: number) => Pt[] | null;
  shapePoly: (shapeId: string) => Pt[] | null;
}

/**
 * Résout la position monde d'une extrémité de cote d'après sa liaison et l'état
 * courant. Retombe sur `fallback` (la position figée `a`/`b`) si la liaison est
 * absente ou ne se résout plus (forme supprimée, index d'arête hors limites…).
 */
export function resolveMeasureRef(ref: MeasureRef | undefined, fallback: Pt, ctx: MeasureCtx): Pt {
  if (!ref) return fallback;
  const onEdge = (ring: Pt[] | null, edge: number, t: number): Pt => {
    if (!ring || ring.length < 2 || edge < 0 || edge >= ring.length) return fallback;
    const a = ring[edge], b = ring[(edge + 1) % ring.length];
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  };
  switch (ref.kind) {
    case "coxaPinion": return ctx.coxaPinion(ref.leg) ?? fallback;
    case "legJoint": return ctx.legJoint(ref.leg, ref.joint) ?? fallback;
    case "legFoot": return ctx.legFoot(ref.leg) ?? fallback;
    case "legEdge": return onEdge(ctx.legBandCorners(ref.leg, ref.part), ref.edge, ref.t);
    case "coxaBodyEdge": return onEdge(ctx.coxaBodyCorners(ref.leg), ref.edge, ref.t);
    case "shapeVertex": { const poly = ctx.shapePoly(ref.shapeId); return poly?.[ref.index] ?? fallback; }
    case "shapeEdge": return onEdge(ctx.shapePoly(ref.shapeId), ref.edge, ref.t);
  }
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
