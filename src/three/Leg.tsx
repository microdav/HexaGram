import { useEffect, useMemo, useRef, useState } from "react";
import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import { degToRad } from "../model/servo";
import { servoIndex, type Pose } from "../model/pose";
import { mirrorLegOf, useHexapodStore } from "../store/useHexapodStore";
import { useProjectStore } from "../store/useProjectStore";
import { useToolboxStore } from "../store/useToolboxStore";
import { SERVOS, computeLegMounts, mountingOffsetOf, segmentWidthsOf, segmentHeightsOf, type HexapodGeometry, type LegMount } from "../model/hexapod";
import { findServoType } from "../model/servoTypes";
import { computeFootTip, computeBodyTransform } from "../model/kinematics";
import { solveIK } from "../model/ik";
import { ServoArc } from "./ServoArc";
import { makeTaperedBox } from "./legGeometry";

interface LegProps {
  mount: LegMount;
  /** Ensemble des segments en collision pour cette patte (0=coxa, 1=fémur, 2=tibia) */
  collidingSegs?: Set<number>;
  /**
   * Vue « salle » : patte non interactive — aucun arc de servo, aucun handler de
   * survol/drag (sinon le survol modifierait l'état d'arcs global de la Conception).
   */
  clean?: boolean;
  /** Pose en remplacement de la pose globale (affichage au repos dans la salle). */
  pose?: Pose | null;
}

const HEXAPOD_YELLOW = "#f5c518";
const COLLISION_RED = "#ef4444";
const JOINT_COLOR = "#222";
const JOINT_HOVER_COLOR = "#7ab8ff";
const SERVO_CASE = "#1b1b1b";

/** Dimensions du boîtier servo (m) + décalage de l'axe de sortie (le « 2/3 »). */
interface ServoDimsM {
  l: number;
  w: number;
  h: number;
  shaft: number;
}

/**
 * Corps de servo représenté par une boîte rectangulaire, **fixée au segment
 * parent**, dont l'axe de sortie (pignon) coïncide avec le pivot de
 * l'articulation à l'origine du groupe. Le boîtier est décalé en arrière du
 * pivot de `shaft` (le pignon n'est pas centré : ~2/3 de la longueur, comme un
 * servo hobby standard). `axis` = sens de l'arbre de sortie :
 *  - "Y" : coxa (pivot vertical) — boîtier couché sous le plan du pivot ;
 *  - "Z" : fémur/tibia (pivot horizontal latéral) — arbre le long de Z.
 */
function ServoBody({ axis, dims }: { axis: "Y" | "Z"; dims: ServoDimsM }) {
  const { l, w, h, shaft } = dims;
  if (axis === "Y") {
    // Arbre vertical : faces L×W horizontales, hauteur H sous le pivot.
    return (
      <mesh position={[-shaft, -h / 2, 0]}>
        <boxGeometry args={[l, h, w]} />
        <meshStandardMaterial color={SERVO_CASE} />
      </mesh>
    );
  }
  // Arbre latéral (Z) : longueur L le long du segment, épaisseur verticale W,
  // profondeur H le long de l'arbre ; pignon décalé sur la face +Z.
  return (
    <mesh position={[-shaft, 0, -h / 2]}>
      <boxGeometry args={[l, w, h]} />
      <meshStandardMaterial color={SERVO_CASE} />
    </mesh>
  );
}

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

