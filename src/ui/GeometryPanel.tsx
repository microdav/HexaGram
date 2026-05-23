import { useHexapodStore } from "../store/useHexapodStore";

export function GeometryPanel() {
  const geometry = useHexapodStore((s) => s.geometry);
  const setGeometry = useHexapodStore((s) => s.setGeometry);

  const NumberInput = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
  }) => (
    <label className="geom-row">
      <span>{label}</span>
      <input
        type="number"
        step={0.1}
        min={0.5}
        value={(value * 100).toFixed(1)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
      <span className="unit">cm</span>
    </label>
  );

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Géométrie</h2>
      </div>
      <div className="geom-section">
        <div className="leg-title">Châssis</div>
        <NumberInput
          label="Longueur"
          value={geometry.chassis.length}
          onChange={(v) => setGeometry({ chassis: { ...geometry.chassis, length: v } })}
        />
        <NumberInput
          label="Largeur"
          value={geometry.chassis.width}
          onChange={(v) => setGeometry({ chassis: { ...geometry.chassis, width: v } })}
        />
        <NumberInput
          label="Hauteur"
          value={geometry.chassis.height}
          onChange={(v) => setGeometry({ chassis: { ...geometry.chassis, height: v } })}
        />
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
    </div>
  );
}
