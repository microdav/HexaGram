import React, { useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { DoubleSide, ExtrudeGeometry, Shape, Vector3 } from "three";
import { useBodyTransform } from "../store/useBodyTransform";
import { useHexapodStore } from "../store/useHexapodStore";

const AXIS_X_COLOR = "#e74c3c"; // red
const AXIS_Y_COLOR = "#27ae60"; // green
const AXIS_Z_COLOR = "#3498db"; // blue

const COMPASS_CAM_DISTANCE = 8.0;

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

const ARROW_DEPTH = 0.16;

function ChassisArrow() {
  const transform = useBodyTransform();

  const geometry = useMemo(() => {
    const s = new Shape();
    const totalLen = 1.72;
    const shaftLen = 1.22;
    const sw = 0.09;
    const hw = 0.27;
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

    const geo = new ExtrudeGeometry(s, {
      depth: ARROW_DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.04,
      bevelSegments: 4,
    });
    // center the slab around Z=0 so after rotation it sits at Y=0
    geo.translate(0, 0, -ARROW_DEPTH / 2);
    return geo;
  }, []);

  const q = transform.quaternion;

  return (
    <group quaternion={[q.x, q.y, q.z, q.w]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} geometry={geometry}>
        <meshStandardMaterial
          color="#f5c518"
          emissive="#c87800"
          emissiveIntensity={0.6}
          metalness={0.15}
          roughness={0.4}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}

function CompassScene() {
  return (
    <>
      <CompassCameraDriver />
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 6, 4]} intensity={1.0} />
      <directionalLight position={[-3, 2, -3]} intensity={0.2} color="#99bbff" />

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

interface InclinationBarProps {
  value: number; // -1..1, 0 = level; positive = high on the "far" end
  orientation: "vertical" | "horizontal";
}

function InclinationBar({ value, orientation }: InclinationBarProps) {
  const clamped = Math.max(-1, Math.min(1, value));
  const abs = Math.abs(clamped);
  const level = abs < 0.12 ? "ok" : abs < 0.35 ? "warn" : "danger";

  // Bubble moves toward the high side:
  // vertical: positive value → bubble toward top (low CSS top%)
  // horizontal: positive value → bubble toward right (high CSS left%)
  const pct =
    orientation === "vertical"
      ? 50 - clamped * 38
      : 50 + clamped * 38;

  return (
    <div className={`inclination-bar inclination-bar--${orientation}`}>
      <div
        className="inclination-bubble"
        data-level={level}
        style={{ "--pos": `${pct}%` } as React.CSSProperties}
      />
    </div>
  );
}

export function Compass() {
  const compassLocked = useHexapodStore((s) => s.compassLocked);
  const toggleCompassLocked = useHexapodStore((s) => s.toggleCompassLocked);
  const { quaternion } = useBodyTransform();

  // Project world-up (0,1,0) through the body quaternion to get tilt components.
  // bodyUp.x ≠ 0 → pitch (forward/back); bodyUp.z ≠ 0 → roll (side to side).
  const { pitch, roll } = useMemo(() => {
    const up = new Vector3(0, 1, 0).applyQuaternion(quaternion);
    return { pitch: up.x, roll: up.z };
  }, [quaternion.x, quaternion.y, quaternion.z, quaternion.w]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="compass-cluster" aria-label="Inclinaison du châssis">
      <InclinationBar value={roll} orientation="horizontal" />

      <div className="overlay-compass">
        <Canvas
          camera={{ position: [8, 2, 8], fov: 28 }}
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
          aria-label={
            compassLocked ? "Déverrouiller la boussole" : "Verrouiller la boussole"
          }
        >
          {compassLocked ? "🔒" : "🔓"}
        </button>
      </div>

      <InclinationBar value={pitch} orientation="vertical" />
    </div>
  );
}