export function Leg({ mount, collidingSegs, clean = false, pose: poseOverride = null }: LegProps) {
  const globalPose = useHexapodStore((s) => s.pose);
  const pose = poseOverride ?? globalPose;
  const segs = useHexapodStore((s) => s.geometry.segments);
  // Épaisseur (vue de dessus) de cette patte → profondeur Z des segments 3D
  // (pièces plates type MDF). Abonné au tableau brut pour rester stable.
  const segmentWidths = useHexapodStore((s) => s.geometry.segmentWidths);
  const segW = useMemo(
    () => segmentWidthsOf({ segmentWidths } as HexapodGeometry, mount.index),
    [segmentWidths, mount.index]
  );
  // Hauteur de profil (vue de face) → hauteur Y des segments 3D.
  const segmentHeights = useHexapodStore((s) => s.geometry.segmentHeights);
  const chassisH = useHexapodStore((s) => s.geometry.chassis.height);
  const servoTypeId = useProjectStore((s) => s.activeProject?.hardware.servoTypeId);
  const customServoTypes = useProjectStore((s) => s.activeProject?.hardware.customServoTypes);
  const segH = useMemo(() => {
    const sh = segmentHeightsOf({ segmentHeights } as HexapodGeometry, mount.index);
    const spec = findServoType(servoTypeId, customServoTypes ?? []);
    const servoHm = (spec?.dimensionsMm.h ?? 38) / 1000;
    const servoWm = (spec?.dimensionsMm.w ?? 20) / 1000;
    const rawKnee = Array.isArray(segmentHeights) ? segmentHeights[mount.index]?.tibia : undefined;
    return {
      coxa: Math.min(chassisH, Math.max(servoHm, sh.coxa)), // bornée [servo, châssis]
      femur: sh.femur,
      tibiaKnee: rawKnee ?? servoWm, // défaut genou = largeur servo
      tibiaFoot: sh.tibiaFoot,
    };
  }, [segmentHeights, mount.index, chassisH, servoTypeId, customServoTypes]);
  // Dimensions du boîtier servo (m) issues du catalogue (corps + axe au 2/3).
  const servoDimsM = useMemo<ServoDimsM>(() => {
    const spec = findServoType(servoTypeId, customServoTypes ?? []);
    const l = (spec?.dimensionsMm.l ?? 40.7) / 1000;
    const w = (spec?.dimensionsMm.w ?? 20.1) / 1000;
    const h = (spec?.dimensionsMm.h ?? 37.8) / 1000;
    const shaft = (spec?.shaftOffsetMm ?? (spec ? spec.dimensionsMm.l / 2 - 10 : 10)) / 1000;
    return { l, w, h, shaft };
  }, [servoTypeId, customServoTypes]);
  const tibiaGeo = useMemo(
    () => makeTaperedBox(segs.tibia, segW.tibia, segH.tibiaKnee, segH.tibiaFoot),
    [segs.tibia, segW.tibia, segH.tibiaKnee, segH.tibiaFoot]
  );
  useEffect(() => () => tibiaGeo.dispose(), [tibiaGeo]);
  const setServoAngle = useHexapodStore((s) => s.setServoAngle);
  const arcShownMask = useHexapodStore((s) => s.arcShownMask);
  const mirrorEnabled = useHexapodStore((s) => s.mirrorEnabled);
  const setArcShown = useHexapodStore((s) => s.setArcShown);
  const tabletMode = useToolboxStore((s) => s.tabletMode);
  const setTabletServoEdit = useToolboxStore((s) => s.setTabletServoEdit);
  const tabletEditId = useToolboxStore((s) => s.tabletServoEdit?.servoId ?? null);

  const { camera, gl } = useThree();

  const coxaId = servoIndex(mount.index, "coxa");
  const femurId = servoIndex(mount.index, "femur");
  const tibiaId = servoIndex(mount.index, "tibia");

  const coxaDeg = pose[coxaId];
  const femurDeg = pose[femurId];
  const tibiaDeg = pose[tibiaId];

  // Offset de montage (deg) par articulation : rotation statique entre le repère
  // servo (pose) et la géométrie 3D. Le segment + l'arc sont rendus dans ce repère
  // décalé, la rotation dynamique restant la valeur de pose (0 = centre servo).
  const mountingOffsets = useHexapodStore((s) => s.geometry.mountingOffsetsDeg);
  const coxaOff = mountingOffsetOf({ mountingOffsetsDeg: mountingOffsets } as HexapodGeometry, coxaId);
  const femurOff = mountingOffsetOf({ mountingOffsetsDeg: mountingOffsets } as HexapodGeometry, femurId);
  const tibiaOff = mountingOffsetOf({ mountingOffsetsDeg: mountingOffsets } as HexapodGeometry, tibiaId);

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
    // Le survol ne révèle PLUS l'arc : l'affichage se fait au clic (toggle), cf.
    // onJointClick/onTap. On garde le suivi des compteurs/timers pour que le
    // masquage d'un arc épinglé ne se déclenche pas par erreur.
    const st = useHexapodStore.getState();
    if (st.footDragging || st.cogDragging) return;
    counts.current[k] += 1;
    const t = timers.current[k];
    if (t != null) {
      window.clearTimeout(t);
      timers.current[k] = null;
    }
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

  // Mode tablette : la « sélection » d'une articulation = le popover ouvert
  // pour ce servo (cf. visibleFor, qui allume l'arc tant qu'il est ouvert).
  // Taper le même joint, ou fermer le popover, le désélectionne — pas
  // d'épinglage persistant ici.
  const onJointClick = (k: JointKey, e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (tabletMode) {
      const id = servoIdOf(k);
      const cur = useToolboxStore.getState().tabletServoEdit;
      if (cur?.servoId === id) {
        setTabletServoEdit(null);
        setArcShown(id, false);
      } else {
        setTabletServoEdit({ servoId: id, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
      }
    } else {
      // PC (et tactile hors mode tablette) : le clic bascule l'affichage de l'arc.
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
    if ((arcShownMask >>> ownId) & 1) return true;
    // Mode tablette : l'arc reste visible tant que son popover est ouvert.
    if (tabletMode && tabletEditId === ownId) return true;
    if (!mirrorEnabled) return false;
    const mirrorId = servoIndex(mirrorLeg, k);
    if ((arcShownMask >>> mirrorId) & 1) return true;
    if (tabletMode && tabletEditId === mirrorId) return true;
    return false;
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

      // Solve IK (angles géométriques) puis repasse en repère servo (pose) en
      // retranchant l'offset de montage avant d'écrire (setServoAngle clampe ±90°).
      const { geometry: geom } = useHexapodStore.getState();
      const angles = solveIK(mount, targetLocal, geom);

      const s = useHexapodStore.getState();
      s.setServoAngle(coxaId, angles.coxaDeg - mountingOffsetOf(geom, coxaId));
      s.setServoAngle(femurId, angles.femurDeg - mountingOffsetOf(geom, femurId));
      s.setServoAngle(tibiaId, angles.tibiaDeg - mountingOffsetOf(geom, tibiaId));
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

  // En vue salle (`clean`), la patte est purement décorative : pas de handlers
  // (sinon mutation de l'état d'arcs global) ni d'arcs de servo.
  const jointHandlers = (k: JointKey) =>
    clean
      ? {}
      : {
          onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onEnter(k); },
          onPointerOut: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onLeave(k); },
          onPointerDown: (e: ThreeEvent<PointerEvent>) => { lastPointerType.current = e.pointerType; },
          onClick: (e: ThreeEvent<MouseEvent>) => onJointClick(k, e),
        };
  const footHandlers = clean
    ? {}
    : {
        onPointerOver: onFootPointerOver,
        onPointerOut: onFootPointerOut,
        onPointerDown: onFootPointerDown,
      };
  const jointColor = (show: boolean) => (!clean && show ? JOINT_HOVER_COLOR : JOINT_COLOR);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <group position={mount.position} rotation={[0, degToRad(mount.yawDeg), 0]}>
      {/* Coxa joint + arc (rotation around Y) */}
      <mesh {...jointHandlers("coxa")}>
        <sphereGeometry args={[jointR, 16, 16]} />
        <meshStandardMaterial color={jointColor(showCoxa)} />
      </mesh>
      {!clean && (
        <group rotation={[0, degToRad(coxaOff), 0]}>
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
        </group>
      )}

      {/* Boîtier servo coxa (fixé au châssis, arbre vertical au pivot) */}
      <ServoBody axis="Y" dims={servoDimsM} />

      <group rotation={[0, degToRad(coxaOff + coxaDeg), 0]}>
        <mesh position={[segs.coxa / 2, 0, 0]}>
          <boxGeometry args={[segs.coxa, segH.coxa, segW.coxa]} />
          <meshStandardMaterial color={coxaColor} emissive={collidingSegs?.has(0) ? "#7f1d1d" : "#000"} emissiveIntensity={collidingSegs?.has(0) ? 0.4 : 0} />
        </mesh>
        <group position={[segs.coxa, 0, 0]}>
          {/* Femur joint + arc (rotation around Z) */}
          <mesh {...jointHandlers("femur")}>
            <sphereGeometry args={[jointR, 16, 16]} />
            <meshStandardMaterial color={jointColor(showFemur)} />
          </mesh>
          {!clean && (
            <group rotation={[0, 0, degToRad(femurOff)]}>
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
            </group>
          )}

          {/* Boîtier servo fémur (fixé à la coxa, arbre latéral au genou-hanche) */}
          <ServoBody axis="Z" dims={servoDimsM} />

          <group rotation={[0, 0, degToRad(femurOff + femurDeg)]}>
            <mesh position={[segs.femur / 2, 0, 0]}>
              <boxGeometry args={[segs.femur, segH.femur, segW.femur]} />
              <meshStandardMaterial color={femurColor} emissive={collidingSegs?.has(1) ? "#7f1d1d" : "#000"} emissiveIntensity={collidingSegs?.has(1) ? 0.4 : 0} />
            </mesh>
            <group position={[segs.femur, 0, 0]}>
              {/* Tibia joint + arc (knee, rotation around Z) */}
              <mesh {...jointHandlers("tibia")}>
                <sphereGeometry args={[jointR, 16, 16]} />
                <meshStandardMaterial color={jointColor(showTibia)} />
              </mesh>
              {!clean && (
                <group rotation={[0, 0, degToRad(tibiaOff)]}>
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
                </group>
              )}

              {/* Boîtier servo tibia (fixé au fémur, arbre latéral au genou) */}
              <ServoBody axis="Z" dims={servoDimsM} />

              <group rotation={[0, 0, degToRad(tibiaOff + tibiaDeg)]}>
                {/* Tibia conique : genou → pied (geometry x ∈ [0, tibia]). */}
                <mesh position={[0, 0, 0]} geometry={tibiaGeo}>
                  <meshStandardMaterial color={tibiaColor} emissive={collidingSegs?.has(2) ? "#7f1d1d" : "#000"} emissiveIntensity={collidingSegs?.has(2) ? 0.4 : 0} />
                </mesh>
                {/* Foot tip — draggable */}
                <mesh position={[segs.tibia, 0, 0]} {...footHandlers}>
                  <sphereGeometry args={[footR, 12, 12]} />
                  <meshStandardMaterial color={clean ? FOOT_NORMAL : footColor} />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
