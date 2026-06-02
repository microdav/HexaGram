import { useRobot2DStore, type Robot2DTool } from "../../store/useRobot2DStore";
import { useRobot2DHistory, commitHistory } from "../../store/useRobot2DHistory";
import { useHexapodStore } from "../../store/useHexapodStore";
import type { ShapeLayer } from "../../model/hexapod";

const TOOLS: { id: Robot2DTool; icon: string; label: string; hint: string }[] = [
  { id: "select", icon: "✋", label: "Sélection", hint: "Cliquer pour sélectionner / glisser pour déplacer ; double-clic = éditer les sommets" },
  { id: "pen", icon: "✏️", label: "Crayon", hint: "Cliquer point par point ; double-clic, Entrée ou clic sur le 1er point pour fermer le contour" },
  { id: "rect", icon: "▭", label: "Rectangle", hint: "Glisser pour tracer un rectangle (aimanté à la grille)" },
  { id: "circle", icon: "◯", label: "Cercle", hint: "Glisser du centre vers le rayon" },
  { id: "placeServo", icon: "⚙", label: "Servos", hint: "Déplacer les marqueurs de servo (double-clic = réinitialiser)" },
  { id: "measure", icon: "📏", label: "Mesurer", hint: "Cliquer le départ puis l'arrivée ; glisser la cote pour la décaler" },
];

const LAYERS: { id: ShapeLayer; label: string }[] = [
  { id: "real", label: "Réel" },
  { id: "virtual", label: "Virtuel" },
];

export function Robot2DToolbar() {
  const tool = useRobot2DStore((s) => s.tool);
  const setTool = useRobot2DStore((s) => s.setTool);
  const activeLayer = useRobot2DStore((s) => s.activeLayer);
  const setActiveLayer = useRobot2DStore((s) => s.setActiveLayer);
  // Sélecteur primitif : ne PAS retourner `?? []` (nouveau tableau ⇒ boucle infinie).
  const hasMeasurements = useHexapodStore((s) => (s.geometry.body2D?.measurements?.length ?? 0) > 0);
  const clearMeasurements = useHexapodStore((s) => s.clearMeasurements);
  const resetView = useRobot2DStore((s) => s.resetView);

  const entries = useRobot2DHistory((s) => s.entries);
  const index = useRobot2DHistory((s) => s.index);
  const undo = useRobot2DHistory((s) => s.undo);
  const redo = useRobot2DHistory((s) => s.redo);
  const canUndo = index > 0;
  const canRedo = index >= 0 && index < entries.length - 1;

  const active = TOOLS.find((t) => t.id === tool);

  return (
    <div className="r2d-toolbar">
      <div className="r2d-toolbar-group">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={`r2d-tb-btn${tool === t.id ? " active" : ""}`}
            onClick={() => setTool(t.id)} title={t.hint}>
            <span className="r2d-tb-icon" aria-hidden="true">{t.icon}</span>
            <span className="r2d-tb-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="r2d-toolbar-sep" />

      {/* Calque actif pour la création de formes */}
      <div className="r2d-layer-switch" title="Calque de dessin">
        {LAYERS.map((l) => (
          <button key={l.id} type="button" className={`r2d-layer-btn${l.id}${activeLayer === l.id ? " active" : ""}`}
            onClick={() => setActiveLayer(l.id)}>
            {l.label}
          </button>
        ))}
      </div>

      <div className="r2d-toolbar-sep" />

      <div className="r2d-toolbar-group">
        <button type="button" className="r2d-tb-btn" disabled={!canUndo} onClick={undo} title="Annuler (Ctrl+Z)"><span className="r2d-tb-icon" aria-hidden="true">↶</span></button>
        <button type="button" className="r2d-tb-btn" disabled={!canRedo} onClick={redo} title="Rétablir (Ctrl+Y)"><span className="r2d-tb-icon" aria-hidden="true">↷</span></button>
        <button type="button" className="r2d-tb-btn" onClick={resetView} title="Recentrer la vue"><span className="r2d-tb-icon" aria-hidden="true">⤢</span></button>
        {hasMeasurements && (
          <button type="button" className="r2d-tb-btn" onClick={() => { clearMeasurements(); commitHistory("Mesures effacées"); }} title="Effacer toutes les mesures"><span className="r2d-tb-icon" aria-hidden="true">🗑</span></button>
        )}
      </div>

      {active && <div className="r2d-toolbar-hint">{active.hint}</div>}
    </div>
  );
}
