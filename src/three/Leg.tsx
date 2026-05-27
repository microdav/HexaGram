import { useEffect, useRef, useState } from "react";
import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { degToRad } from "../model/servo";
import { servoIndex } from "../model/pose";
import { mirrorLegOf, useHexapodStore } from "../store/useHexapodStore";
import { useToolboxStore } from "../store/useToolboxStore";
import { SERVOS, computeLegMounts, type LegMount } from "../model/hexapod";
import { computeFootTip, computeBodyTransform } from "../model/kinematics";
import { solveIK } from "../model/ik";
import { ServoArc } from "./ServoArc";

interface LegProps {
  mount: LegMount;
  /** Ensemble des segments en collision pour cette patte (0=coxa, 1=fémur, 2=tibia) */
  collidingSegs?: Set<number>;
}

const HEXAPOD_YELLOW = "#f5c518";
const COLLISION_RED = "#ef4444";
const JOINT_COLOR = "#222";
const JOINT_HOVER_COLOR = "#7ab8ff";

const FOOT_NORMAL = "#888";
const FOOT_HOVER  = "#f5c518";
const FOOT_DRAG   = "#4ade80";

type JointKey = "coxa" | "femur" | "tibia";
const JOINT_KEYS: JointKey[] = ["coxa", "femur", "tibia"];

// Drag state captured at pointer-down — held in a ref so closure reads are stable.
interface DragStart {
  clientX: number;
  clientY: number;
  footLocal: Vector3; // foot position in chassis-local frame at drag start
  bodyPos: Vector3;   // body world position at drag start
  bodyQuat: Quaternion; // body world quaternion at drag start
}

