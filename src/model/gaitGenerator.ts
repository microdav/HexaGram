import { mountingOffsetOf, type HexapodGeometry, type LegMount } from "./hexapod";
import type { ServoCalibration } from "../store/useHexapodStore";
import type { SequencerStep } from "../store/useSequencerStore";
import { clampAngle, degToRad } from "./servo";
import { computeBodyTransform } from "./kinematics";

export type GaitType = "tripod" | "ripple" | "wave";

export interface GaitGeneratorConfig {
  geometry: HexapodGeometry;
  legMounts: LegMount[];
  calibration: Record<number, ServoCalibration>;
  gaitType: GaitType;
  /** Fraction (0.1–1.0) du débattement coxa *stable* (auto-borné à la géométrie)
   *  utilisée comme longueur de pas. 1.0 = pas maximal sans basculement. */
  stepFraction: number;
  /** Fraction of the maximum achievable lift height (0.1–1.0). */
  liftFraction: number;
  useSoftLimits: boolean;
  /**
   * Pose de base (18 angles, repère servo) servant de **stance** : chaque patte
   * adopte ses coxa/fémur/tibia comme posture d'appui, la démarche n'ajoutant que
   * le débattement (coxa) et le lever (fémur/tibia). Absente → stance intégrée
   * (fémur −20°, tibia −60° géométriques). Permet d'accorder la démarche à la
   * posture réelle du robot.
   */
  basePose?: number[];
}

export interface GaitResult {
  steps: SequencerStep[];
  /**
   * Per-step stability score.
   * +1 = CoG at centroid (parfait), 0 = CoG on polygon edge, -1 = CoG well outside.
   */
  stabilityScores: number[];
}

/** 0=Danger, 1=(−), 2=Moyenne, 3=(+), 4=Parfait */
export type StabilityLevel = 0 | 1 | 2 | 3 | 4;

export const STABILITY_LABELS: Record<StabilityLevel, string> = {
  0: "Danger",
  1: "(−)",
  2: "Moyenne",
  3: "(+)",
  4: "Parfait",
};

