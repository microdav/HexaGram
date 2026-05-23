import { useState } from "react";
import { useHexapodStore } from "../store/useHexapodStore";

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
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
}

function CogSlider({
  label,
  value,
  range,
  onChange,
}: {
  label: string;
  value: number;
  range: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="geom-row">
      <span>{label}</span>
      <input
        type="range"
        min={-range}
        max={range}
        step={0.001}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="unit">{(value * 100).toFixed(1)} cm</span>
    </label>
  );
}

export function GeometryPanel() {
  const geometry = useHexapodStore((s) => s.geometry);
  const setGeometry = useHexapodStore((s) => s.setGeometry);
  const [geomOpen, setGeomOpen] = useState(true);
  const [cogOpen, setCogOpen] = useState(true);

  return (
    <div className="panel">
      <div className="panel-header collapsible-header" onClick={() => setGeomOpen((v) => !v)}>
        <h2>Géométrie</h2>
        <span className="collapse-caret">{geomOpen ? "▲" : "▼"}</span>
      </div>

      {geomOpen && (
        <>
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
        </>
      )}

      <div
        className={`panel-header collapsible-header geom-section${cogOpen ? "" : " cog-header-collapsed"}`}
        onClick={() => setCogOpen((v) => !v)}
      >
        <h2>Centre de gravité</h2>
        <span className="collapse-caret">{cogOpen ? "▲" : "▼"}</span>
      </div>

      {cogOpen && (
        <div className="geom-section">
          <CogSlider
            label="X (avant/arrière)"
            value={geometry.cog.x}
            range={geometry.chassis.length / 2}
            onChange={(v) => setGeometry({ cog: { ...geometry.cog, x: v } })}
          />
          <CogSlider
            label="Y (haut/bas)"
            value={geometry.cog.y}
            range={geometry.chassis.height}
            onChange={(v) => setGeometry({ cog: { ...geometry.cog, y: v } })}
          />
          <CogSlider
            label="Z (droite/gauche)"
            value={geometry.cog.z}
            range={geometry.chassis.width / 2}
            onChange={(v) => setGeometry({ cog: { ...geometry.cog, z: v } })}
          />
        </div>
      )}
    </div>
  );
}
