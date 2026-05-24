import type { HexapodGeometry, LegMount } from "./hexapod";
import type { ServoCalibration } from "../store/useHexapodStore";
import type { SequencerStep } from "../store/useSequencerStore";
import { clampAngle } from "./servo";
import { computeBodyTransform } from "./kinematics";

export type GaitType = "tripod" | "ripple" | "wave";

export interface GaitGeneratorConfig {
  geometry: HexapodGeometry;
  legMounts: LegMount[];
  calibration: Record<number, ServoCalibration>;
  gaitType: GaitType;
  /** Fraction of the available coxa range used as stride length (0.1–1.0). */
  stepFraction: number;
  /** Fraction of the maximum achievable lift height (0.1–1.0). */
  liftFraction: number;
  useSoftLimits: boolean;
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

interface GaitParams {
  swingAngle: number;
  stanceFemur: number;
  stanceTibia: number;
  liftFemur: number;
  liftTibia: number;
}

function computeGaitParams(
  calibration: Record<number, ServoCalibration>,
  useSoft: boolean,
  stepFraction: number,
  liftFraction: number
): GaitParams {
  // Coxa: most conservative range across all 6 legs
  let minCoxaRange = Infinity;
  for (let leg = 0; leg < 6; leg++) {
    const lim = getLimits(leg * 3, calibration, useSoft);
    minCoxaRange = Math.min(minCoxaRange, Math.abs(lim.min), lim.max);
  }
  const swingAngle = Math.min(stepFraction * minCoxaRange, 45);

  // Femur / tibia: most restrictive combined range across all 6 legs
  let femurMin = FALLBACK_MIN, femurMax = FALLBACK_MAX;
  let tibiaMin = FALLBACK_MIN, tibiaMax = FALLBACK_MAX;
  for (let leg = 0; leg < 6; leg++) {
    const fLim = getLimits(leg * 3 + 1, calibration, useSoft);
    const tLim = getLimits(leg * 3 + 2, calibration, useSoft);
    femurMin = Math.max(femurMin, fLim.min);
    femurMax = Math.min(femurMax, fLim.max);
    tibiaMin = Math.max(tibiaMin, tLim.min);
    tibiaMax = Math.min(tibiaMax, tLim.max);
  }

  // Neutral stance: standard defaults clamped to available range
  const stanceFemur = clampAngle(-20, femurMin, femurMax);
  const stanceTibia = clampAngle(-60, tibiaMin, tibiaMax);

  // Lift: shift from stance by 40° (femur) and 30° (tibia) proportional to liftFraction
  const liftFemur = clampAngle(stanceFemur + 40 * liftFraction, femurMin, femurMax);
  const liftTibia = clampAngle(stanceTibia + 30 * liftFraction, tibiaMin, tibiaMax);

  return { swingAngle, stanceFemur, stanceTibia, liftFemur, liftTibia };
}

/** Returns [coxa, femur, tibia] for a leg in a given gait slot. */
function slotAngles(
  slot: Slot,
  legIndex: number,
  p: GaitParams
): [number, number, number] {
  // Left legs (0-2): forward = negative coxa; right legs (3-5): forward = positive coxa
  const sign = legIndex < 3 ? -1 : 1;
  switch (slot) {
    case "U":   return [0, p.liftFemur, p.liftTibia];
    case "fwd": return [sign * p.swingAngle, p.stanceFemur, p.stanceTibia];
    case "mid": return [0, p.stanceFemur, p.stanceTibia];
    case "bck": return [-sign * p.swingAngle, p.stanceFemur, p.stanceTibia];
  }
}

/** Builds a flat 18-value pose from 6 slot assignments [L0…L5]. */
function buildPose(slots: Slot[], p: GaitParams): number[] {
  const pose = new Array<number>(18);
  for (let leg = 0; leg < 6; leg++) {
    const [coxa, femur, tibia] = slotAngles(slots[leg], leg, p);
    pose[leg * 3]     = coxa;
    pose[leg * 3 + 1] = femur;
    pose[leg * 3 + 2] = tibia;
  }
  return pose;
}

function makeStep(name: string, slots: Slot[], p: GaitParams): SequencerStep {
  return { id: uid(), name, type: "defined", pose: buildPose(slots, p) };
}

// ── Gait patterns ─────────────────────────────────────────────────────────────
// Each entry is an array of 6 slots (L0, L1, L2, L3, L4, L5).

function tripodSteps(p: GaitParams): SequencerStep[] {
  // Group A: L0, L2, L4 — Group B: L1, L3, L5
  return [
    makeStep("A avant, B levé",    ["fwd","U",  "fwd","U",  "fwd","U"  ], p),
    makeStep("A arrière, B avant", ["bck","fwd","bck","fwd","bck","fwd"], p),
    makeStep("A levé, B avant",    ["U",  "fwd","U",  "fwd","U",  "fwd"], p),
    makeStep("A avant, B arrière", ["fwd","bck","fwd","bck","fwd","bck"], p),
  ];
}

function rippleSteps(p: GaitParams): SequencerStep[] {
  // Diagonal pairs: A={L0,L5}, B={L2,L3}, C={L1,L4}
  // Stance progression: fwd → mid → bck → bck (4 steps)
  return [
    makeStep("Paire A levée",     ["U",  "mid","bck","bck","mid","U"  ], p),
    makeStep("Paire A atterrit",  ["fwd","bck","bck","bck","bck","fwd"], p),
    makeStep("Paire B levée",     ["mid","bck","U",  "U",  "bck","mid"], p),
    makeStep("Paire B atterrit",  ["bck","bck","fwd","fwd","bck","bck"], p),
    makeStep("Paire C levée",     ["bck","U",  "mid","mid","U",  "bck"], p),
    makeStep("Paire C atterrit",  ["bck","fwd","bck","bck","fwd","bck"], p),
  ];
}

function waveSteps(p: GaitParams): SequencerStep[] {
  // Lift order: L0 → L3 → L1 → L4 → L2 → L5
  // Progression on ground: fwd → mid → mid → bck → bck (5-stance cycle)
  return [
    makeStep("L0 levée (FL)", ["U",  "bck","mid","bck","mid","fwd"], p),
    makeStep("L3 levée (FR)", ["fwd","bck","mid","U",  "bck","mid"], p),
    makeStep("L1 levée (ML)", ["mid","U",  "bck","fwd","bck","mid"], p),
    makeStep("L4 levée (MR)", ["mid","fwd","bck","mid","U",  "bck"], p),
    makeStep("L2 levée (RL)", ["bck","mid","U",  "mid","fwd","bck"], p),
    makeStep("L5 levée (RR)", ["bck","mid","fwd","bck","mid","U"  ], p),
  ];
}

// ── Stability score computation ───────────────────────────────────────────────

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
  const { geometry, legMounts, calibration, gaitType, stepFraction, liftFraction, useSoftLimits } = config;

  const params = computeGaitParams(calibration, useSoftLimits, stepFraction, liftFraction);

  const steps =
    gaitType === "tripod" ? tripodSteps(params) :
    gaitType === "ripple" ? rippleSteps(params) :
    waveSteps(params);

  const stabilityScores = computeStabilityScores(steps, geometry, legMounts);

  return { steps, stabilityScores };
}

/** Generates a display name for a sequence, e.g. "Démarche — Tripod (Hexapode v1)". */
export function gaitSequenceName(gaitType: GaitType, profileName?: string): string {
  const label = gaitType === "tripod" ? "Tripod" : gaitType === "ripple" ? "Ripple" : "Wave";
  return profileName ? `Démarche — ${label} (${profileName})` : `Démarche — ${label}`;
}
