import type { CSSProperties } from "react";
import { SERVOS, LEG_NAMES } from "../model/hexapod";
import { useHexapodStore } from "../store/useHexapodStore";
import { useToolboxStore } from "../store/useToolboxStore";

const JOINT_LABEL: Record<string, string> = {
  coxa: "Coxa (Y)",
  femur: "Fémur (Z)",
  tibia: "Tibia (Z)",
};

const POPOVER_W = 260;
const POPOVER_H = 150;

/**
 * Popover tactile (mode tablette) : un tap sur une articulation 3D ouvre cette
 * fiche ancrée près du point touché, avec un gros slider et des boutons ±5°
 * pour régler l'angle au doigt sans glisser l'arc 3D.
 */
export function TabletServoEditor() {
  const tabletMode = useToolboxStore((s) => s.tabletMode);
  const edit = useToolboxStore((s) => s.tabletServoEdit);
  const setEdit = useToolboxStore((s) => s.setTabletServoEdit);
  const pose = useHexapodStore((s) => s.pose);
  const setServoAngle = useHexapodStore((s) => s.setServoAngle);

  if (!tabletMode || !edit) return null;
  const def = SERVOS[edit.servoId];
  if (!def) return null;

  const value = pose[edit.servoId];

  // Ancrage proche du point touché, borné à la fenêtre.
  const margin = 8;
  const x = Math.min(Math.max(margin, edit.x - POPOVER_W / 2), window.innerWidth - POPOVER_W - margin);
  const y = Math.min(Math.max(margin, edit.y + 16), window.innerHeight - POPOVER_H - margin);

  const nudge = (d: number) => setServoAngle(edit.servoId, value + d);

  const style = { "--sx": `${x}px`, "--sy": `${y}px` } as CSSProperties;

  return (
    <>
      <div className="tablet-servo-backdrop" onClick={() => setEdit(null)} />
      <div className="tablet-servo-popover" style={style} role="dialog" aria-label="Régler le servo">
        <div className="tsp-head">
          <span className="tsp-title">
            {LEG_NAMES[def.legIndex]} — {JOINT_LABEL[def.joint]}
          </span>
          <button type="button" className="tsp-close" onClick={() => setEdit(null)} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="tsp-val">{value.toFixed(0)}°</div>
        <div className="tsp-row">
          <button type="button" className="tsp-step" onClick={() => nudge(-5)} aria-label="Diminuer de 5 degrés">
            −5°
          </button>
          <input
            type="range"
            className="tsp-slider"
            aria-label={`${LEG_NAMES[def.legIndex]} — ${JOINT_LABEL[def.joint]}`}
            min={def.minDeg}
            max={def.maxDeg}
            step={1}
            value={value}
            onChange={(e) => setServoAngle(edit.servoId, Number(e.target.value))}
          />
          <button type="button" className="tsp-step" onClick={() => nudge(5)} aria-label="Augmenter de 5 degrés">
            +5°
          </button>
        </div>
        <div className="tsp-range">
          <span>{def.minDeg}°</span>
          <span>{def.maxDeg}°</span>
        </div>
      </div>
    </>
  );
}
