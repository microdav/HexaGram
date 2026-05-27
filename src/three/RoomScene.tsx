import { useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Group, Vector3 } from "three";
import { Hexapod } from "./Hexapod";
import { Room, ROOM_W, ROOM_D } from "./Room";
import { useHexapodStore } from "../store/useHexapodStore";
import { useSequencerStore } from "../store/useSequencerStore";
import { useProgramRunStore } from "../store/useProgramRunStore";
import { computeBodyTransform } from "../model/kinematics";
import { computeLegMounts } from "../model/hexapod";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** Durée (s) d'une image, calée sur les réglages de vitesse du séquenceur. */
function frameDurationSec(): number {
  const { transitionSpeed, stepDelay, playbackSpeed } = useSequencerStore.getState();
  const speed = playbackSpeed > 0 ? playbackSpeed : 1;
  return (transitionSpeed + stepDelay) / speed;
}

/**
 * Enveloppe le robot dans un groupe porteur d'un transform monde (translation
 * X/Z + rotation Y) intégré à partir du glissement des appuis entre images,
 * comme `GridWithScroll` (Scene.tsx) mais appliqué au robot et étendu à la
 * rotation (estimation rigide 2D des contacts persistants).
 */
function RobotInRoom() {
  const groupRef = useRef<Group>(null);
  const prevFrameIdx = useRef(-2);
  const prevContacts = useRef<Map<number, { x: number; z: number }> | null>(null);
  const velPos = useRef({ x: 0, z: 0 });
  const velYaw = useRef(0);
  const segEnd = useRef(0);
  const worldPos = useRef({ x: 0, z: 0 });
  const worldYaw = useRef(0);

  useFrame((_, delta) => {
    const { isRunning, currentFrameIndex } = useProgramRunStore.getState();

    if (!isRunning) {
      prevFrameIdx.current = -2;
      prevContacts.current = null;
      velPos.current = { x: 0, z: 0 };
      velYaw.current = 0;
      worldPos.current = { x: 0, z: 0 };
      worldYaw.current = 0;
      if (groupRef.current) {
        groupRef.current.position.set(0, 0, 0);
        groupRef.current.rotation.y = 0;
      }
      return;
    }

    const now = performance.now() / 1000;

    if (currentFrameIndex !== prevFrameIdx.current) {
      // Toute avancée autre que +1 (boucle, saut d'étape, départ) est une
      // discontinuité : on ne dérive pas de vitesse d'un téléport de pose.
      const discontinuity = currentFrameIndex !== prevFrameIdx.current + 1;
      prevFrameIdx.current = currentFrameIndex;

      const { pose, geometry, gravityEnabled } = useHexapodStore.getState();
      const mounts = computeLegMounts(geometry);
      const bt = computeBodyTransform(pose, geometry, mounts, gravityEnabled);

      const currMap = new Map<number, { x: number; z: number }>();
      for (const c of bt.contacts) {
        currMap.set(c.legIndex, { x: c.position.x, z: c.position.z });
      }

      if (prevContacts.current && !discontinuity) {
        const pairs: { px: number; pz: number; qx: number; qz: number }[] = [];
        for (const [leg, curr] of currMap) {
          const prev = prevContacts.current.get(leg);
          if (prev) pairs.push({ px: prev.x, pz: prev.z, qx: curr.x, qz: curr.z });
        }
        if (pairs.length > 0) {
          const n = pairs.length;
          let cpx = 0, cpz = 0, ccx = 0, ccz = 0;
          for (const p of pairs) { cpx += p.px; cpz += p.pz; ccx += p.qx; ccz += p.qz; }
          cpx /= n; cpz /= n; ccx /= n; ccz /= n;

          // Rotation rigide 2D apparente (prev → curr) dans le repère corps.
          let sDot = 0, sCross = 0;
          for (const p of pairs) {
            const ax = p.px - cpx, az = p.pz - cpz;
            const bx = p.qx - ccx, bz = p.qz - ccz;
            sDot += ax * bx + az * bz;
            sCross += ax * bz - az * bx;
          }
          const apparent = Math.atan2(sCross, sDot);

          // Mouvement monde du corps = inverse du mouvement apparent des appuis.
          const dYaw = -apparent;
          const vbx = -(ccx - cpx);
          const vbz = -(ccz - cpz);
          // Rotation du vecteur déplacement (repère corps → monde) autour de Y.
          const cy = Math.cos(worldYaw.current);
          const sy = Math.sin(worldYaw.current);
          const dWorldX = vbx * cy + vbz * sy;
          const dWorldZ = -vbx * sy + vbz * cy;

          const dur = Math.max(0.05, frameDurationSec());
          velPos.current = { x: dWorldX / dur, z: dWorldZ / dur };
          velYaw.current = dYaw / dur;
          segEnd.current = now + dur;
        }
      }

      prevContacts.current = currMap;
    }

    if (now < segEnd.current) {
      const margin = 0.45;
      worldPos.current.x = clamp(
        worldPos.current.x + velPos.current.x * delta,
        -ROOM_W / 2 + margin,
        ROOM_W / 2 - margin,
      );
      worldPos.current.z = clamp(
        worldPos.current.z + velPos.current.z * delta,
        -ROOM_D / 2 + margin,
        ROOM_D / 2 - margin,
      );
      worldYaw.current += velYaw.current * delta;
    }

    if (groupRef.current) {
      groupRef.current.position.x = worldPos.current.x;
      groupRef.current.position.z = worldPos.current.z;
      groupRef.current.rotation.y = worldYaw.current;
    }
  });

  return (
    <group ref={groupRef}>
      <Hexapod />
    </group>
  );
}

