import { Vector3 } from "three";
import { computeFootTip } from "./kinematics";
import { solveIK } from "./ik";
import { servoIndex, type Pose } from "./pose";
import type { HexapodGeometry, LegMount } from "./hexapod";

/**
 * Planificateur de transition entre deux poses « clés » (fin d'une séquence →
 * début de la suivante). Au lieu d'interpoler linéairement les 18 angles — ce
 * qui traîne les pieds au sol et peut faire basculer/pivoter le robot — on
 * génère une suite de poses physiquement saines :
 *
 *  1. Équilibre préservé : avant de lever un pied, on vérifie que le polygone
 *     de sustentation des cinq pieds restants contient le centre de gravité
 *     (avec marge). Sinon on insère un recentrage : translation horizontale du
 *     corps (les six pieds glissent ensemble dans le repère châssis) jusqu'à ce
 *     que le CdG passe au-dessus du centroïde du polygone restant.
 *
 *  2. Pieds levés : un pied qui doit changer d'empreinte est transféré seul,
 *     en arc (montée sinusoïdale), pendant que les cinq autres restent plantés.
 *     Aucun glissement au sol.
 *
 *  3. Orientation préservée : on ne fait jamais tourner les pieds d'appui les
 *     uns par rapport aux autres (la locomotion ne dérive un lacet que de cette
 *     rotation relative) et les recentrages sont de pures translations. Le corps
 *     reste donc de niveau et garde son cap. Les transferts se font un pied à la
 *     fois (cinq appuis ⇒ large polygone), en alternant les groupes tripodes.
 *
 * Les poses renvoyées sont les images *intermédiaires* : elles excluent la pose
 * de départ et la pose d'arrivée (l'appelant pousse lui-même la keyframe B).
 */

export interface TransitionOptions {
  /** Hauteur de levée d'un pied en transfert (m). Défaut : ~½ tibia. */
  liftHeight?: number;
  /** Cadence cible (images/s), pour convertir les durées en nombres d'images. */
  fps?: number;
  /** Durée d'un transfert de pied (s). */
  swingDuration?: number;
  /** Durée d'un recentrage du centre de gravité (s). */
  shiftDuration?: number;
  /** Durée du calage final vers la pose B (s). */
  settleDuration?: number;
  /** Tolérance de contact au sol (m) — cf. CONTACT_THRESHOLD de computeBodyTransform. */
  contactEps?: number;
  /** Déplacement horizontal mini d'un pied pour déclencher un transfert (m). */
  stepThreshold?: number;
  /** Marge de sécurité du CdG à l'intérieur du polygone de sustentation (m). */
  cogMargin?: number;
}

interface XZ {
  x: number;
  z: number;
}

/** Andrew's monotone chain — renvoie un polygone CCW dans le plan xz. */
function convexHullXZ(points: XZ[]): XZ[] {
  if (points.length <= 2) return [...points];
  const pts = [...points].sort((p, q) => p.x - q.x || p.z - q.z);
  const cross = (o: XZ, a: XZ, b: XZ) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: XZ[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: XZ[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Marge intérieure d'un point dans un polygone CCW : > 0 si le point est dedans,
 * et vaut alors la distance à l'arête la plus proche. < 0 s'il est dehors.
 */
function insideMargin(p: XZ, poly: XZ[]): number {
  if (poly.length < 3) return -Infinity;
  let maxOut = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-12) continue;
    // Polygone CCW ⇒ normale sortante = (dz, -dx) / len.
    const out = (dz / len) * (p.x - a.x) + (-dx / len) * (p.z - a.z);
    if (out > maxOut) maxOut = out;
  }
  return -maxOut;
}

function centroidXZ(poly: XZ[]): XZ {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p.x;
    z += p.z;
  }
  return { x: x / poly.length, z: z / poly.length };
}

/** Positions des pointes de pied dans le repère châssis pour une pose. */
function footTips(pose: Pose, mounts: LegMount[], geometry: HexapodGeometry): Vector3[] {
  return mounts.map((m) => computeFootTip(m, pose, geometry));
}

/** Indices des pieds en appui (les plus bas, à `eps` près). */
function groundedIndices(tips: Vector3[], eps: number): number[] {
  let minY = Infinity;
  for (const t of tips) if (t.y < minY) minY = t.y;
  const out: number[] = [];
  tips.forEach((t, i) => {
    if (t.y < minY + eps) out.push(i);
  });
  return out;
}

/** Écrit les trois angles d'une jambe (IK) dans la pose. */
function setLegFromIK(
  pose: Pose,
  mount: LegMount,
  targetLocal: Vector3,
  geometry: HexapodGeometry,
): void {
  const { coxaDeg, femurDeg, tibiaDeg } = solveIK(mount, targetLocal, geometry);
  pose[servoIndex(mount.index, "coxa")] = coxaDeg;
  pose[servoIndex(mount.index, "femur")] = femurDeg;
  pose[servoIndex(mount.index, "tibia")] = tibiaDeg;
}

/** Construit une pose plaçant tous les pieds aux cibles châssis-local données. */
function poseFromTips(targets: Vector3[], mounts: LegMount[], geometry: HexapodGeometry): Pose {
  const pose: Pose = new Array(mounts.length * 3).fill(0);
  mounts.forEach((m, i) => setLegFromIK(pose, m, targets[i], geometry));
  return pose;
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  return a.map((v, k) => v + (b[k] - v) * t);
}

