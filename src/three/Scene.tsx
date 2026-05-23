import { useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewcube, Grid, OrbitControls } from "@react-three/drei";
import { Hexapod } from "./Hexapod";
import { Compass } from "./Compass";
import { useHexapodStore } from "../store/useHexapodStore";

function CameraTracker() {
  const { camera } = useThree();
  const setCameraDirection = useHexapodStore((s) => s.setCameraDirection);
  const compassLocked = useHexapodStore((s) => s.compassLocked);
  const last = useRef<[number, number, number]>([0, 0, 0]);

  useFrame(() => {
    if (compassLocked) return;
    const x = camera.position.x;
    const y = camera.position.y;
    const z = camera.position.z;
    const m = Math.sqrt(x * x + y * y + z * z);
    if (m < 1e-4) return;
    const dx = x / m;
    const dy = y / m;
    const dz = z / m;
    if (
      Math.abs(dx - last.current[0]) > 1e-3 ||
      Math.abs(dy - last.current[1]) > 1e-3 ||
      Math.abs(dz - last.current[2]) > 1e-3
    ) {
      last.current = [dx, dy, dz];
      setCameraDirection([dx, dy, dz]);
    }
  });

  return null;
}

export function Scene() {
  // Untyped: drei's OrbitControls ref shape is OrbitControlsImpl from three-stdlib;
  // we only need .reset() so we keep it loose.
  const controlsRef = useRef<{ reset: () => void } | null>(null);

  const onHome = () => controlsRef.current?.reset();

  return (
    <div className="viewer-inner">
      <Canvas
        shadows
        camera={{ position: [0.55, 0.4, 0.55], fov: 45, near: 0.01, far: 50 }}
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
