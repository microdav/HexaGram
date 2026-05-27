import { useEffect, useState, type CSSProperties } from "react";
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
const MARGIN = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Popover tactile (mode tablette) : un tap sur une articulation 3D ouvre cette
 * fiche, avec un gros slider et des boutons ±5° pour régler l'angle au doigt.
 * La fiche s'ancre près du point touché (au-dessus s'il est dans la moitié
 * basse de l'écran) et peut être déplacée en glissant son en-tête.
 */
export function TabletServoEditor() {
  const tabletMode = useToolboxStore((s) => s.tabletMode);
  const edit = useToolboxStore((s) => s.tabletServoEdit);
  const setEdit = useToolboxStore((s) => s.setTabletServoEdit);
  const pose = useHexapodStore((s) => s.pose);
  const setServoAngle = useHexapodStore((s) => s.setServoAngle);
  const setArcShown = useHexapodStore((s) => s.setArcShown);

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const servoId = edit?.servoId ?? null;

  // (Ré)ancrage à chaque nouvelle sélection : sous le point touché, ou
  // au-dessus si le tap est dans la moitié basse (évite que la fiche colle au bas).
  useEffect(() => {
    if (!edit) {
      setPos(null);
      return;
    }
    const below = edit.y < window.innerHeight / 2;
    const x = clamp(edit.x - POPOVER_W / 2, MARGIN, window.innerWidth - POPOVER_W - MARGIN);
    const y = below
      ? clamp(edit.y + 24, MARGIN, window.innerHeight - POPOVER_H - MARGIN)
      : clamp(edit.y - POPOVER_H - 24, MARGIN, window.innerHeight - POPOVER_H - MARGIN);
    setPos({ x, y });
  }, [servoId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tabletMode || !edit || !pos) return null;
  const def = SERVOS[edit.servoId];
  if (!def) return null;

  const value = pose[edit.servoId];

  // Fermer = désélectionner : on ferme le popover ET on éteint l'arc 3D.
  const close = () => {
    setArcShown(edit.servoId, false);
    setEdit(null);
  };

  const nudge = (d: number) => setServoAngle(edit.servoId, value + d);

  const onHeadPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".tsp-close")) return;
    e.preventDefault();
    const start = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    const onMove = (ev: PointerEvent) => {
      setPos({
        x: clamp(start.px + ev.clientX - start.mx, MARGIN, window.innerWidth - POPOVER_W - MARGIN),
        y: clamp(start.py + ev.clientY - start.my, MARGIN, window.innerHeight - POPOVER_H - MARGIN),
      });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const style = { "--sx": `${pos.x}px`, "--sy": `${pos.y}px` } as CSSProperties;

  return (
    <>
      <div className="tablet-servo-backdrop" onClick={close} />
      <div className="tablet-servo-popover" style={style} role="dialog" aria-label="Régler le servo">
        <div className="tsp-head" onPointerDown={onHeadPointerDown}>
          <span className="tsp-grip" aria-hidden="true">⠿</span>
          <span className="tsp-title">
            {LEG_NAMES[def.legIndex]} — {JOINT_LABEL[def.joint]}
          </span>
          <button type="button" className="tsp-close" onClick={close} aria-label="Fermer">
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
