import { useEffect, useRef, useState, useMemo } from "react";
import { BufferGeometry, DoubleSide, Float32BufferAttribute, PerspectiveCamera, Vector3 } from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useThree } from "@react-three/fiber";
import type { LegContact } from "../model/kinematics";
import { useHexapodStore } from "../store/useHexapodStore";

interface ContactMarkersProps {
  contacts: LegContact[];
  cogWorld: Vector3;
  supportPolygon: { x: number; z: number }[];
  cogInside: boolean;
}

const CONTACT_COLOR = "#1e3a8a";
const COG_STABLE = "#16a34a";
const COG_UNSTABLE = "#dc2626";

// Reusable temp object — one instance is safe since CogDragHandle is a singleton
const _camRight = new Vector3();

const SNAP_GRID = 0.005; // 5 mm grid

function snap(v: number): number {
  const nearest = Math.round(v / SNAP_GRID) * SNAP_GRID;
  // Wider magnet for the zero axis line (4 mm), softer for other grid points (1.5 mm)
  const threshold = Math.abs(nearest) < 1e-9 ? 0.004 : 0.0015;
  return Math.abs(v - nearest) <= threshold ? nearest : v;
}

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

function CogDragHandle({
  cogWorld,
  cogColor,
}: {
  cogWorld: Vector3;
  cogColor: string;
}) {
  const { gl, camera } = useThree();
  const geometry = useHexapodStore((s) => s.geometry);
  const setGeometry = useHexapodStore((s) => s.setGeometry);
  const setCogDragging = useHexapodStore((s) => s.setCogDragging);

  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);

  const dragStart = useRef<{
    cog: { x: number; y: number; z: number };
    clientX: number;
    clientY: number;
    /** Body height above ground at drag start — used to clamp CoG Y ≥ 0 in world space */
    bodyY: number;
  } | null>(null);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    dragStart.current = {
      cog: { ...geometry.cog },
      clientX: e.nativeEvent.clientX,
      clientY: e.nativeEvent.clientY,
      // approximate: body world Y = cogWorld.y − cog.y (assumes small body rotation)
      bodyY: cogWorld.y - geometry.cog.y,
    };
    setDragging(true);
    setCogDragging(true);
  };

  // Document-level move/up — reliable across the full viewport during drag
  useEffect(() => {
    if (!dragging || !dragStart.current) return;

    const start = dragStart.current;
    const { length, width, height } = geometry.chassis;
    const halfL = length / 2;
    const halfW = width / 2;
    // Minimum cog.y so that cogWorld.y stays ≥ 0
    const minCogY = -start.bodyY;

    const handleMove = (e: PointerEvent) => {
      const { cogAxisLock } = useHexapodStore.getState();

      // Dynamic world-units-per-pixel scale based on camera FOV and distance
      const cam = camera as PerspectiveCamera;
      const dist = Math.max(0.05, camera.position.length());
      const scale =
        (2 * Math.tan(((cam.fov ?? 45) / 2) * (Math.PI / 180)) * dist) /
        gl.domElement.clientHeight;

      // Camera right vector projected onto XZ plane:
      // horizontal screen movement → world X/Z in camera-relative direction
      _camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      _camRight.y = 0;
      if (_camRight.lengthSq() > 1e-6) _camRight.normalize();

      const dScreenX = e.clientX - start.clientX;
      const dScreenY = e.clientY - start.clientY;

      const dx = _camRight.x * dScreenX * scale;
      const dz = _camRight.z * dScreenX * scale;
      // Vertical screen up = CoG rises; marker stays on the ground
      const dy = -dScreenY * scale;

      setGeometry({
        cog: {
          x: cogAxisLock.x
            ? start.cog.x
            : snap(Math.max(-halfL, Math.min(halfL, start.cog.x + dx))),
          y: cogAxisLock.y
            ? start.cog.y
            : snap(Math.max(minCogY, Math.min(height, start.cog.y + dy))),
          z: cogAxisLock.z
            ? start.cog.z
            : snap(Math.max(-halfW, Math.min(halfW, start.cog.z + dz))),
        },
      });
    };

    const handleUp = () => {
      setDragging(false);
      setCogDragging(false);
      dragStart.current = null;
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, geometry.chassis, camera, gl, setGeometry, setCogDragging]);

  // Cursor feedback
  useEffect(() => {
    gl.domElement.style.cursor = hovered || dragging ? "crosshair" : "";
  }, [hovered, dragging, gl]);

  return (
    <>
      {/* Invisible circle hit-target — slightly larger than the visual marker for easy tap */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[cogWorld.x, 0.002, cogWorld.z]}
        onPointerDown={onPointerDown}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <circleGeometry args={[0.032, 32]} />
        <meshBasicMaterial transparent opacity={0} side={DoubleSide} />
      </mesh>

      {/* CoG ground projection — ring + dot */}
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
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.018, 0.026, 32]} />
            <meshBasicMaterial color={CONTACT_COLOR} transparent opacity={0.7} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0002, 0]}>
            <circleGeometry args={[0.012, 24]} />
            <meshBasicMaterial color={CONTACT_COLOR} transparent opacity={0.55} />
          </mesh>
        </group>
      ))}

      <PolygonOutline polygon={supportPolygon} color={cogColor} />
      <CogVerticalLine cogWorld={cogWorld} color={cogColor} />
      <CogDragHandle cogWorld={cogWorld} cogColor={cogColor} />
    </>
  );
}
