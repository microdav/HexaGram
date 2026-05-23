import { useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { DoubleSide, Shape } from "three";
import { useBodyTransform } from "../store/useBodyTransform";
import { useHexapodStore } from "../store/useHexapodStore";

const AXIS_X_COLOR = "#e74c3c"; // red
const AXIS_Y_COLOR = "#27ae60"; // green
const AXIS_Z_COLOR = "#3498db"; // blue

const COMPASS_CAM_DISTANCE = 4.5;

function CompassCameraDriver() {
  const dir = useHexapodStore((s) => s.cameraDirection);
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(
      dir[0] * COMPASS_CAM_DISTANCE,
      dir[1] * COMPASS_CAM_DISTANCE,
      dir[2] * COMPASS_CAM_DISTANCE
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  }, [dir, camera]);

  return null;
}

function ChassisArrow() {
  const transform = useBodyTransform();

  const shape = useMemo(() => {
    const s = new Shape();
    const totalLen = 1.4;
    const shaftLen = 1.0;
    const sw = 0.07;
    const hw = 0.22;
    const xStart = -totalLen / 2;
    const xShaftEnd = xStart + shaftLen;
    const xTip = totalLen / 2;

    s.moveTo(xStart, +sw);
    s.lineTo(xShaftEnd, +sw);
    s.lineTo(xShaftEnd, +hw);
    s.lineTo(xTip, 0);
    s.lineTo(xShaftEnd, -hw);
    s.lineTo(xShaftEnd, -sw);
    s.lineTo(xStart, -sw);
    s.lineTo(xStart, +sw);
    return s;
  }, []);

  const q = transform.quaternion;

  return (
    <group quaternion={[q.x, q.y, q.z, q.w]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color="#f5c518" side={DoubleSide} />
      </mesh>
    </group>
  );
}

function CompassScene() {
  return (
    <>
      <CompassCameraDriver />
      <ambientLight intensity={1} />

      {/* Volume sphere — wireframe meridians/parallels suggest the 3D shape */}
      <mesh>
        <sphereGeometry args={[1.68, 16, 12]} />
        <meshBasicMaterial color="#9ca3af" wireframe transparent opacity={0.18} />
      </mesh>
      {/* Soft inner shading sphere */}
      <mesh>
        <sphereGeometry args={[1.65, 32, 24]} />
        <meshBasicMaterial color="#2a2f3a" transparent opacity={0.25} />
      </mesh>

      {/* Ring perpendicular to X (in YZ plane) — red */}
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <ringGeometry args={[1.7, 1.78, 64]} />
        <meshBasicMaterial color={AXIS_X_COLOR} side={DoubleSide} />
      </mesh>

      {/* Ring perpendicular to Y (in XZ plane) — green */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.7, 1.78, 64]} />
        <meshBasicMaterial color={AXIS_Y_COLOR} side={DoubleSide} />
      </mesh>

      {/* Ring perpendicular to Z (in XY plane) — blue */}
      <mesh>
        <ringGeometry args={[1.7, 1.78, 64]} />
        <meshBasicMaterial color={AXIS_Z_COLOR} side={DoubleSide} />
      </mesh>

      <ChassisArrow />
    </>
  );
}

export function Compass() {
  const compassLocked = useHexapodStore((s) => s.compassLocked);
  const toggleCompassLocked = useHexapodStore((s) => s.toggleCompassLocked);

  return (
    <div className="overlay-compass" aria-label="Inclinaison du châssis">
      <Canvas
        camera={{ position: [4.5, 1.0, 4.5], fov: 28 }}
        dpr={[1, 2]}
        gl={{ alpha: true }}
      >
        <CompassScene />
      </Canvas>
      <button
        type="button"
        className="compass-lock"
        onClick={toggleCompassLocked}
        title={
          compassLocked
            ? "Boussole figée — cliquer pour resynchroniser avec la caméra"
            : "Boussole synchronisée avec la caméra — cliquer pour figer"
        }
        aria-label={compassLocked ? "Déverrouiller la boussole" : "Verrouiller la boussole"}
      >
        {compassLocked ? "🔒" : "🔓"}
      </button>
    </div>
  );
}
