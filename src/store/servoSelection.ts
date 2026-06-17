import { useMemo } from "react";
import { SERVOS } from "../model/hexapod";
import { servoIndex } from "../model/pose";
import { mirrorLegOf, useHexapodStore } from "./useHexapodStore";
import { useProjectStore } from "./useProjectStore";

/** IDs des servos directement sélectionnés (bits actifs de `arcShownMask`). */
export function selectedServoIdsFromMask(mask: number): number[] {
  const ids: number[] = [];
  for (let id = 0; id < SERVOS.length; id++) {
    if ((mask >>> id) & 1) ids.push(id);
  }
  return ids;
}

/** Hook : liste des servos directement sélectionnés en Conception 3D. */
export function useSelectedServoIds(): number[] {
  const mask = useHexapodStore((s) => s.arcShownMask);
  return useMemo(() => selectedServoIdsFromMask(mask), [mask]);
}

/**
 * Ensemble des servos « affectés » quand on bouge un servo sélectionné : le
 * servo lui-même + son miroir (si le miroir est actif) + la même articulation
 * des pattes du groupe lié (si un groupe est lié). Reproduit la propagation de
 * `setServoAngle` pour mettre en évidence TOUS les servos impactés dans les
 * boîtes Servo gauche/droite.
 */
export function useAffectedServoIds(): Set<number> {
  const mask = useHexapodStore((s) => s.arcShownMask);
  const mirrorEnabled = useHexapodStore((s) => s.mirrorEnabled);
  const linkedGroupId = useHexapodStore((s) => s.linkedGroupId);
  const legGroups = useProjectStore((s) => s.activeProject?.hardware.legGroups);
  return useMemo(() => {
    const out = new Set<number>();
    for (const id of selectedServoIdsFromMask(mask)) {
      const def = SERVOS[id];
      if (!def) continue;
      out.add(id);
      if (mirrorEnabled) out.add(servoIndex(mirrorLegOf(def.legIndex), def.joint));
      if (linkedGroupId) {
        const group = legGroups?.find((g) => g.id === linkedGroupId);
        if (group && group.legs.includes(def.legIndex)) {
          for (const leg of group.legs) out.add(servoIndex(leg, def.joint));
        }
      }
    }
    return out;
  }, [mask, mirrorEnabled, linkedGroupId, legGroups]);
}