/**
 * Ordonne les pieds à transférer en alternant les deux groupes tripodes
 * (indices pairs / impairs) : on ne déstabilise jamais deux fois de suite le
 * même côté du polygone d'appui.
 */
function orderForBalance(movers: number[]): number[] {
  const even = movers.filter((i) => i % 2 === 0);
  const odd = movers.filter((i) => i % 2 === 1);
  const out: number[] = [];
  for (let i = 0; i < Math.max(even.length, odd.length); i++) {
    if (i < even.length) out.push(even[i]);
    if (i < odd.length) out.push(odd[i]);
  }
  return out;
}

/**
 * Recentrage requis : si le CdG ne projette pas à l'intérieur (avec marge) du
 * polygone formé par `supportIdx`, renvoie le vecteur de translation à appliquer
 * aux pieds (repère châssis) pour amener le centroïde du polygone sous le CdG.
 * `null` si aucun recentrage n'est nécessaire ou possible.
 */
function requiredCogShift(
  curLocal: Vector3[],
  supportIdx: number[],
  geometry: HexapodGeometry,
  margin: number,
): Vector3 | null {
  if (supportIdx.length < 3) return null;
  const poly = convexHullXZ(supportIdx.map((i) => ({ x: curLocal[i].x, z: curLocal[i].z })));
  const cog: XZ = { x: geometry.cog.x, z: geometry.cog.z };
  if (insideMargin(cog, poly) >= margin) return null;
  const c = centroidXZ(poly);
  // Translater les pieds de Δ amène le centroïde (centroïde + Δ) sous le CdG.
  return new Vector3(cog.x - c.x, 0, cog.z - c.z);
}

/**
 * Génère les poses intermédiaires d'une transition de `poseA` vers `poseB`.
 * Renvoie une liste de poses (excluant A et B).
 */
export function buildTransitionFrames(
  poseA: Pose,
  poseB: Pose,
  geometry: HexapodGeometry,
  mounts: LegMount[],
  opts: TransitionOptions = {},
): Pose[] {
  const fps = opts.fps ?? 30;
  const contactEps = opts.contactEps ?? 0.005;
  const stepThreshold = opts.stepThreshold ?? 0.005;
  const cogMargin = opts.cogMargin ?? 0.01;
  const liftHeight = opts.liftHeight ?? Math.max(0.015, 0.5 * geometry.segments.tibia);
  const swingFrames = Math.max(2, Math.round((opts.swingDuration ?? 0.35) * fps));
  const shiftFrames = Math.max(1, Math.round((opts.shiftDuration ?? 0.25) * fps));
  const settleFrames = Math.max(2, Math.round((opts.settleDuration ?? 0.25) * fps));

  const localA = footTips(poseA, mounts, geometry);
  const localB = footTips(poseB, mounts, geometry);

  // Pieds dont l'empreinte change horizontalement au-delà du seuil.
  const movers: number[] = [];
  for (let i = 0; i < mounts.length; i++) {
    const d = Math.hypot(localB[i].x - localA[i].x, localB[i].z - localA[i].z);
    if (d > stepThreshold) movers.push(i);
  }

  const frames: Pose[] = [];

  // Aucun transfert : simple calage (hauteur/posture) vers B, sans toucher au sol.
  if (movers.length === 0) {
    for (let f = 1; f < settleFrames; f++) {
      frames.push(lerpPose(poseA, poseB, f / settleFrames));
    }
    return frames;
  }

  const order = orderForBalance(movers);
  const curLocal = localA.map((v) => v.clone());
  let curPose = poseA.slice();

  for (const leg of order) {
    // 1. Recentrage du CdG si le retrait du pied `leg` compromet l'équilibre.
    const supportIdx = groundedIndices(curLocal, contactEps).filter((i) => i !== leg);
    const shift = requiredCogShift(curLocal, supportIdx, geometry, cogMargin);
    if (shift) {
      const from = curLocal.map((v) => v.clone());
      const to = curLocal.map((v) => v.clone().add(shift));
      for (let f = 1; f <= shiftFrames; f++) {
        const t = f / shiftFrames;
        const targets = from.map((v, i) => v.clone().lerp(to[i], t));
        frames.push(poseFromTips(targets, mounts, geometry));
      }
      to.forEach((v, i) => curLocal[i].copy(v));
      curPose = frames[frames.length - 1].slice();
    }

    // 2. Transfert du pied `leg` en arc ; les autres restent plantés.
    const start = curLocal[leg].clone();
    const end = localB[leg].clone();
    for (let f = 1; f <= swingFrames; f++) {
      const t = f / swingFrames;
      const x = start.x + (end.x - start.x) * t;
      const z = start.z + (end.z - start.z) * t;
      const yBase = start.y + (end.y - start.y) * t;
      const target = new Vector3(x, yBase + liftHeight * Math.sin(Math.PI * t), z);
      const pose = curPose.slice();
      setLegFromIK(pose, mounts[leg], target, geometry);
      frames.push(pose);
    }
    curLocal[leg].copy(end);
    curPose = frames[frames.length - 1].slice();
  }

  // 3. Calage final vers la pose B (résout les résidus de hauteur/posture).
  for (let f = 1; f < settleFrames; f++) {
    frames.push(lerpPose(curPose, poseB, f / settleFrames));
  }

  return frames;
}
