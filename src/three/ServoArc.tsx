import { useMemo, useRef } from "react";
import { Line } from "@react-three/drei";
import { DoubleSide } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { degToRad } from "../model/servo";

interface ServoArcProps {
  axis: "Y" | "Z";
  minDeg: number;
  maxDeg: number;
  currentDeg: number;
  radius: number;
  visible: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onAngle: (deg: number) => void;
  /** Butées CALIBRÉES (deg, repère servo) : matérialisées sur l'arc ; le pointeur
   *  passe au rouge quand `currentDeg` les dépasse (P4 — fidélité au robot). */
  limitMinDeg?: number;
  limitMaxDeg?: number;
}

const ACTIVE_COLOR = "#7ab8ff";
const INACTIVE_COLOR = "#3a4150";
const TICK_COLOR = "#9bc7ff";
const TICK_INACTIVE_COLOR = "#4a4f5a";
const TICK_MAJOR_COLOR = "#ffffff";
const POINTER_COLOR = "#f5c518";
const LIMIT_COLOR = "#f59e0b"; // marque de butée calibrée
const POINTER_OOB_COLOR = "#ef4444"; // pointeur hors butée

function buildArcPoints(
  startDeg: number,
  endDeg: number,
  radius: number,
  segments: number,
): [number, number, number][] {
  const pts: [number, number, number][] = [];
  if (endDeg === startDeg) return pts;
  const span = endDeg - startDeg;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const deg = startDeg + span * t;
    const rad = degToRad(deg);
    pts.push([Math.cos(rad) * radius, Math.sin(rad) * radius, 0]);
  }
  return pts;
}

