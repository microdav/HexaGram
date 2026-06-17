import { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewcube, Grid, OrbitControls } from "@react-three/drei";
import type { Group } from "three";
import { Hexapod } from "./Hexapod";
import { Compass } from "./Compass";
import { StepInfoPanel } from "./StepInfoPanel";
import { PoseInfoPanel } from "./PoseInfoPanel";
import { ServoDetailPanel } from "./ServoDetailPanel";
import { HeightRuler } from "../ui/HeightRuler";
import { useHexapodStore } from "../store/useHexapodStore";
import { useCollisions } from "../store/useCollisions";
import { useSequencerStore } from "../store/useSequencerStore";
import { computeBodyTransform } from "../model/kinematics";
import { computeLegMounts } from "../model/hexapod";

const CAM_KEY = "hexagram.camera";

/**
 * Grid that scrolls during sequencer playback to give the illusion of locomotion.
 * Motion is derived from how contact foot positions shift between consecutive steps:
 * a stance foot appearing to move backward in body-local space means the body moved forward.
 */
function GridWithScroll() {
  const scrollRef = useRef<Group>(null);
  const prevStepIdx = useRef(-1);
  const prevContacts = useRef<Map<number, { x: number; z: number }> | null>(null);
  const velocity = useRef({ x: 0, z: 0 });
  const stepEndTime = useRef(0);
  // True accumulated offset kept in memory; only the modulo is applied to the mesh
  // so the Grid never drifts far from origin and avoids frustum culling on camera rotate.
  const totalOffset = useRef({ x: 0, z: 0 });

  useFrame((_, delta) => {
    const { isPlaying, currentStepIndex, transitionSpeed, stepDelay } =
      useSequencerStore.getState();

    if (!isPlaying) {
      prevStepIdx.current = -1;
      prevContacts.current = null;
      velocity.current = { x: 0, z: 0 };
      totalOffset.current = { x: 0, z: 0 };
      if (scrollRef.current) {
        scrollRef.current.position.x = 0;
        scrollRef.current.position.z = 0;
      }
      return;
    }

    const now = performance.now() / 1000;

    if (currentStepIndex !== prevStepIdx.current) {
      prevStepIdx.current = currentStepIndex;

      const { pose, geometry, gravityEnabled } = useHexapodStore.getState();
      const mounts = computeLegMounts(geometry);
      const bt = computeBodyTransform(pose, geometry, mounts, gravityEnabled);

      // Build contact map for this step: legIndex → XZ position
      const currentMap = new Map<number, { x: number; z: number }>();
      for (const c of bt.contacts) {
        currentMap.set(c.legIndex, { x: c.position.x, z: c.position.z });
      }

      if (prevContacts.current !== null) {
        // Persistent contacts (same leg in both steps) reveal body displacement:
        // if a stance foot appears to drift backward, the robot moved forward.
        let sumDx = 0, sumDz = 0, count = 0;
        for (const [leg, curr] of currentMap) {
          const prev = prevContacts.current.get(leg);
          if (prev) {
            sumDx += curr.x - prev.x;
            sumDz += curr.z - prev.z;
            count++;
          }
        }
        if (count > 0) {
          const dur = Math.max(0.05, transitionSpeed + stepDelay);
          velocity.current = { x: sumDx / count / dur, z: sumDz / count / dur };
          stepEndTime.current = now + dur;
        }
      }

      prevContacts.current = currentMap;
    }

    if (scrollRef.current && now < stepEndTime.current) {
      totalOffset.current.x += velocity.current.x * delta;
      totalOffset.current.z += velocity.current.z * delta;
      // Wrap to [0, sectionSize) so the mesh stays near origin — grid is periodic
      // at sectionSize intervals so the visual appearance is seamless.
      const s = 0.1;
      const mod = (v: number) => ((v % s) + s) % s;
      scrollRef.current.position.x = mod(totalOffset.current.x);
      scrollRef.current.position.z = mod(totalOffset.current.z);
    }
  });

  return (
    <group position={[0, -0.001, 0]}>
      <group ref={scrollRef}>
        <Grid
          args={[2, 2]}
          cellSize={0.01}
          cellThickness={0.8}
          cellColor="#39414f"
          sectionSize={0.1}
          sectionThickness={1.4}
          sectionColor="#5b6679"
          fadeDistance={1.6}
          fadeStrength={1}
          infiniteGrid
        />
      </group>
    </group>
  );
}

type SavedCamera = {
  position: [number, number, number];
  target: [number, number, number];
};

