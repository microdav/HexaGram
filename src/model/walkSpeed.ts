import { Vector3 } from "three";
import { computeBodyTransform } from "./kinematics";
import { computeLegMounts, type HexapodGeometry } from "./hexapod";
import type { Pose } from "./pose";

export interface WalkSpeedSample {
  /** Time at start of the transition, seconds. */
  time: number;
  /** Instant speed magnitude over this transition, m/s. */
  speed: number;
  /** Body shift vector (x,z), meters. Positive x = robot forward (body frame). */
  dx: number;
  dz: number;
  /** Max disagreement between anchored feet — proxy for ground slip, meters. */
  slip: number;
  /** Number of feet anchored at both i and i+1. */
  anchorCount: number;
}

export interface WalkSpeedStats {
  min: number;
  avg: number;
  max: number;
  /** Net cycle displacement (closed-loop), meters. */
  cycleDisplacement: number;
  /** Net forward speed over the full cycle, m/s. */
  cycleSpeed: number;
  /** Total cycle duration, seconds. */
  cycleDuration: number;
  /** Avg slip across transitions, meters. */
  avgSlip: number;
}

/**
 * Compute per-transition body displacement and instant speed for a looped
 * sequence of poses. Assumes no foot slip — anchored feet (in contact at both
 * poses) impose the body's xz translation; we average across them when ≥1.
 */
export function buildWalkSpeedSeries(
  poses: Pose[],
  geometry: HexapodGeometry,
  gravityEnabled: boolean,
  transitionSpeed: number,
  stepDelay: number
): WalkSpeedSample[] {
  const dur = transitionSpeed + stepDelay;
  if (poses.length < 2 || dur <= 0) return [];

  const mounts = computeLegMounts(geometry);
  const contactsByPose = poses.map((p) => {
    const bt = computeBodyTransform(p, geometry, mounts, gravityEnabled);
    const map = new Map<number, Vector3>();
    for (const c of bt.contacts) map.set(c.legIndex, c.position.clone());
    return map;
  });

  return poses.map((_, i) => {
    const a = contactsByPose[i];
    const b = contactsByPose[(i + 1) % poses.length];
    const shared: number[] = [];
    for (const leg of a.keys()) if (b.has(leg)) shared.push(leg);

    if (shared.length === 0) {
      return { time: i * dur, speed: 0, dx: 0, dz: 0, slip: 0, anchorCount: 0 };
    }

    let sumX = 0;
    let sumZ = 0;
    const deltas: { x: number; z: number }[] = [];
    for (const leg of shared) {
      const pa = a.get(leg)!;
      const pb = b.get(leg)!;
      const dx = pa.x - pb.x;
      const dz = pa.z - pb.z;
      deltas.push({ x: dx, z: dz });
      sumX += dx;
      sumZ += dz;
    }
    const meanX = sumX / shared.length;
    const meanZ = sumZ / shared.length;

    let slip = 0;
    for (const d of deltas) {
      const dxs = d.x - meanX;
      const dzs = d.z - meanZ;
      const m = Math.hypot(dxs, dzs);
      if (m > slip) slip = m;
    }

    const mag = Math.hypot(meanX, meanZ);
    return {
      time: i * dur,
      speed: mag / dur,
      dx: meanX,
      dz: meanZ,
      slip,
      anchorCount: shared.length,
    };
  });
}

export function computeWalkSpeedStats(samples: WalkSpeedSample[]): WalkSpeedStats | null {
  if (samples.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let netX = 0;
  let netZ = 0;
  let slipSum = 0;
  for (const s of samples) {
    if (s.speed < min) min = s.speed;
    if (s.speed > max) max = s.speed;
    sum += s.speed;
    netX += s.dx;
    netZ += s.dz;
    slipSum += s.slip;
  }
  const spacing = samples.length > 1 ? samples[1].time - samples[0].time : 1;
  const totalDur = spacing * samples.length;
  const netMag = Math.hypot(netX, netZ);
  return {
    min,
    avg: sum / samples.length,
    max,
    cycleDisplacement: netMag,
    cycleSpeed: totalDur > 0 ? netMag / totalDur : 0,
    cycleDuration: totalDur,
    avgSlip: slipSum / samples.length,
  };
}
