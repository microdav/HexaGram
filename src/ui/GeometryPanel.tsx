import { useHexapodStore } from "../store/useHexapodStore";
import { useToolboxStore } from "../store/useToolboxStore";


function NumberInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="geom-row">
      <span>{label}</span>
      <input
        type="number"
        step={0.1}
        min={0.5}
        value={(value * 100).toFixed(1)}
        disabled={disabled}
        readOnly={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <span className="unit">cm</span>
    </label>
  );
}

function CogSlider({
  label,
  value,
  range,
  axis,
  onChange,
}: {
  label: string;
  value: number;
  range: number;
  axis: "x" | "y" | "z";
  onChange: (v: number) => void;
}) {
  const locked = useHexapodStore((s) => s.cogAxisLock[axis]);
  const toggleCogAxisLock = useHexapodStore((s) => s.toggleCogAxisLock);

  return (
    <div className="geom-row">
      <span className="geom-row-label">
        <button
          type="button"
          className="cog-axis-lock"
          title={locked ? `Déverrouiller l'axe ${axis.toUpperCase()}` : `Verrouiller l'axe ${axis.toUpperCase()}`}
          onClick={() => toggleCogAxisLock(axis)}
        >
          {locked ? "🔒" : "🔓"}
        </button>
        {label}
      </span>
      <input
        type="range"
        aria-label={label}
        min={-range}
        max={range}
        step={0.001}
        value={value}
        disabled={locked}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="unit">{(value * 100).toFixed(1)} cm</span>
    </div>
  );
}

export function GeometryContent() {
  const geometry = useHexapodStore((s) => s.geometry);
  const setGeometry = useHexapodStore((s) => s.setGeometry);
  const setActiveTab = useToolboxStore((s) => s.setActiveTab);

  return (
    <>
      <div className="geom-section">
        <div className="leg-title">Châssis</div>
        {/* Longueur/largeur sont désormais dessinées dans l'onglet Robot 2D
            (source de vérité) → lecture seule ici. */}
        <NumberInput label="Longueur" value={geometry.chassis.length} disabled onChange={() => {}} />
        <NumberInput label="Largeur" value={geometry.chassis.width} disabled onChange={() => {}} />
        <NumberInput
          label="Hauteur"
          value={geometry.chassis.height}
          onChange={(v) => setGeometry({ chassis: { ...geometry.chassis, height: v } })}
        />
        <button
          type="button"
          className="btn btn-sm geom-edit-2d"
          onClick={() => setActiveTab("robot2d")}
          title="Modifier le châssis et les ancrages dans l'éditeur 2D"
        >
          ✎ Éditer dans Robot 2D
        </button>
      </div>
      <div className="geom-section">
        <div className="leg-title">Segments de patte</div>
        <NumberInput
          label="Coxa"
          value={geometry.segments.coxa}
          onChange={(v) => setGeometry({ segments: { ...geometry.segments, coxa: v } })}
        />
        <NumberInput
          label="Fémur"
          value={geometry.segments.femur}
          onChange={(v) => setGeometry({ segments: { ...geometry.segments, femur: v } })}
        />
        <NumberInput
          label="Tibia"
          value={geometry.segments.tibia}
          onChange={(v) => setGeometry({ segments: { ...geometry.segments, tibia: v } })}
        />
      </div>
    </>
  );
}

export function CogContent() {
  const geometry = useHexapodStore((s) => s.geometry);
  const setGeometry = useHexapodStore((s) => s.setGeometry);
  const gravityEnabled = useHexapodStore((s) => s.gravityEnabled);
  const setGravityEnabled = useHexapodStore((s) => s.setGravityEnabled);

  return (
    <div className="geom-section">
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={gravityEnabled}
          onChange={(e) => setGravityEnabled(e.target.checked)}
        />
        <span>Gravité</span>
        <span className="hint">
          {gravityEnabled
            ? "Le corps s'incline selon les appuis"
            : "Translation simple (pas d'inclinaison)"}
        </span>
      </label>
      <CogSlider
        label="X (avant/arrière)"
        value={geometry.cog.x}
        range={geometry.chassis.length / 2}
        axis="x"
        onChange={(v) => setGeometry({ cog: { ...geometry.cog, x: v } })}
      />
      <CogSlider
        label="Y (haut/bas)"
        value={geometry.cog.y}
        range={geometry.chassis.height}
        axis="y"
        onChange={(v) => setGeometry({ cog: { ...geometry.cog, y: v } })}
      />
      <CogSlider
        label="Z (droite/gauche)"
        value={geometry.cog.z}
        range={geometry.chassis.width / 2}
        axis="z"
        onChange={(v) => setGeometry({ cog: { ...geometry.cog, z: v } })}
      />
      <div className="geom-cog-reset">
        <button
          type="button"
          className="btn"
          onClick={() => setGeometry({ cog: { x: 0, y: 0, z: 0 } })}
        >
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