function readSavedCamera(): SavedCamera | null {
  try {
    const raw = localStorage.getItem(CAM_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedCamera;
  } catch { return null; }
}

function CameraTracker() {
  const { camera, controls } = useThree();
  const setCameraDirection = useHexapodStore((s) => s.setCameraDirection);
  const compassLocked = useHexapodStore((s) => s.compassLocked);
  const last = useRef<[number, number, number]>([0, 0, 0]);
  const restored = useRef(false);
  const lastSaveTime = useRef(0);
  const lastSavedPos = useRef("");

  useFrame(() => {
    // Restore OrbitControls target on first frame once controls are ready
    if (!restored.current && controls) {
      restored.current = true;
      const saved = readSavedCamera();
      if (saved) {
        const orb = controls as { target?: { set: (x: number, y: number, z: number) => void }; update?: () => void };
        orb.target?.set(...saved.target);
        orb.update?.();
      }
    }

    // Compass direction tracking
    if (!compassLocked) {
      const x = camera.position.x;
      const y = camera.position.y;
      const z = camera.position.z;
      const m = Math.sqrt(x * x + y * y + z * z);
      if (m >= 1e-4) {
        const dx = x / m, dy = y / m, dz = z / m;
        if (
          Math.abs(dx - last.current[0]) > 1e-3 ||
          Math.abs(dy - last.current[1]) > 1e-3 ||
          Math.abs(dz - last.current[2]) > 1e-3
        ) {
          last.current = [dx, dy, dz];
          setCameraDirection([dx, dy, dz]);
        }
      }
    }

    // Throttled camera persistence (every 500 ms when position changes)
    const now = performance.now();
    if (now - lastSaveTime.current < 500) return;
    const posKey = `${camera.position.x.toFixed(3)},${camera.position.y.toFixed(3)},${camera.position.z.toFixed(3)}`;
    if (posKey === lastSavedPos.current) return;
    lastSavedPos.current = posKey;
    lastSaveTime.current = now;
    try {
      const orb = controls as { target?: { x: number; y: number; z: number } } | null;
      const t = orb?.target ?? { x: 0, y: 0, z: 0 };
      localStorage.setItem(CAM_KEY, JSON.stringify({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [t.x, t.y, t.z],
      }));
    } catch {}
  });

  return null;
}

const DEFAULT_CAM_POS: [number, number, number] = [0.55, 0.4, 0.55];

function CollisionBanner() {
  const collisions = useCollisions();
  if (!collisions.hasCollision) return null;
  return (
    <div className="collision-banner">
      <span className="collision-banner-icon">▼</span>
      <span>Collision détectée</span>
    </div>
  );
}

export function Scene() {
  // Untyped: drei's OrbitControls ref shape is OrbitControlsImpl from three-stdlib;
  // we only need .reset() so we keep it loose.
  const controlsRef = useRef<{ reset: () => void } | null>(null);
  const arcInteracting = useHexapodStore((s) => s.arcShownMask !== 0);
  const cogDragging = useHexapodStore((s) => s.cogDragging);
  const footDragging = useHexapodStore((s) => s.footDragging);
  const bodyHeightDragging = useHexapodStore((s) => s.bodyHeightDragging);
  const chassisSelected = useHexapodStore((s) => s.chassisSelected);

  const onHome = () => controlsRef.current?.reset();

  // Échap désélectionne le châssis (referme poignée + règle de hauteur).
  useEffect(() => {
    if (!chassisSelected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useHexapodStore.getState().setChassisSelected(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chassisSelected]);

  const initCamPos = readSavedCamera()?.position ?? DEFAULT_CAM_POS;

  return (
    <div className="viewer-inner">
      <CollisionBanner />
      <Canvas
        shadows
        camera={{ position: initCamPos, fov: 45, near: 0.01, far: 50 }}
        dpr={[1, 2]}
        onPointerMissed={() => useHexapodStore.getState().setChassisSelected(false)}
      >
        <color attach="background" args={["#15171c"]} />

        <ambientLight intensity={0.45} />
        <directionalLight
          position={[2, 3, 2]}
          intensity={1.0}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />

        <GridWithScroll />

        <Hexapod />

        <CameraTracker />

        <OrbitControls
          ref={controlsRef as never}
          makeDefault
          enabled={!arcInteracting && !cogDragging && !footDragging && !bodyHeightDragging}
          enableDamping
          dampingFactor={0.1}
          minDistance={0.15}
          maxDistance={2}
          target={[0, 0, 0]}
        />

        <GizmoHelper alignment="bottom-left" margin={[70, 70]}>
          <GizmoViewcube
            color="#4a4f5a"
            opacity={1}
            strokeColor="#6b7280"
            textColor="#e6e8ec"
            hoverColor="#f5c518"
            font="bold 64px sans-serif"
            faces={["X", "-X", "Y", "-Y", "Z", "-Z"]}
          />
        </GizmoHelper>
      </Canvas>

      <Compass />

      <StepInfoPanel />

      <PoseInfoPanel />

      {/* Boîte de réglage du servo sélectionné (bas-centre) */}
      <ServoDetailPanel />

      {/* Règle graduée de hauteur du châssis (visible quand le châssis est
          sélectionné, comme la poignée 3D). */}
      {chassisSelected && <HeightRuler />}

      <button
        type="button"
        className="btn-home"
        onClick={onHome}
        title="Revenir à la vue d'origine"
        aria-label="Revenir à la vue d'origine"
      >
        ⌂ Home
      </button>
    </div>
  );
}