// Caméra fixe placée à l'INTÉRIEUR de la salle (x∈[-2.5,2.5], z∈[-4,4], y∈[0,2.5]),
// près du coin avant, en hauteur, regardant vers le centre / le fond.
// Rayons de l'ellipse d'orbite, calés sur les murs (toujours à l'intérieur).
const ORBIT_A = ROOM_W / 2 - 0.4; // axe X (< 2,5)
const ORBIT_B = ROOM_D / 2 - 0.5; // axe Z (< 4)
const CAM_LOOK = new Vector3(0, 0.35, 0);
const CAM_POS: [number, number, number] = [
  Math.cos((52 * Math.PI) / 180) * ORBIT_A,
  1.6,
  Math.sin((52 * Math.PI) / 180) * ORBIT_B,
];

/**
 * Caméra qui orbite sur une ellipse calée sur les murs (donc toujours dans la
 * pièce) en regardant le centre. L'azimut/hauteur viennent du store ; lissage
 * pour des transitions douces (boutons 90°, coins) et un drag fluide.
 */
function CameraRig() {
  const { camera } = useThree();
  const tmp = useRef(new Vector3());
  useFrame(() => {
    const { camAzimuthDeg, camHeight } = useProgramRunStore.getState();
    const th = (camAzimuthDeg * Math.PI) / 180;
    tmp.current.set(Math.cos(th) * ORBIT_A, camHeight, Math.sin(th) * ORBIT_B);
    camera.position.lerp(tmp.current, 0.2);
    camera.lookAt(CAM_LOOK);
  });
  return null;
}

export function RoomScene() {
  return (
    <Canvas
      shadows
      camera={{ position: CAM_POS, fov: 55, near: 0.05, far: 60 }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#eef1f5"]} />

      <ambientLight intensity={0.6} />
      <hemisphereLight args={["#ffffff", "#c8c2b4", 0.4]} />
      <directionalLight
        position={[-3, 4, 1.5]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={5}
        shadow-camera-bottom={-5}
        shadow-camera-near={0.1}
        shadow-camera-far={20}
      />

      <Room />
      <RobotInRoom />
      <CameraRig />
    </Canvas>
  );
}
