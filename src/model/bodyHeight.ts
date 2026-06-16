import { Vector3 } from "three";
import { computeBodyTransform, computeFootTip } from "./kinematics";
import { solveIK } from "./ik";
import { servoIndex, type Pose } from "./pose";
import {
  SERVOS,
  computeLegMounts,
  mountingOffsetOf,
  type HexapodGeometry,
} from "./hexapod";

/**
 * Réglage de la HAUTEUR du châssis (garde au sol) en gardant les pieds posés.
 *
 * La hauteur du corps n'est pas stockée : elle découle de la pose (cf.
 * computeBodyTransform, qui repose le point le plus bas au sol). Lever/descendre
 * le châssis = ajuster les angles des pattes EN CONTACT par cinématique inverse
 * pour changer la distance verticale corps↔pieds, en gardant chaque pied à sa
 * position XZ au sol. Bornage : par les butées servo (au-delà, la hauteur est
 * bloquée) et par le sol (le bas du châssis ne descend pas sous y=0).
 */

const REACH_TOL = 1e-3; // m : tolérance d'atteignabilité du pied par l'IK
const ANGLE_TOL = 1e-6; // deg : marge sur les butées

/** Hauteur (m) du bas du châssis au-dessus du sol pour une pose donnée. */
export function chassisClearance(
  pose: Pose,
  geometry: HexapodGeometry,
  gravityEnabled: boolean
): number {
  const mounts = computeLegMounts(geometry);
  const t = computeBodyTransform(pose, geometry, mounts, gravityEnabled);
  return t.position.y - geometry.chassis.height / 2;
}

/**
 * Calcule une nouvelle pose plaçant le bas du châssis à `targetClearanceM` du
 * sol, en ne touchant qu'aux pattes actuellement EN CONTACT (les pattes levées
 * gardent leurs angles). Renvoie la pose inchangée si rien n'est au sol ou si la
 * cible est déjà atteinte. Recherche dichotomique du plus grand déplacement
 * faisable vers la cible (toutes les pattes au sol doivent rester atteignables
 * ET dans leurs butées — sinon la hauteur est bloquée).
 */
export function poseForClearance(
  pose: Pose,
  geometry: HexapodGeometry,
  gravityEnabled: boolean,
  targetClearanceM: number
): Pose {
  const mounts = computeLegMounts(geometry);
  const t = computeBodyTransform(pose, geometry, mounts, gravityEnabled);
  const h0 = t.position.y - geometry.chassis.height / 2;
  const ground = new Set(t.contacts.map((c) => c.legIndex));
  if (ground.size === 0) return pose;

  const target = Math.max(0, targetClearanceM); // jamais sous le sol
  const reqDelta = target - h0;
  if (Math.abs(reqDelta) < 1e-4) return pose;

  const groundMounts = mounts.filter((m) => ground.has(m.index));
  const footLocals = new Map<number, Vector3>();
  for (const m of groundMounts) footLocals.set(m.index, computeFootTip(m, pose, geometry));

  // Construit la pose pour un déplacement vertical `delta` du corps (pieds
  // descendus de `delta` en repère châssis). Renvoie null si une patte au sol
  // sort de ses butées ou devient inatteignable.
  const tryDelta = (delta: number): Pose | null => {
    const next = pose.slice();
    for (const m of groundMounts) {
      const fl = footLocals.get(m.index)!;
      const tgt = new Vector3(fl.x, fl.y - delta, fl.z);
      const a = solveIK(m, tgt, geometry);
      const ci = servoIndex(m.index, "coxa");
      const fi = servoIndex(m.index, "femur");
      const ti = servoIndex(m.index, "tibia");
      const cs = a.coxaDeg - mountingOffsetOf(geometry, ci);
      const fs = a.femurDeg - mountingOffsetOf(geometry, fi);
      const ts = a.tibiaDeg - mountingOffsetOf(geometry, ti);
      if (cs < SERVOS[ci].minDeg - ANGLE_TOL || cs > SERVOS[ci].maxDeg + ANGLE_TOL) return null;
      if (fs < SERVOS[fi].minDeg - ANGLE_TOL || fs > SERVOS[fi].maxDeg + ANGLE_TOL) return null;
      if (ts < SERVOS[ti].minDeg - ANGLE_TOL || ts > SERVOS[ti].maxDeg + ANGLE_TOL) return null;
      next[ci] = cs;
      next[fi] = fs;
      next[ti] = ts;
      // solveIK clampe la portée en silence → on vérifie que le pied atteint bien
      // la cible (sinon, hors d'atteinte : on refuse ce déplacement).
      if (computeFootTip(m, next, geometry).distanceTo(tgt) > REACH_TOL) return null;
    }
    return next;
  };

  // Cible directement atteignable ?
  const direct = tryDelta(reqDelta);
  if (direct) return direct;

  // Sinon : plus grand |delta| faisable vers la cible (delta=0 est faisable).
  if (!tryDelta(0)) return pose;
  let lo = 0; // faisable
  let hi = reqDelta; // infaisable
  let best: Pose | null = null;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const p = tryDelta(mid);
    if (p) {
      best = p;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best ?? pose;
}

/**
 * Borne haute pratique de la garde au sol (m) pour graduer la règle : portée
 * verticale maximale d'une patte (fémur + tibia), au-delà de quoi aucune hauteur
 * n'est atteignable. Le réglage réel reste borné par poseForClearance.
 */
export function maxClearance(geometry: HexapodGeometry): number {
  return geometry.segments.femur + geometry.segments.tibia;
}
