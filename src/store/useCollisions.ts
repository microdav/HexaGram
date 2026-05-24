import { useMemo } from "react";
import { computeLegMounts } from "../model/hexapod";
import { detectCollisions, type CollisionResult } from "../model/collisions";
import { useHexapodStore } from "./useHexapodStore";

export function useCollisions(): CollisionResult {
  const pose = useHexapodStore((s) => s.pose);
  const geometry = useHexapodStore((s) => s.geometry);
  const collisionPrefs = useHexapodStore((s) => s.collisionPrefs);

  return useMemo(() => {
    const mounts = computeLegMounts(geometry);
    return detectCollisions(mounts, pose, geometry, collisionPrefs);
  }, [pose, geometry, collisionPrefs]);
}
