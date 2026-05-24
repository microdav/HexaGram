import { useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewcube, Grid, OrbitControls } from "@react-three/drei";
import { Hexapod } from "./Hexapod";
import { Compass } from "./Compass";
import { useHexapodStore } from "../store/useHexapodStore";
import { useCollisions } from "../store/useCollisions";

const CAM_KEY = "hexagram.camera";

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

  const onHome = () => controlsRef.current?.reset();

  const initCamPos = readSavedCamera()?.position ?? DEFAULT_CAM_POS;

  return (
    <div className="viewer-inner">
      <CollisionBanner />
      <Canvas
        shadows
        camera={{ position: initCamPos, fov: 45, near: 0.01, far: 50 }}
        dpr={[1, 2]}
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

        <Grid
          args={[2, 2]}
          cellSize={0.05}
          cellThickness={0.6}
          cellColor="#2a2f3a"
          sectionSize={0.25}
          sectionThickness={1}
          sectionColor="#3a4150"
          fadeDistance={2.5}
          fadeStrength={1}
          infiniteGrid
          position={[0, -0.001, 0]}
        />

        <Hexapod />

        <CameraTracker />

        <OrbitControls
          ref={controlsRef as never}
          makeDefault
          enabled={!arcInteracting && !cogDragging && !footDragging}
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
