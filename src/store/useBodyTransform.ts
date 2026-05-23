import { useMemo } from "react";
import { computeLegMounts } from "../model/hexapod";
import { computeBodyTransform, type BodyTransform } from "../model/kinematics";
import { useHexapodStore } from "./useHexapodStore";

/**
 * Derived hook: returns the current body transform (position + rotation + contacts).
 * Recomputes only when geometry, pose or gravity toggle change.
 */
export function useBodyTransform(): BodyTransform {
  const geometry = useHexapodStore((s) => s.geometry);
  const pose = useHexapodStore((s) => s.pose);
  const gravityEnabled = useHexapodStore((s) => s.gravityEnabled);

  const mounts = useMemo(() => computeLegMounts(geometry), [geometry]);
  return useMemo(
    () => computeBodyTransform(pose, geometry, mounts, gravityEnabled),
    [pose, geometry, mounts, gravityEnabled]
  );
}
