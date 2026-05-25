import { useMemo } from "react";
import { computeLegMounts } from "../model/hexapod";
import { findServoType, type ServoSpec } from "../model/servoTypes";
import {
  computeLegJoints,
  estimateTorques,
  torqueColor,
  torqueRatio,
} from "../model/torqueEstimator";
import { useHexapodStore } from "../store/useHexapodStore";
import { useProjectStore } from "../store/useProjectStore";
import { useBodyTransform } from "../store/useBodyTransform";
import { useSequencerStore } from "../store/useSequencerStore";

const DEFAULT_MAX_KG_CM = 10;
const SPHERE_SEGS = 8;
const EMPTY_CUSTOM_SERVOS: ServoSpec[] = [];

interface JointSphereProps {
  position: [number, number, number];
  ratio: number;
  scale: number;
}

function JointSphere({ position, ratio, scale }: JointSphereProps) {
  const color = torqueColor(ratio);
  const radius = Math.max(0.006, 0.018 * scale);
  return (
    <mesh position={position}>
      <sphereGeometry args={[radius, SPHERE_SEGS, SPHERE_SEGS]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.5}
        transparent
        opacity={0.82}
      />
    </mesh>
  );
}

export function TorqueIndicator() {
  const isPlaying = useSequencerStore((s) => s.isPlaying);

  const pose = useHexapodStore((s) => s.pose);
  const geometry = useHexapodStore((s) => s.geometry);
  const globalServoTypeId = useProjectStore((s) => s.activeProject?.hardware.servoTypeId ?? null);
  const customServoTypes = useProjectStore((s) => s.activeProject?.hardware.customServoTypes ?? EMPTY_CUSTOM_SERVOS);
  const weightConfig = useHexapodStore((s) => s.weightConfig);
  const torqueEnabled = useHexapodStore((s) => s.torqueEnabled);

  const transform = useBodyTransform();

  const mounts = useMemo(() => computeLegMounts(geometry), [geometry]);

  const totalWeightG = weightConfig.totalWeightG ?? 0;

  const servoSpec = globalServoTypeId ? findServoType(globalServoTypeId, customServoTypes) : null;
  const maxKgCm =
    servoSpec?.torqueKgCm.v7_4 ??
    servoSpec?.torqueKgCm.v6 ??
    DEFAULT_MAX_KG_CM;

  const torques = useMemo(
    () => estimateTorques(pose, geometry, mounts, transform.contacts, totalWeightG),
    [pose, geometry, mounts, transform.contacts, totalWeightG]
  );

  const jointData = useMemo(() => {
    return mounts.map((mount) => {
      const joints = computeLegJoints(mount, pose, geometry);
      return { mount, joints };
    });
  }, [mounts, pose, geometry]);

  if (!isPlaying || !torqueEnabled || totalWeightG <= 0) return null;

  return (
    <>
      {jointData.map(({ mount, joints }) => {
        const idxCoxa = mount.index * 3;
        const idxFemur = mount.index * 3 + 1;
        const idxTibia = mount.index * 3 + 2;

        const rCoxa = torqueRatio(torques[idxCoxa] ?? 0, maxKgCm);
        const rFemur = torqueRatio(torques[idxFemur] ?? 0, maxKgCm);
        const rTibia = torqueRatio(torques[idxTibia] ?? 0, maxKgCm);

        return (
          <group key={mount.index}>
            <JointSphere
              position={[joints.coxaBase.x, joints.coxaBase.y, joints.coxaBase.z]}
              ratio={rCoxa}
              scale={rCoxa}
            />
            <JointSphere
              position={[joints.femurBase.x, joints.femurBase.y, joints.femurBase.z]}
              ratio={rFemur}
              scale={rFemur}
            />
            <JointSphere
              position={[joints.tibiaBase.x, joints.tibiaBase.y, joints.tibiaBase.z]}
              ratio={rTibia}
              scale={rTibia}
            />
          </group>
        );
      })}
    </>
  );
}
