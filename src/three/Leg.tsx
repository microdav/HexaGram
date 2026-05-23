import { useEffect, useRef } from "react";
import { degToRad } from "../model/servo";
import { servoIndex } from "../model/pose";
import { mirrorLegOf, useHexapodStore } from "../store/useHexapodStore";
import { SERVOS, type LegMount } from "../model/hexapod";
import { ServoArc } from "./ServoArc";

interface LegProps {
  mount: LegMount;
}

const HEXAPOD_YELLOW = "#f5c518";
const JOINT_COLOR = "#222";
const JOINT_HOVER_COLOR = "#7ab8ff";

type JointKey = "coxa" | "femur" | "tibia";
const JOINT_KEYS: JointKey[] = ["coxa", "femur", "tibia"];

export function Leg({ mount }: LegProps) {
  const pose = useHexapodStore((s) => s.pose);
  const segs = useHexapodStore((s) => s.geometry.segments);
  const setServoAngle = useHexapodStore((s) => s.setServoAngle);
  const arcShownMask = useHexapodStore((s) => s.arcShownMask);
  const mirrorEnabled = useHexapodStore((s) => s.mirrorEnabled);
  const setArcShown = useHexapodStore((s) => s.setArcShown);

  const coxaId = servoIndex(mount.index, "coxa");
  const femurId = servoIndex(mount.index, "femur");
  const tibiaId = servoIndex(mount.index, "tibia");

  const coxaDeg = pose[coxaId];
  const femurDeg = pose[femurId];
  const tibiaDeg = pose[tibiaId];

  const coxaDef = SERVOS[coxaId];
  const femurDef = SERVOS[femurId];
  const tibiaDef = SERVOS[tibiaId];

  // Direct hover counters (per joint) — sphere + arc share the same key, so we
  // count pointer entries/exits across both to keep the arc visible during the
  // sphere-to-arc transit without flicker.
  const counts = useRef<Record<JointKey, number>>({ coxa: 0, femur: 0, tibia: 0 });
  const timers = useRef<Record<JointKey, number | null>>({
    coxa: null,
    femur: null,
    tibia: null,
  });
  const servoIdOf = (k: JointKey): number => servoIndex(mount.index, k);

  const onEnter = (k: JointKey) => {
    counts.current[k] += 1;
    const t = timers.current[k];
    if (t != null) {
      window.clearTimeout(t);
      timers.current[k] = null;
    }
    setArcShown(servoIdOf(k), true);
  };

  const onLeave = (k: JointKey) => {
    counts.current[k] = Math.max(0, counts.current[k] - 1);
    if (counts.current[k] === 0) {
      const t = timers.current[k];
      if (t != null) window.clearTimeout(t);
      timers.current[k] = window.setTimeout(() => {
        if (counts.current[k] === 0) {
          setArcShown(servoIdOf(k), false);
        }
        timers.current[k] = null;
      }, 200);
    }
  };

  useEffect(() => {
    const localTimers = timers.current;
    const myServoIds = JOINT_KEYS.map((k) => servoIndex(mount.index, k));
    return () => {
      JOINT_KEYS.forEach((k) => {
        const t = localTimers[k];
        if (t != null) window.clearTimeout(t);
      });
      // Best-effort cleanup so a remounted leg doesn't leave stale bits set.
      myServoIds.forEach((id) => setArcShown(id, false));
    };
  }, [mount.index, setArcShown]);

  // Effective visibility = directly hovered OR (mirror on AND its mirror joint
  // is directly hovered).
  const mirrorLeg = mirrorLegOf(mount.index);
  const visibleFor = (k: JointKey): boolean => {
    const ownId = servoIdOf(k);
    const ownBit = (arcShownMask >>> ownId) & 1;
    if (ownBit) return true;
    if (!mirrorEnabled) return false;
    const mirrorId = servoIndex(mirrorLeg, k);
    return ((arcShownMask >>> mirrorId) & 1) === 1;
  };

  const showCoxa = visibleFor("coxa");
  const showFemur = visibleFor("femur");
  const showTibia = visibleFor("tibia");

  const jointR = 0.012;
  const coxaArcR = Math.max(0.035, segs.coxa * 0.85);
  const femurArcR = Math.max(0.045, segs.femur * 0.55);
  const tibiaArcR = Math.max(0.05, segs.tibia * 0.45);

  return (
    <group position={mount.position} rotation={[0, degToRad(mount.yawDeg), 0]}>
      {/* Coxa joint + arc (rotation around Y) */}
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation();
          onEnter("coxa");
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          onLeave("coxa");
        }}
      >
        <sphereGeometry args={[jointR, 16, 16]} />
        <meshStandardMaterial color={showCoxa ? JOINT_HOVER_COLOR : JOINT_COLOR} />
      </mesh>
      <ServoArc
        axis="Y"
        minDeg={coxaDef.minDeg}
        maxDeg={coxaDef.maxDeg}
        currentDeg={coxaDeg}
        radius={coxaArcR}
        visible={showCoxa}
        onEnter={() => onEnter("coxa")}
        onLeave={() => onLeave("coxa")}
        onAngle={(d) => setServoAngle(coxaId, d)}
      />

      <group rotation={[0, degToRad(coxaDeg), 0]}>
        <mesh position={[segs.coxa / 2, 0, 0]}>
          <boxGeometry args={[segs.coxa, 0.018, 0.018]} />
          <meshStandardMaterial color={HEXAPOD_YELLOW} />
        </mesh>
        <group position={[segs.coxa, 0, 0]}>
          {/* Femur joint + arc (rotation around Z) */}
          <mesh
            onPointerOver={(e) => {
              e.stopPropagation();
              onEnter("femur");
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              onLeave("femur");
            }}
          >
            <sphereGeometry args={[jointR, 16, 16]} />
            <meshStandardMaterial color={showFemur ? JOINT_HOVER_COLOR : JOINT_COLOR} />
          </mesh>
          <ServoArc
            axis="Z"
            minDeg={femurDef.minDeg}
            maxDeg={femurDef.maxDeg}
            currentDeg={femurDeg}
            radius={femurArcR}
            visible={showFemur}
            onEnter={() => onEnter("femur")}
            onLeave={() => onLeave("femur")}
            onAngle={(d) => setServoAngle(femurId, d)}
          />

          <group rotation={[0, 0, degToRad(femurDeg)]}>
            <mesh position={[segs.femur / 2, 0, 0]}>
              <boxGeometry args={[segs.femur, 0.016, 0.016]} />
              <meshStandardMaterial color={HEXAPOD_YELLOW} />
            </mesh>
            <group position={[segs.femur, 0, 0]}>
              {/* Tibia joint + arc (knee, rotation around Z) */}
              <mesh
                onPointerOver={(e) => {
                  e.stopPropagation();
                  onEnter("tibia");
                }}
                onPointerOut={(e) => {
                  e.stopPropagation();
                  onLeave("tibia");
                }}
              >
                <sphereGeometry args={[jointR, 16, 16]} />
                <meshStandardMaterial color={showTibia ? JOINT_HOVER_COLOR : JOINT_COLOR} />
              </mesh>
              <ServoArc
                axis="Z"
                minDeg={tibiaDef.minDeg}
                maxDeg={tibiaDef.maxDeg}
                currentDeg={tibiaDeg}
                radius={tibiaArcR}
                visible={showTibia}
                onEnter={() => onEnter("tibia")}
                onLeave={() => onLeave("tibia")}
                onAngle={(d) => setServoAngle(tibiaId, d)}
              />

              <group rotation={[0, 0, degToRad(tibiaDeg)]}>
                <mesh position={[segs.tibia / 2, 0, 0]}>
                  <boxGeometry args={[segs.tibia, 0.012, 0.012]} />
                  <meshStandardMaterial color={HEXAPOD_YELLOW} />
                </mesh>
                <mesh position={[segs.tibia, 0, 0]}>
                  <sphereGeometry args={[0.008, 12, 12]} />
                  <meshStandardMaterial color="#444" />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
