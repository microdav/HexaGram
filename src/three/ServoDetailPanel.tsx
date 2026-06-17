import { SERVOS, LEG_NAMES } from "../model/hexapod";
import { useHexapodStore } from "../store/useHexapodStore";
import { useSelectedServoIds, useAffectedServoIds } from "../store/servoSelection";

const JOINT_LABEL: Record<string, string> = {
  coxa: "Coxa (Y)",
  femur: "Fémur (Z)",
  tibia: "Tibia (Z)",
};

/**
 * Boîte flottante bas-centre de la scène 3D : apparaît au clic sur un
 * servomoteur, affiche son nom + le même slider d'angle que les boîtes Servo
 * gauche/droite. Se masque automatiquement quand plus aucun servo n'est
 * sélectionné ; la croix désélectionne (referme arcs + boîte). Plusieurs servos
 * peuvent être sélectionnés (un slider par servo).
 */
export function ServoDetailPanel() {
  const selectedIds = useSelectedServoIds();
  const pose = useHexapodStore((s) => s.pose);
  const setServoAngle = useHexapodStore((s) => s.setServoAngle);
  const clearArcs = useHexapodStore((s) => s.clearArcs);
  const affected = useAffectedServoIds();

  if (selectedIds.length === 0) return null;

  const extra = [...affected].filter((id) => !selectedIds.includes(id)).length;

  return (
    <div className="servo-detail-panel">
      <div className="servo-detail-head">
        <span className="servo-detail-title">
          {selectedIds.length > 1 ? "Servos sélectionnés" : "Servo sélectionné"}
        </span>
        <button
          type="button"
          className="servo-detail-close"
          onClick={() => clearArcs()}
          title="Fermer et désélectionner"
          aria-label="Fermer"
        >
          ✕
        </button>
      </div>

      {selectedIds.map((id) => {
        const def = SERVOS[id];
        if (!def) return null;
        const value = pose[id];
        const name = `${LEG_NAMES[def.legIndex]} — ${JOINT_LABEL[def.joint]}`;
        return (
          <div className="servo-row servo-detail-row" key={id}>
            <label className="servo-label">
              <span>{name}</span>
              <span className="servo-val">{value.toFixed(0)}°</span>
            </label>
            <input
              type="range"
              aria-label={name}
              min={def.minDeg}
              max={def.maxDeg}
              step={1}
              value={value}
              onChange={(e) => setServoAngle(id, Number(e.target.value))}
            />
          </div>
        );
      })}

      {extra > 0 && (
        <div className="servo-detail-note">
          Affecte aussi {extra} autre{extra > 1 ? "s" : ""} servo{extra > 1 ? "s" : ""} (miroir / groupe lié)
        </div>
      )}
    </div>
  );
}