export function stabilityLevel(score: number): StabilityLevel {
  if (score < 0)    return 0;
  if (score < 0.15) return 1;
  if (score < 0.4)  return 2;
  if (score < 0.7)  return 3;
  return 4;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const FALLBACK_MIN = -90;
const FALLBACK_MAX = 90;

function getLimits(
  servoId: number,
  calibration: Record<number, ServoCalibration>,
  useSoft: boolean
): { min: number; max: number } {
  const c = calibration[servoId];
  if (!c) return { min: FALLBACK_MIN, max: FALLBACK_MAX };
  return useSoft
    ? { min: c.softMinDeg, max: c.softMaxDeg }
    : { min: c.hardMinDeg, max: c.hardMaxDeg };
}

type Slot = "U" | "fwd" | "mid" | "bck";

/**
 * Posture d'appui PAR PATTE, indépendante du débattement coxa — calculée une
 * seule fois par démarche. Dérivée de la `basePose` si fournie (chaque patte
 * adopte ses coxa/fémur/tibia), sinon de la stance intégrée.
 */
interface GaitBase {
  /** Débattement coxa maximal autorisé par les butées servo (plafonné à 45°). */
  coxaCap: number;
  /** Coxa de repos par patte (0 sans pose de base). */
  baseCoxa: number[];
  stanceFemur: number[];
  stanceTibia: number[];
  liftFemur: number[];
  liftTibia: number[];
}

function computeGaitBase(
  calibration: Record<number, ServoCalibration>,
  useSoft: boolean,
  liftFraction: number,
  geometry: HexapodGeometry,
  basePose?: number[]
): GaitBase {
  // Coxa: most conservative range across all 6 legs, plafonné à 45°.
  let minCoxaRange = Infinity;
  for (let leg = 0; leg < 6; leg++) {
    const lim = getLimits(leg * 3, calibration, useSoft);
    minCoxaRange = Math.min(minCoxaRange, Math.abs(lim.min), lim.max);
  }
  const coxaCap = Math.min(minCoxaRange, 45);

  // Stance intégrée (repère servo) : la consigne géométrique standard (fémur −20°,
  // tibia −60°) moins l'offset de montage. Utilisée patte par patte si aucune pose
  // de base n'est fournie. La géométrie produite reste identique (offset en FK).
  const femurOffset = mountingOffsetOf(geometry, 1);
  const tibiaOffset = mountingOffsetOf(geometry, 2);
  const defStanceFemur = -20 - femurOffset;
  const defStanceTibia = -60 - tibiaOffset;

  const baseCoxa: number[] = [];
  const stanceFemur: number[] = [];
  const stanceTibia: number[] = [];
  const liftFemur: number[] = [];
  const liftTibia: number[] = [];
  for (let leg = 0; leg < 6; leg++) {
    const fLim = getLimits(leg * 3 + 1, calibration, useSoft);
    const tLim = getLimits(leg * 3 + 2, calibration, useSoft);
    const bc = basePose && Number.isFinite(basePose[leg * 3]) ? basePose[leg * 3] : 0;
    const rawF = basePose && Number.isFinite(basePose[leg * 3 + 1]) ? basePose[leg * 3 + 1] : defStanceFemur;
    const rawT = basePose && Number.isFinite(basePose[leg * 3 + 2]) ? basePose[leg * 3 + 2] : defStanceTibia;
    const sf = clampAngle(rawF, fLim.min, fLim.max);
    const st = clampAngle(rawT, tLim.min, tLim.max);
    baseCoxa.push(bc);
    stanceFemur.push(sf);
    stanceTibia.push(st);
    // Lift: shift from stance by 40° (femur) and 30° (tibia) proportional to liftFraction.
    liftFemur.push(clampAngle(sf + 40 * liftFraction, fLim.min, fLim.max));
    liftTibia.push(clampAngle(st + 30 * liftFraction, tLim.min, tLim.max));
  }

  return { coxaCap, baseCoxa, stanceFemur, stanceTibia, liftFemur, liftTibia };
}

/** Returns [coxa, femur, tibia] for a leg in a given gait slot. */
function slotAngles(
  slot: Slot,
  legIndex: number,
  base: GaitBase,
  swing: number
): [number, number, number] {
  // Left legs (0-2): forward = negative coxa; right legs (3-5): forward = positive coxa.
  const sign = legIndex < 3 ? -1 : 1;
  const c = base.baseCoxa[legIndex]; // coxa de repos (pose de base), 0 par défaut
  switch (slot) {
    case "U":   return [c, base.liftFemur[legIndex], base.liftTibia[legIndex]];
    case "fwd": return [c + sign * swing, base.stanceFemur[legIndex], base.stanceTibia[legIndex]];
    case "mid": return [c, base.stanceFemur[legIndex], base.stanceTibia[legIndex]];
    case "bck": return [c - sign * swing, base.stanceFemur[legIndex], base.stanceTibia[legIndex]];
  }
}

/** Builds a flat 18-value pose from 6 slot assignments [L0…L5]. */
function buildPose(slots: Slot[], base: GaitBase, swing: number): number[] {
  const pose = new Array<number>(18);
  for (let leg = 0; leg < 6; leg++) {
    const [coxa, femur, tibia] = slotAngles(slots[leg], leg, base, swing);
    pose[leg * 3]     = coxa;
    pose[leg * 3 + 1] = femur;
    pose[leg * 3 + 2] = tibia;
  }
  return pose;
}

function makeStep(name: string, slots: Slot[], base: GaitBase, swing: number): SequencerStep {
  return { id: uid(), name, type: "defined", pose: buildPose(slots, base, swing) };
}

// ── Gait patterns ─────────────────────────────────────────────────────────────
// Each entry is an array of 6 slots (L0, L1, L2, L3, L4, L5).

function tripodSteps(base: GaitBase, swing: number): SequencerStep[] {
  // Group A: L0, L2, L4 — Group B: L1, L3, L5
  return [
    makeStep("A avant, B levé",    ["fwd","U",  "fwd","U",  "fwd","U"  ], base, swing),
    makeStep("A arrière, B avant", ["bck","fwd","bck","fwd","bck","fwd"], base, swing),
    makeStep("A levé, B avant",    ["U",  "fwd","U",  "fwd","U",  "fwd"], base, swing),
    makeStep("A avant, B arrière", ["fwd","bck","fwd","bck","fwd","bck"], base, swing),
  ];
}

function rippleSteps(base: GaitBase, swing: number): SequencerStep[] {
  // Diagonal pairs: A={L0,L5}, B={L2,L3}, C={L1,L4}
  // Stance progression: fwd → mid → bck → bck (4 steps)
  return [
    makeStep("Paire A levée",     ["U",  "mid","bck","bck","mid","U"  ], base, swing),
    makeStep("Paire A atterrit",  ["fwd","bck","bck","bck","bck","fwd"], base, swing),
    makeStep("Paire B levée",     ["mid","bck","U",  "U",  "bck","mid"], base, swing),
    makeStep("Paire B atterrit",  ["bck","bck","fwd","fwd","bck","bck"], base, swing),
    makeStep("Paire C levée",     ["bck","U",  "mid","mid","U",  "bck"], base, swing),
    makeStep("Paire C atterrit",  ["bck","fwd","bck","bck","fwd","bck"], base, swing),
  ];
}

function waveSteps(base: GaitBase, swing: number): SequencerStep[] {
  // Lift order: L0 → L3 → L1 → L4 → L2 → L5
  // Progression on ground: fwd → mid → mid → bck → bck (5-stance cycle)
  return [
    makeStep("L0 levée (FL)", ["U",  "bck","mid","bck","mid","fwd"], base, swing),
    makeStep("L3 levée (FR)", ["fwd","bck","mid","U",  "bck","mid"], base, swing),
    makeStep("L1 levée (ML)", ["mid","U",  "bck","fwd","bck","mid"], base, swing),
    makeStep("L4 levée (MR)", ["mid","fwd","bck","mid","U",  "bck"], base, swing),
    makeStep("L2 levée (RL)", ["bck","mid","U",  "mid","fwd","bck"], base, swing),
    makeStep("L5 levée (RR)", ["bck","mid","fwd","bck","mid","U"  ], base, swing),
  ];
}

function buildSteps(gaitType: GaitType, base: GaitBase, swing: number): SequencerStep[] {
  return gaitType === "tripod" ? tripodSteps(base, swing)
       : gaitType === "ripple" ? rippleSteps(base, swing)
       : waveSteps(base, swing);
}

// ── Stability score computation ───────────────────────────────────────────────

/** Inclinaison du corps (rad) au-delà de laquelle la pose n'est pas tenue à plat. */
const TILT_STABLE = 0.02; // ≈ 1.1°

/** Angle d'inclinaison du corps (rad) à partir du quaternion d'équilibre. */
function bodyTiltRad(q: { w: number }): number {
  return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
}

/**
 * Plus grand débattement coxa (∈ [0, coxaCap]) pour lequel TOUTES les étapes de
 * la démarche restent stables : corps reposant à plat (sans inclinaison) et CoG
 * strictement dans le polygone d'appui.
 *
 * Sur des pattes montées latéralement (yaw ±90°), un grand débattement fait
 * pivoter le pied en arc et le ramène vers l'intérieur ; la base d'appui se
 * referme et le robot bascule sur une patte censée être en phase de transfert.
 * On borne donc l'amplitude à ce qui est réellement tenable pour la géométrie.
 * Recherche dichotomique — la stabilité décroît de façon monotone avec le
 * débattement (pieds de plus en plus rentrés).
 */
function maxStableSwing(
  gaitType: GaitType,
  base: GaitBase,
  geometry: HexapodGeometry,
  mounts: LegMount[]
): number {
  const isStable = (swing: number): boolean =>
    buildSteps(gaitType, base, swing).every((s) => {
      const bt = computeBodyTransform(s.pose, geometry, mounts, true);
      return bt.cogInside && bodyTiltRad(bt.quaternion) <= TILT_STABLE;
    });

  if (isStable(base.coxaCap)) return base.coxaCap;
  let lo = 0, hi = base.coxaCap;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (isStable(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** Minimum unsigned distance from point P to any segment of the polygon. */
function minDistToPolygon(
  p: { x: number; z: number },
  poly: { x: number; z: number }[]
): number {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    const t = lenSq < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq));
    const dist = Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
    if (dist < min) min = dist;
  }
  return min;
}

/**
 * Signed stability score for one step in [-1, +1].
 * +1  = CoG at polygon centroid (maximum margin).
 *  0  = CoG exactly on polygon edge.
 * -1  = CoG outside by a distance equal to the centroid margin (or more).
 */
function computeStabilityScore(
  pose: number[],
  geometry: HexapodGeometry,
  mounts: LegMount[]
): number {
  const result = computeBodyTransform(pose, geometry, mounts, true);

  // Si le solveur a dû incliner le corps pour trouver son équilibre, la pose
  // commandée n'est pas tenue à plat : une patte censée être levée porte en
  // réalité le robot. C'est un échec d'appui — on le classe en Danger,
  // proportionnellement à l'inclinaison (−0.5 au seuil, −1 au-delà de ~12°).
  const tilt = bodyTiltRad(result.quaternion);
  if (tilt > TILT_STABLE) {
    return Math.max(-1, -0.5 - 0.5 * Math.min(1, (tilt - TILT_STABLE) / degToRad(12)));
  }

  const poly = result.supportPolygon;
  if (poly.length < 3) return -1;

  const cogXZ = { x: result.cogWorld.x, z: result.cogWorld.z };
  const margin = minDistToPolygon(cogXZ, poly);

  // Centroid margin = distance from polygon centroid to nearest edge (reference = perfect stability)
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cz = poly.reduce((s, p) => s + p.z, 0) / poly.length;
  const centroidMargin = minDistToPolygon({ x: cx, z: cz }, poly);

  if (centroidMargin < 1e-6) return result.cogInside ? 0 : -1;

  const raw = result.cogInside ? margin / centroidMargin : -(margin / centroidMargin);
  return Math.max(-1, Math.min(1, raw));
}

function computeStabilityScores(
  steps: SequencerStep[],
  geometry: HexapodGeometry,
  mounts: LegMount[]
): number[] {
  return steps.map((s) => computeStabilityScore(s.pose, geometry, mounts));
}

// ── Public API ────────────────────────────────────────────────────────────────

export function generateGait(config: GaitGeneratorConfig): GaitResult {
  const { geometry, legMounts, calibration, gaitType, stepFraction, liftFraction, useSoftLimits, basePose } = config;

  const base = computeGaitBase(calibration, useSoftLimits, liftFraction, geometry, basePose);
  // Débattement réellement tenable pour cette géométrie + démarche ; `stepFraction`
  // (0.1–1.0) en sélectionne une fraction. Garantit des séquences qui ne basculent
  // pas et rend le curseur « amplitude de pas » utile sur toute sa course.
  const safeSwing = maxStableSwing(gaitType, base, geometry, legMounts);
  const swingAngle = Math.max(0, Math.min(1, stepFraction)) * safeSwing;

  const steps = buildSteps(gaitType, base, swingAngle);
  const stabilityScores = computeStabilityScores(steps, geometry, legMounts);

  return { steps, stabilityScores };
}

/** Generates a display name for a sequence, e.g. "Démarche — Tripod (Hexapode v1)". */
export function gaitSequenceName(gaitType: GaitType, profileName?: string): string {
  const label = gaitType === "tripod" ? "Tripod" : gaitType === "ripple" ? "Ripple" : "Wave";
  return profileName ? `Démarche — ${label} (${profileName})` : `Démarche — ${label}`;
}