export function ServoArc({
  axis,
  minDeg,
  maxDeg,
  currentDeg,
  radius,
  visible,
  onEnter,
  onLeave,
  onAngle,
  limitMinDeg,
  limitMaxDeg,
}: ServoArcProps) {
  const dragging = useRef(false);

  // The visual arc is always 180° wide, centered on the servo's range
  // midpoint. The portion inside [minDeg, maxDeg] is the "active" arc;
  // the rest is dimmed so the user sees where the limits are.
  const center = (minDeg + maxDeg) / 2;
  const visualStart = center - 90;
  const visualEnd = center + 90;

  const activePoints = useMemo(
    () => buildArcPoints(minDeg, maxDeg, radius, 48),
    [minDeg, maxDeg, radius],
  );
  const inactiveLeftPoints = useMemo(
    () => buildArcPoints(visualStart, minDeg, radius, 24),
    [visualStart, minDeg, radius],
  );
  const inactiveRightPoints = useMemo(
    () => buildArcPoints(maxDeg, visualEnd, radius, 24),
    [maxDeg, visualEnd, radius],
  );

  const ticks = useMemo(() => {
    const collected = new Map<number, { isMajor: boolean; isActive: boolean }>();
    const add = (deg: number, isMajor: boolean) => {
      const isActive = deg >= minDeg && deg <= maxDeg;
      const prev = collected.get(deg);
      collected.set(deg, {
        isMajor: prev ? prev.isMajor || isMajor : isMajor,
        isActive,
      });
    };
    const startTick = Math.ceil(visualStart / 15) * 15;
    for (let d = startTick; d <= visualEnd + 1e-6; d += 15) {
      add(d, d === 0);
    }
    add(minDeg, true);
    add(maxDeg, true);
    return Array.from(collected.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([deg, info]) => {
        const isMajor = info.isMajor;
        const r1 = isMajor ? radius * 0.76 : radius * 0.88;
        const r2 = isMajor ? radius * 1.16 : radius * 1.06;
        const rad = degToRad(deg);
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        return {
          deg,
          isMajor,
          isActive: info.isActive,
          a: [c * r1, s * r1, 0] as [number, number, number],
          b: [c * r2, s * r2, 0] as [number, number, number],
        };
      });
  }, [visualStart, visualEnd, minDeg, maxDeg, radius]);

  const pointerEnd = useMemo<[number, number, number]>(() => {
    const rad = degToRad(currentDeg);
    return [Math.cos(rad) * radius * 1.08, Math.sin(rad) * radius * 1.08, 0];
  }, [currentDeg, radius]);

  // Butées calibrées : pointeur rouge si la pose les dépasse, marques radiales.
  const hasLimit = limitMinDeg != null && limitMaxDeg != null;
  const outOfLimit =
    hasLimit && (currentDeg < (limitMinDeg as number) - 1e-6 || currentDeg > (limitMaxDeg as number) + 1e-6);
  const pointerColor = outOfLimit ? POINTER_OOB_COLOR : POINTER_COLOR;

  const limitMarks = useMemo(() => {
    const out: { a: [number, number, number]; b: [number, number, number] }[] = [];
    if (limitMinDeg == null || limitMaxDeg == null) return out;
    // Seules les butées RÉELLEMENT plus serrées que la plage modèle sont tracées
    // (sinon des marques s'afficheraient toujours aux extrémités, sans utilité).
    const degs: number[] = [];
    if (limitMinDeg > minDeg + 1e-6) degs.push(limitMinDeg);
    if (limitMaxDeg < maxDeg - 1e-6) degs.push(limitMaxDeg);
    for (const deg of degs) {
      if (deg < visualStart - 1e-6 || deg > visualEnd + 1e-6) continue;
      const rad = degToRad(deg);
      const c = Math.cos(rad), s = Math.sin(rad);
      out.push({
        a: [c * radius * 0.72, s * radius * 0.72, 0],
        b: [c * radius * 1.22, s * radius * 1.22, 0],
      });
    }
    return out;
  }, [limitMinDeg, limitMaxDeg, minDeg, maxDeg, visualStart, visualEnd, radius]);

  const ringInner = radius * 0.78;
  const ringOuter = radius * 1.18;
  const ringStart = degToRad(visualStart);
  const ringArc = degToRad(180);

  const applyFromEvent = (e: ThreeEvent<PointerEvent>) => {
    const local = e.point.clone();
    e.object.worldToLocal(local);
    const ang = Math.atan2(local.y, local.x);
    let deg = (ang * 180) / Math.PI;
    // Clamp into the servo's allowed range — dragging past a limit just
    // sticks at the boundary instead of jumping to the other side.
    deg = Math.max(minDeg, Math.min(maxDeg, deg));
    onAngle(Math.round(deg));
  };

  const tryCapture = (e: ThreeEvent<PointerEvent>) => {
    const el = e.target as Element | null;
    if (el && typeof (el as Element).setPointerCapture === "function") {
      try {
        (el as Element).setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
  };

  const tryRelease = (e: ThreeEvent<PointerEvent>) => {
    const el = e.target as Element | null;
    if (el && typeof (el as Element).releasePointerCapture === "function") {
      try {
        (el as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
    }
  };

  const groupRotation: [number, number, number] =
    axis === "Y" ? [-Math.PI / 2, 0, 0] : [0, 0, 0];

  return (
    <group rotation={groupRotation}>
      {/* Full-180° hit target — hover anywhere reveals the arc; clicks/drags
          inside the allowed range set the angle (outside the range they're
          clamped to the nearest limit). */}
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation();
          onEnter();
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          if (dragging.current) {
            dragging.current = false;
            tryRelease(e);
          }
          onLeave();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          dragging.current = true;
          tryCapture(e);
          applyFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) {
            e.stopPropagation();
            applyFromEvent(e);
          }
        }}
        onPointerUp={(e) => {
          if (dragging.current) {
            dragging.current = false;
            e.stopPropagation();
            tryRelease(e);
          }
        }}
      >
        <ringGeometry args={[ringInner, ringOuter, 64, 1, ringStart, ringArc]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>

      {visible && (
        <>
          {/* Inactive arc segments (servo travel limit) */}
          {inactiveLeftPoints.length > 0 && (
            <Line
              points={inactiveLeftPoints}
              color={INACTIVE_COLOR}
              lineWidth={1}
              transparent
              opacity={0.6}
              dashed
              dashSize={0.004}
              gapSize={0.003}
            />
          )}
          {inactiveRightPoints.length > 0 && (
            <Line
              points={inactiveRightPoints}
              color={INACTIVE_COLOR}
              lineWidth={1}
              transparent
              opacity={0.6}
              dashed
              dashSize={0.004}
              gapSize={0.003}
            />
          )}

          {/* Active arc — servo's allowed range */}
          {activePoints.length > 0 && (
            <Line
              points={activePoints}
              color={ACTIVE_COLOR}
              lineWidth={1.8}
              transparent
              opacity={0.95}
            />
          )}

          {/* Tick marks every 15° across the full 180° */}
          {ticks.map((t) => (
            <Line
              key={t.deg}
              points={[t.a, t.b]}
              color={
                t.isMajor
                  ? TICK_MAJOR_COLOR
                  : t.isActive
                    ? TICK_COLOR
                    : TICK_INACTIVE_COLOR
              }
              lineWidth={t.isMajor ? 2 : 1}
              transparent
              opacity={t.isActive ? (t.isMajor ? 1 : 0.8) : 0.45}
            />
          ))}

          {/* Butées calibrées (binding) — marques radiales orange */}
          {limitMarks.map((m, i) => (
            <Line
              key={`lim-${i}`}
              points={[m.a, m.b]}
              color={LIMIT_COLOR}
              lineWidth={2.5}
              transparent
              opacity={0.9}
            />
          ))}

          {/* Current angle pointer — rouge si hors butée calibrée */}
          <Line
            points={[[0, 0, 0], pointerEnd]}
            color={pointerColor}
            lineWidth={2.5}
            transparent
            opacity={0.95}
          />
          <mesh position={pointerEnd}>
            <sphereGeometry args={[Math.max(0.005, radius * 0.07), 12, 12]} />
            <meshBasicMaterial color={pointerColor} />
          </mesh>
        </>
      )}
    </group>
  );
}
