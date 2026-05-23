import { degToRad } from "../model/servo";
import { servoIndex } from "../model/pose";
import { useHexapodStore } from "../store/useHexapodStore";
import type { LegMount } from "../model/hexapod";

interface LegProps {
  mount: LegMount;
}

const HEXAPOD_YELLOW = "#f5c518";
const JOINT_COLOR = "#222";

export function Leg({ mount }: LegProps) {
  const pose = useHexapodStore((s) => s.pose);
  const segs = useHexapodStore((s) => s.geometry.segments);

  const coxaDeg = pose[servoIndex(mount.index, "coxa")];
  const femurDeg = pose[servoIndex(mount.index, "femur")];
  const tibiaDeg = pose[servoIndex(mount.index, "tibia")];

  const jointR = 0.012;

  return (
    <group position={mount.position} rotation={[0, degToRad(mount.yawDeg), 0]}>
      {/* Coxa joint (rotation around vertical Y) */}
      <mesh>
        <sphereGeometry args={[jointR, 16, 16]} />
        <meshStandardMaterial color={JOINT_COLOR} />
      </mesh>
      <group rotation={[0, degToRad(coxaDeg), 0]}>
        {/* Coxa segment along local +X */}
        <mesh position={[segs.coxa / 2, 0, 0]}>
          <boxGeometry args={[segs.coxa, 0.018, 0.018]} />
          <meshStandardMaterial color={HEXAPOD_YELLOW} />
        </mesh>
        <group position={[segs.coxa, 0, 0]}>
          {/* Femur joint (rotation around Z = pitch up/down) */}
          <mesh>
            <sphereGeometry args={[jointR, 16, 16]} />
            <meshStandardMaterial color={JOINT_COLOR} />
          </mesh>
          <group rotation={[0, 0, degToRad(femurDeg)]}>
            <mesh position={[segs.femur / 2, 0, 0]}>
              <boxGeometry args={[segs.femur, 0.016, 0.016]} />
              <meshStandardMaterial color={HEXAPOD_YELLOW} />
            </mesh>
            <group position={[segs.femur, 0, 0]}>
              {/* Tibia joint (knee) */}
              <mesh>
                <sphereGeometry args={[jointR, 16, 16]} />
                <meshStandardMaterial color={JOINT_COLOR} />
              </mesh>
              <group rotation={[0, 0, degToRad(tibiaDeg)]}>
                <mesh position={[segs.tibia / 2, 0, 0]}>
                  <boxGeometry args={[segs.tibia, 0.012, 0.012]} />
                  <meshStandardMaterial color={HEXAPOD_YELLOW} />
                </mesh>
                {/* Foot tip */}
                <mesh position={[segs.tibia, 0, 0]}>
                  <sphereGeometry args={[0.008, 12, 12]} />
                  <meshStandardMaterial color="#444" />
                </mesh>
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
