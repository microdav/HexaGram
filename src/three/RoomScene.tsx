import { useRef } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Group, Vector3, Vector2, Raycaster, Plane } from "three";
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

// Apparition du robot : délai avant la chute, hauteur et durée.
const DROP_DELAY = 1.0; // s après l'apparition de la scène
const DROP_HEIGHT = 2.2;
const DROP_DUR = 0.7;

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
  const { camera, gl } = useThree();
  const isRunningSub = useProgramRunStore((s) => s.isRunning);
  const restPose = useProgramRunStore((s) => s.restPose);
  const groupRef = useRef<Group>(null);
  const prevFrameIdx = useRef(-2);
  const prevContacts = useRef<Map<number, { x: number; z: number }> | null>(null);
  const velPos = useRef({ x: 0, z: 0 });
  const velYaw = useRef(0);
  const segEnd = useRef(0);
  const worldPos = useRef({ x: 0, z: 0 });
  const worldYaw = useRef(0);
  // Animation d'apparition : le robot "tombe" à la verticale jusqu'au sol.
  const mountStart = useRef<number | null>(null);
  const dropStart = useRef<number | null>(null);
  const dropped = useRef(false);

  // Drag du robot pour fixer sa position de départ (à l'arrêt uniquement).
  const onRobotPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (useProgramRunStore.getState().isRunning) return;
    e.stopPropagation();
    useProgramRunStore.getState().setDraggingRobot(true);
    gl.domElement.style.cursor = "grabbing";
    const ray = new Raycaster();
    const ndc = new Vector2();
    const ground = new Plane(new Vector3(0, 1, 0), 0);
    const hit = new Vector3();
    const move = (ev: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      if (ray.ray.intersectPlane(ground, hit)) {
        useProgramRunStore.getState().setStartPos(hit.x, hit.z);
      }
    };
    const up = () => {
      useProgramRunStore.getState().setDraggingRobot(false);
      gl.domElement.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  useFrame((_, delta) => {
    const { isRunning, currentFrameIndex, startX, startZ, restPose } = useProgramRunStore.getState();

    if (!isRunning) {
      // Réinit de la locomotion ; le robot se tient à sa position de départ.
      prevFrameIdx.current = -2;
      prevContacts.current = null;
      velPos.current = { x: 0, z: 0 };
      velYaw.current = 0;
      worldPos.current = { x: startX, z: startZ };
      worldYaw.current = 0;

      const g = groupRef.current;
      if (restPose == null) {
        // Init pas encore connue : robot masqué, prêt à "tomber" quand elle arrive.
        dropped.current = false;
        dropStart.current = null;
        mountStart.current = null;
        if (g) g.visible = false;
        return;
      }
      // Init connue : on attend DROP_DELAY après l'apparition, puis chute verticale.
      const now = performance.now() / 1000;
      if (mountStart.current == null) mountStart.current = now;
      let y = 0;
      let show = true;
      if (!dropped.current) {
        const fallAt = mountStart.current + DROP_DELAY;
        if (now < fallAt) {
          show = false; // délai : robot encore masqué
        } else {
          if (dropStart.current == null) dropStart.current = fallAt;
          const t = Math.min(1, (now - dropStart.current) / DROP_DUR);
          y = DROP_HEIGHT * (1 - t * t); // chute accélérée
          if (t >= 1) { y = 0; dropped.current = true; }
        }
      }
      if (g) {
        g.visible = show;
        g.position.set(startX, y, startZ);
        g.rotation.y = 0;
      }
      return;
    }

    // En lecture : robot visible, animation de chute considérée comme consommée.
    if (groupRef.current) groupRef.current.visible = true;
    dropped.current = true;

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
      {/* Au repos : pose Init du programme ; en lecture : pose globale animée. */}
      <Hexapod clean pose={isRunningSub ? undefined : restPose} />

      {/* Repère de départ + poignée de drag (à l'arrêt seulement) */}
      {!isRunningSub && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
            <ringGeometry args={[0.16, 0.19, 40]} />
            <meshBasicMaterial color="#f5c518" transparent opacity={0.55} />
          </mesh>
          {/* Cible invisible : clic + glisser pour déplacer le point de départ */}
          <mesh
            position={[0, 0.12, 0]}
            onPointerDown={onRobotPointerDown}
            onPointerOver={() => { gl.domElement.style.cursor = "grab"; }}
            onPointerOut={() => { gl.domElement.style.cursor = ""; }}
          >
            <boxGeometry args={[0.5, 0.28, 0.36]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

// Caméra fixe placée à l'INTÉRIEUR de la salle (x∈[-2.5,2.5], z∈[-4,4], y∈[0,2.5]),
// près du coin avant, en hauteur, regardant vers le centre / le fond.
// Rayons de l'ellipse d'orbite, calés sur les murs (toujours à l'intérieur, et
// en deçà du bureau placé contre le mur avant z=+4).
const ORBIT_A = ROOM_W / 2 - 0.5; // axe X (= 2,0)
const ORBIT_B = ROOM_D / 2 - 0.8; // axe Z (= 3,2)
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
