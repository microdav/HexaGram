import type { LegContact } from "../model/kinematics";

interface ContactMarkersProps {
  contacts: LegContact[];
}

const CONTACT_COLOR = "#1e3a8a";

export function ContactMarkers({ contacts }: ContactMarkersProps) {
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
    </>
  );
}
