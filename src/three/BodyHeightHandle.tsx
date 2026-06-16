import { useRef, useState } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useHexapodStore } from "../store/useHexapodStore";
import { chassisClearance } from "../model/bodyHeight";

const STEM = 0.05;
const ACCENT = "#f5c518";
const DRAG = "#4ade80";

/**
 * Poignée 3D de réglage de la hauteur du châssis : tige verticale + losange
 * attrapable au-dessus du châssis. Glisser verticalement lève/descend le corps
 * (via setBodyClearance : IK sur les pattes au sol, borné butées + sol). Visible
 * uniquement quand le châssis est sélectionné. `anchor` = sommet du châssis (monde).
 */
export function BodyHeightHandle({ anchor }: { anchor: [number, number, number] }) {
  const { camera, gl } = useThree();
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ clientX: number; clientY: number; clearance: number } | null>(null);

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const st = useHexapodStore.getState();
    startRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      clearance: chassisClearance(st.pose, st.geometry, st.gravityEnabled),
    };
    setDragging(true);
    useHexapodStore.getState().setBodyHeightDragging(true);
    gl.domElement.style.cursor = "grabbing";

    const move = (me: PointerEvent) => {
      const s = startRef.current;
      if (!s) return;
      const cam = camera as PerspectiveCamera;
      const dist = Math.max(0.05, camera.position.length());
      const scale =
        (2 * Math.tan(((cam.fov ?? 45) / 2) * (Math.PI / 180)) * dist) /
        gl.domElement.clientHeight;
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const dWorld = right
        .multiplyScalar((me.clientX - s.clientX) * scale)
        .add(up.multiplyScalar(-(me.clientY - s.clientY) * scale));
      useHexapodStore.getState().setBodyClearance(s.clearance + dWorld.y);
    };
    const upH = () => {
      startRef.current = null;
      setDragging(false);
      useHexapodStore.getState().setBodyHeightDragging(false);
      gl.domElement.style.cursor = "";
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", upH);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", upH);
  };

  const color = dragging ? DRAG : ACCENT;
  return (
    <group position={anchor}>
      <mesh position={[0, STEM / 2, 0]}>
        <cylinderGeometry args={[0.0018, 0.0018, STEM, 8]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh
        position={[0, STEM, 0]}
        onPointerDown={onDown}
        onPointerOver={(e) => {
          e.stopPropagation();
          gl.domElement.style.cursor = "ns-resize";
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          if (!dragging) gl.domElement.style.cursor = "";
        }}
      >
        <octahedronGeometry args={[0.014]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
    </group>
  );
}
