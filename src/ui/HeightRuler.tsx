import { useMemo, useRef } from "react";
import { useHexapodStore } from "../store/useHexapodStore";
import { chassisClearance, maxClearance } from "../model/bodyHeight";

/**
 * Règle graduée (cm.mm) de la hauteur du châssis — bord droit de l'espace 3D,
 * encadrée de jaune. Un curseur rouge indique la garde au sol calculée (bas du
 * châssis ↔ sol) ; il est déplaçable (clic/glissé sur la règle) et pilote
 * setBodyClearance (IK des pattes au sol, borné par les butées et le sol).
 * Affichée seulement quand le châssis est sélectionné (cf. Scene).
 */
export function HeightRuler() {
  const pose = useHexapodStore((s) => s.pose);
  const geometry = useHexapodStore((s) => s.geometry);
  const gravityEnabled = useHexapodStore((s) => s.gravityEnabled);

  const trackRef = useRef<HTMLDivElement>(null);

  const maxM = useMemo(() => Math.max(0.01, maxClearance(geometry)), [geometry]);
  const maxCm = Math.max(1, Math.ceil(maxM * 100)); // graduation jusqu'au cm entier
  const clearance = useMemo(
    () => chassisClearance(pose, geometry, gravityEnabled),
    [pose, geometry, gravityEnabled]
  );
  const clampedClr = Math.max(0, Math.min(maxM, clearance));
  // Fraction 0 (sol, en bas) → 1 (max, en haut).
  const frac = maxM > 0 ? clampedClr / maxM : 0;
  const cm = clearance * 100;

  // Graduations : un repère par mm, étiquette tous les cm.
  const ticks = useMemo(() => {
    const out: { mm: number; major: boolean }[] = [];
    for (let mm = 0; mm <= maxCm * 10; mm++) out.push({ mm, major: mm % 10 === 0 });
    return out;
  }, [maxCm]);

  const setFromClientY = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const f = 1 - (clientY - r.top) / r.height; // 0 en bas, 1 en haut
    const target = Math.max(0, Math.min(maxM, f * maxM));
    useHexapodStore.getState().setBodyClearance(target);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    useHexapodStore.getState().setBodyHeightDragging(true);
    setFromClientY(e.clientY);
    const move = (me: PointerEvent) => setFromClientY(me.clientY);
    const up = () => {
      useHexapodStore.getState().setBodyHeightDragging(false);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  return (
    <div className="height-ruler" aria-label="Hauteur du châssis">
      <div className="height-ruler-title">Hauteur</div>
      <div className="height-ruler-value">{cm.toFixed(1)} cm</div>
      <div
        className="height-ruler-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        title="Glisser pour régler la hauteur du châssis"
      >
        {ticks.map((t) => (
          <div
            key={t.mm}
            className={`hr-tick${t.major ? " hr-tick--major" : ""}`}
            // eslint-disable-next-line react/forbid-component-props
            style={{ bottom: `${(t.mm / (maxCm * 10)) * 100}%` }}
          >
            {t.major && <span className="hr-tick-label">{t.mm / 10}</span>}
          </div>
        ))}
        {/* Curseur rouge = garde au sol courante */}
        <div
          className="hr-cursor"
          // eslint-disable-next-line react/forbid-component-props
          style={{ bottom: `${frac * 100}%` }}
        />
      </div>
      <div className="height-ruler-unit">cm</div>
    </div>
  );
}