export function Leg({ mount, collidingSegs }: LegProps) {
  const pose = useHexapodStore((s) => s.pose);
  const segs = useHexapodStore((s) => s.geometry.segments);
  const setServoAngle = useHexapodStore((s) => s.setServoAngle);
  const arcShownMask = useHexapodStore((s) => s.arcShownMask);
  const mirrorEnabled = useHexapodStore((s) => s.mirrorEnabled);
  const setArcShown = useHexapodStore((s) => s.setArcShown);
  const tabletMode = useToolboxStore((s) => s.tabletMode);
  const setTabletServoEdit = useToolboxStore((s) => s.setTabletServoEdit);

  const { camera, gl } = useThree();

  const coxaId = servoIndex(mount.index, "coxa");
  const femurId = servoIndex(mount.index, "femur");
  const tibiaId = servoIndex(mount.index, "tibia");

  const coxaDeg = pose[coxaId];
  const femurDeg = pose[femurId];
  const tibiaDeg = pose[tibiaId];

  const coxaDef = SERVOS[coxaId];
  const femurDef = SERVOS[femurId];
  const tibiaDef = SERVOS[tibiaId];

  // ── Joint arc hover/pin state ────────────────────────────────────────────
  const counts = useRef<Record<JointKey, number>>({ coxa: 0, femur: 0, tibia: 0 });
  const timers = useRef<Record<JointKey, number | null>>({
    coxa: null,
    femur: null,
    tibia: null,
  });
  const pinnedJoints = useRef<Set<JointKey>>(new Set());
  const lastPointerType = useRef<string>("mouse");
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
    if (counts.current[k] === 0 && !pinnedJoints.current.has(k)) {
      const t = timers.current[k];
      if (t != null) window.clearTimeout(t);
      timers.current[k] = window.setTimeout(() => {
        if (counts.current[k] === 0 && !pinnedJoints.current.has(k)) {
          setArcShown(servoIdOf(k), false);
        }
        timers.current[k] = null;
      }, 200);
    }
  };

  // Mode tablette : un tap sur l'articulation ouvre le popover de réglage
  // (ancré au point touché) et épingle l'arc pour le retour visuel.
  const onJointClick = (k: JointKey, e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (tabletMode) {
      const id = servoIdOf(k);
      pinnedJoints.current.add(k);
      setArcShown(id, true);
      setTabletServoEdit({ servoId: id, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
    } else if (lastPointerType.current === "touch") {
      onTap(k);
    }
  };

  const onTap = (k: JointKey) => {
    const id = servoIdOf(k);
    const t = timers.current[k];
    if (pinnedJoints.current.has(k)) {
      pinnedJoints.current.delete(k);
      if (counts.current[k] === 0) {
        if (t != null) { window.clearTimeout(t); timers.current[k] = null; }
        setArcShown(id, false);
      }
    } else {
      pinnedJoints.current.add(k);
      if (t != null) { window.clearTimeout(t); timers.current[k] = null; }
      setArcShown(id, true);
    }
  };

  useEffect(() => {
    const localTimers = timers.current;
    const localPinned = pinnedJoints.current;
    const myServoIds = JOINT_KEYS.map((k) => servoIndex(mount.index, k));
    return () => {
      JOINT_KEYS.forEach((k) => {
        const t = localTimers[k];
        if (t != null) window.clearTimeout(t);
      });
      localPinned.clear();
      myServoIds.forEach((id) => setArcShown(id, false));
    };
  }, [mount.index, setArcShown]);

  // ── Mirror visibility ────────────────────────────────────────────────────
  const mirrorLeg = mirrorLegOf(mount.index);
  const visibleFor = (k: JointKey): boolean => {
    const ownId = servoIdOf(k);
    const ownBit = (arcShownMask >>> ownId) & 1;
    if (ownBit) return true;
    if (!mirrorEnabled) return false;
    const mirrorId = servoIndex(mirrorLeg, k);
    return ((arcShownMask >>> mirrorId) & 1) === 1;
  };

  const showCoxa  = visibleFor("coxa");
  const showFemur = visibleFor("femur");
  const showTibia = visibleFor("tibia");

  // Articulations agrandies en mode tablette pour être tapables au doigt.
  const jointR    = tabletMode ? 0.02 : 0.012;
  const footR     = tabletMode ? 0.02 : 0.012;
  const coxaArcR  = Math.max(0.035, segs.coxa * 0.85);
  const femurArcR = Math.max(0.045, segs.femur * 0.55);
  const tibiaArcR = Math.max(0.05, segs.tibia * 0.45);

  // ── Foot drag ────────────────────────────────────────────────────────────
  const [footState, setFootState] = useState<"normal" | "hover" | "drag">("normal");
  const footHovered  = useRef(false);
  const isDragging   = useRef(false);
  const dragStart    = useRef<DragStart | null>(null);

  const onFootPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    footHovered.current = true;
    if (!isDragging.current) setFootState("hover");
    gl.domElement.style.cursor = "grab";
  };

  const onFootPointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    footHovered.current = false;
    if (!isDragging.current) {
      setFootState("normal");
      gl.domElement.style.cursor = "";
    }
  };

  const onFootPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();

    // Snapshot state at drag start.
    const st = useHexapodStore.getState();
    const { geometry, pose: currentPose, gravityEnabled } = st;
    const mounts = computeLegMounts(geometry);
    const transform = computeBodyTransform(currentPose, geometry, mounts, gravityEnabled);

    dragStart.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      footLocal: computeFootTip(mount, currentPose, geometry).clone(),
      bodyPos: transform.position.clone(),
      bodyQuat: transform.quaternion.clone(),
    };

    isDragging.current = true;
    setFootState("drag");
    useHexapodStore.getState().setFootDragging(true);
    gl.domElement.style.cursor = "grabbing";

    const handleMove = (me: PointerEvent) => {
      const ds = dragStart.current;
      if (!ds) return;

      // Scale: world units per screen pixel at the camera's current distance.
      const cam = camera as PerspectiveCamera;
      const dist = Math.max(0.05, camera.position.length());
      const scale =
        (2 * Math.tan(((cam.fov ?? 45) / 2) * (Math.PI / 180)) * dist) /
        gl.domElement.clientHeight;

      // Camera axes projected to world space.
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up    = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);

      const dScreenX = me.clientX - ds.clientX;
      const dScreenY = me.clientY - ds.clientY;

      // World-space movement delta.
      const dWorld = right.clone().multiplyScalar(dScreenX * scale)
        .add(up.clone().multiplyScalar(-dScreenY * scale));

      // Foot world position at drag start, shifted by current screen delta.
      const footWorldStart = ds.footLocal.clone()
        .applyQuaternion(ds.bodyQuat)
        .add(ds.bodyPos);

      const worldTarget = footWorldStart.add(dWorld);
      // Floor constraint: foot cannot go below y = 0 in world space.
      worldTarget.y = Math.max(0, worldTarget.y);

      // Convert world target → chassis-local frame.
      const invQuat = ds.bodyQuat.clone().conjugate();
      const targetLocal = worldTarget.clone()
        .sub(ds.bodyPos)
        .applyQuaternion(invQuat);

      // Solve IK and push servo angles (setServoAngle clamps to ±90°).
      const { geometry: geom } = useHexapodStore.getState();
      const angles = solveIK(mount, targetLocal, geom);

      const s = useHexapodStore.getState();
      s.setServoAngle(coxaId, angles.coxaDeg);
      s.setServoAngle(femurId, angles.femurDeg);
      s.setServoAngle(tibiaId, angles.tibiaDeg);
    };

    const handleUp = () => {
      dragStart.current = null;
      isDragging.current = false;
      setFootState(footHovered.current ? "hover" : "normal");
      gl.domElement.style.cursor = footHovered.current ? "grab" : "";
      useHexapodStore.getState().setFootDragging(false);
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  };

  const footColor =
    footState === "drag"  ? FOOT_DRAG :
    footState === "hover" ? FOOT_HOVER :
    FOOT_NORMAL;

  const coxaColor  = collidingSegs?.has(0) ? COLLISION_RED : HEXAPOD_YELLOW;
  const femurColor = collidingSegs?.has(1) ? COLLISION_RED : HEXAPOD_YELLOW;
  const tibiaColor = collidingSegs?.has(2) ? COLLISION_RED : HEXAPOD_YELLOW;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <group position={mount.position} rotation={[0, degToRad(mount.yawDeg), 0]}>
      {/* Coxa joint + arc (rotation around Y) */}
      <mesh
        onPointerOver={(e) => { e.stopPropagation(); onEnter("coxa"); }}
        onPointerOut={(e)  => { e.stopPropagation(); onLeave("coxa"); }}
        onPointerDown={(e) => { lastPointerType.current = e.pointerType; }}
        onClick={(e) => onJointClick("coxa", e)}
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
          <meshStandardMaterial color={coxaColor} emissive={collidingSegs?.has(0) ? "#7f1d1d" : "#000"} emissiveIntensity={collidingSegs?.has(0) ? 0.4 : 0} />
        </mesh>
        <group position={[segs.coxa, 0, 0]}>
          {/* Femur joint + arc (rotation around Z) */}
          <mesh
            onPointerOver={(e) => { e.stopPropagation(); onEnter("femur"); }}
            onPointerOut={(e)  => { e.stopPropagation(); onLeave("femur"); }}
            onPointerDown={(e) => { lastPointerType.current = e.pointerType; }}
            onClick={(e) => onJointClick("femur", e)}
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
              <meshStandardMaterial color={femurColor} emissive={collidingSegs?.has(1) ? "#7f1d1d" : "#000"} emissiveIntensity={collidingSegs?.has(1) ? 0.4 : 0} />
            </mesh>
            <group position={[segs.femur, 0, 0]}>
              {/* Tibia joint + arc (knee, rotation around Z) */}
              <mesh
                onPointerOver={(e) => { e.stopPropagation(); onEnter("tibia"); }}
                onPointerOut={(e)  => { e.stopPropagation(); onLeave("tibia"); }}
                onPointerDown={(e) => { lastPointerType.current = e.pointerType; }}
                onClick={(e) => onJointClick("tibia", e)}
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
                  <meshStandardMaterial color={tibiaColor} emissive={collidingSegs?.has(2) ? "#7f1d1d" : "#000"} emissiveIntensity={collidingSegs?.has(2) ? 0.4 : 0} />
                </mesh>
                {/* Foot tip — draggable */}
                <mesh
                  position={[segs.tibia, 0, 0]}
                  onPointerOver={onFootPointerOver}
                  onPointerOut={onFootPointerOut}
                  onPointerDown={onFootPointerDown}
                >
                  <sphereGeometry args={[footR, 12, 12]} />
                  <meshStandardMaterial color={footColor} />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
