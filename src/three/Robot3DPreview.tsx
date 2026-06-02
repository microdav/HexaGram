import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { MiniHexapod } from "./MiniHexapod";
import { useHexapodStore } from "../store/useHexapodStore";
import { defaultPose } from "../model/pose";

/** Petite vue 3D interactive (orbite) du robot dans sa pose neutre. */
export function Robot3DPreview() {
  const geometry = useHexapodStore((s) => s.geometry);
  return (
    <div className="robot-preview-3d">
      <Canvas
        dpr={1}
        camera={{ position: [0.38, 0.32, 0.5], fov: 40, near: 0.01, far: 50 }}
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
      >
        <color attach="background" args={["#15171c"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 3, 2]} intensity={0.9} />
        <directionalLight position={[-2, 1, -1]} intensity={0.3} />
        <MiniHexapod pose={defaultPose()} geometry={geometry} gravityEnabled bodyTransparent={false} />
        <OrbitControls enablePan={false} minDistance={0.2} maxDistance={1.5} target={[0, 0, 0]} />
      </Canvas>
    </div>
  );
}
