import { useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import type { LegContact } from "../model/kinematics";

interface ContactMarkersProps {
  contacts: LegContact[];
  cogWorld: Vector3;
  supportPolygon: { x: number; z: number }[];
  cogInside: boolean;
}

const CONTACT_COLOR = "#1e3a8a";
const COG_STABLE = "#16a34a";
const COG_UNSTABLE = "#dc2626";

function PolygonOutline({
  polygon,
  color,
}: {
  polygon: { x: number; z: number }[];
  color: string;
}) {
  const geometry = useMemo(() => {
    if (polygon.length < 2) return null;
    const positions: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      positions.push(a.x, 0.001, a.z, b.x, 0.001, b.z);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return g;
  }, [polygon]);

  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.8} />
    </lineSegments>
  );
}

function CogVerticalLine({ cogWorld, color }: { cogWorld: Vector3; color: string }) {
  const geometry = useMemo(() => {
    const positions = [cogWorld.x, cogWorld.y, cogWorld.z, cogWorld.x, 0, cogWorld.z];
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return g;
  }, [cogWorld.x, cogWorld.y, cogWorld.z]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.55} />
    </lineSegments>
  );
}

export function ContactMarkers({
  contacts,
  cogWorld,
  supportPolygon,
  cogInside,
}: ContactMarkersProps) {
  const cogColor = cogInside ? COG_STABLE : COG_UNSTABLE;

  return (
    <>
      {contacts.map((c) => (
        <group key={c.legIndex} position={[c.position.x, 0.0008, c.position.z]}>
          {/* Outer ring on the floor */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.018, 0.026, 32]} />
            <meshBasicMaterial color={CONTACT_COLOR} transparent opacity={0.7} />
          </mesh>
          {/* Inner solid dot */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0002, 0]}>
            <circleGeometry args={[0.012, 24]} />
            <meshBasicMaterial color={CONTACT_COLOR} transparent opacity={0.55} />
          </mesh>
        </group>
      ))}

      <PolygonOutline polygon={supportPolygon} color={cogColor} />

      <CogVerticalLine cogWorld={cogWorld} color={cogColor} />

      {/* CoG ground projection — disk on the floor */}
      <group position={[cogWorld.x, 0.0009, cogWorld.z]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.014, 0.022, 32]} />
          <meshBasicMaterial color={cogColor} transparent opacity={0.85} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0002, 0]}>
          <circleGeometry args={[0.008, 24]} />
          <meshBasicMaterial color={cogColor} transparent opacity={0.85} />
        </mesh>
      </group>
    </>
  );
}
