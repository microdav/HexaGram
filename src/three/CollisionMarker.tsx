import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group } from "three";
import type { Vector3 } from "three";

interface Props {
  center: Vector3;
}

const ARROW_COLOR   = "#ffffff";
const ARROW_EMISSIVE = "#aaaaaa";
const SHAFT_RADIUS  = 0.007;
const SHAFT_LENGTH  = 0.08;
const HEAD_RADIUS   = 0.020;
const HEAD_LENGTH   = 0.045;
const HOVER_HEIGHT  = 0.14;

export function CollisionMarker({ center }: Props) {
  const groupRef = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.position.y = center.y + HOVER_HEIGHT + Math.sin(clock.getElapsedTime() * 3) * 0.015;
  });

  const mat = (
    <meshStandardMaterial
      color={ARROW_COLOR}
      emissive={ARROW_EMISSIVE}
      emissiveIntensity={0.5}
    />
  );

  return (
    <group
      ref={groupRef}
      position={[center.x, center.y + HOVER_HEIGHT, center.z]}
    >
      {/* Fût vertical — s'étend de y=0 vers y=-SHAFT_LENGTH */}
      <mesh position={[0, -SHAFT_LENGTH / 2, 0]}>
        <cylinderGeometry args={[SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 8]} />
        {mat}
      </mesh>

      {/* Cône — base en haut, pointe vers le bas
          rotation [π,0,0] retourne le cône : tip en -y, base en +y */}
      <mesh
        position={[0, -(SHAFT_LENGTH + HEAD_LENGTH / 2), 0]}
        rotation={[Math.PI, 0, 0]}
      >
        <coneGeometry args={[HEAD_RADIUS, HEAD_LENGTH, 8]} />
        {mat}
      </mesh>
    </group>
  );
}
