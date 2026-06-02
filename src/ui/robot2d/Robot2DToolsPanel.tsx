import { useState } from "react";
import { useHexapodStore } from "../../store/useHexapodStore";
import { useProjectStore } from "../../store/useProjectStore";
import { useRobot2DStore, newShapeId } from "../../store/useRobot2DStore";
import { useToastStore } from "../../store/useToastStore";
import { defaultAnchorsFromGeometry, segmentWidthsOf, segmentHeightsOf, type Body2D, type Shape2D, LEG_NAMES } from "../../model/hexapod";
import { findServoType } from "../../model/servoTypes";
import { commitHistory } from "../../store/useRobot2DHistory";
import { ringIssues, untangleRing } from "../../model/polygon";
import { realShapesOverlap, fuseRealShapes } from "../../model/chassisBake";

/**
 * Champ numérique compact (libellé + input + unité). `onCommit` (blur) = point
 * d'historique. Saisie en **texte** tolérante : accepte la **virgule** (pavé
 * numérique) comme le point ; état local pendant la frappe pour ne pas brider
 * l'utilisateur (ex. taper « 1, » avant « 1,5 »).
 */
function Field({
  label, value, unit, onChange, onCommit, disabled,
}: {
  label: string; value: number; unit: string; step?: number; min?: number;
  onChange: (v: number) => void; onCommit?: () => void; disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");
  const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "0");
  const apply = (raw: string) => { const v = parseFloat(raw.replace(",", ".")); if (Number.isFinite(v)) onChange(v); };
  return (
    <label className="r2d-field">
      <span className="r2d-field-label">{label}</span>
      <span className="r2d-field-input">
        <input
          type="text" inputMode="decimal" disabled={disabled}
          value={focused ? text : fmt(value)}
          onFocus={() => { setFocused(true); setText(fmt(value)); }}
          onChange={(e) => { setText(e.target.value); apply(e.target.value); }}
          onBlur={() => { setFocused(false); apply(text); onCommit?.(); }}
        />
        <span className="r2d-field-unit">{unit}</span>
      </span>
    </label>
  );
}

export function Robot2DToolsPanel() {
  const geometry = useHexapodStore((s) => s.geometry);
  const setShapes = useHexapodStore((s) => s.setShapes);
  const setLegAnchor = useHexapodStore((s) => s.setLegAnchor);
  const setGeometry = useHexapodStore((s) => s.setGeometry);
  const setSegmentWidth = useHexapodStore((s) => s.setSegmentWidth);
  const applySegmentWidthsToAll = useHexapodStore((s) => s.applySegmentWidthsToAll);
  const setSegmentHeight = useHexapodStore((s) => s.setSegmentHeight);
  const applySegmentHeightsToAll = useHexapodStore((s) => s.applySegmentHeightsToAll);
  const servoTypeId = useProjectStore((s) => s.activeProject?.hardware.servoTypeId);
  const customServoTypes = useProjectStore((s) => s.activeProject?.hardware.customServoTypes);
  const showToast = useToastStore((s) => s.show);

  const selected = useRobot2DStore((s) => s.selected);
  const selectedShapeId = useRobot2DStore((s) => s.selectedShapeId);
  const selectShape = useRobot2DStore((s) => s.selectShape);
  const snapEnabled = useRobot2DStore((s) => s.snapEnabled);
  const setSnapEnabled = useRobot2DStore((s) => s.setSnapEnabled);
  const snapStepCm = useRobot2DStore((s) => s.snapStepCm);
  const setSnapStepCm = useRobot2DStore((s) => s.setSnapStepCm);
  const keyboardStepCm = useRobot2DStore((s) => s.keyboardStepCm);
  const setKeyboardStepCm = useRobot2DStore((s) => s.setKeyboardStepCm);
  const showServos = useRobot2DStore((s) => s.showServos);
  const setShowServos = useRobot2DStore((s) => s.setShowServos);
  const resetView = useRobot2DStore((s) => s.resetView);

  const shapes = geometry.body2D?.shapes ?? [];
  const reals = shapes.filter((s) => s.layer === "real");
  const virtuals = shapes.filter((s) => s.layer === "virtual");
  const overlap = realShapesOverlap(shapes);
  const invalid = shapes.filter((s) => { const r = ringIssues(s.poly); return r.edges.length > 0 || r.verts.length > 0; });
  const selectedShape = shapes.find((s) => s.id === selectedShapeId) ?? null;

  const commitShapes = (next: Shape2D[], label: string) => { setShapes(next); commitHistory(label); };

  const removeShape = (id: string) => { commitShapes(shapes.filter((s) => s.id !== id), "Forme supprimée"); if (selectedShapeId === id) selectShape(null); };
  const toggleOp = (id: string) => commitShapes(shapes.map((s) => (s.id === id ? { ...s, op: s.op === "add" ? "subtract" : "add" } : s)), "Type de forme");
  const changeLayer = (id: string) => commitShapes(shapes.map((s) => (s.id === id ? { ...s, layer: s.layer === "real" ? "virtual" : "real" } : s)), "Changement de calque");
  const fuse = () => { commitShapes(fuseRealShapes(shapes, newShapeId), "Fusion des formes"); showToast("Fusionnées — originaux conservés en gabarit virtuel"); };
  const autoFix = () => { commitShapes(shapes.map((s) => ({ ...s, poly: untangleRing(s.poly) })), "Correction automatique"); showToast("Tracés corrigés ✓"); };

  const anchors = geometry.body2D?.anchors && geometry.body2D.anchors.length === 6
    ? geometry.body2D.anchors : defaultAnchorsFromGeometry(geometry);
  const selectedLeg = selected?.type === "leg" ? anchors.find((a) => a.index === selected.index) ?? null : null;
  const legIdx = selectedLeg?.index ?? null;
  const segW = segmentWidthsOf(geometry, legIdx ?? 0);
  const segH = segmentHeightsOf(geometry, legIdx ?? 0);
  const servoSpec = findServoType(servoTypeId, customServoTypes ?? []);
  // Bornes coxa (vue de face) : [hauteur servo, hauteur châssis] en cm.
  const servoHcm = (servoSpec?.dimensionsMm.h ?? 38) / 10;
  const servoWcm = (servoSpec?.dimensionsMm.w ?? 20) / 10; // défaut tibia au genou
  const chassisHcm = geometry.chassis.height * 100;
  const coxaHcm = Math.min(chassisHcm, Math.max(servoHcm, segH.coxa * 100));
  // Tibia au genou : valeur réglée si présente, sinon largeur du servo.
  const rawTibiaKnee = legIdx !== null ? geometry.segmentHeights?.[legIdx]?.tibia : undefined;
  const tibiaKneeCm = rawTibiaKnee != null ? rawTibiaKnee * 100 : servoWcm;

  const handleResetAnchors = () => {
    const g = useHexapodStore.getState().geometry;
    const body2D: Body2D = {
      version: 1,
      outline: g.body2D?.outline ?? { length: g.chassis.length, width: g.chassis.width },
      shapes: g.body2D?.shapes, pieces: g.body2D?.pieces,
      points: g.body2D?.points ?? null, holes: g.body2D?.holes,
      servoMarkers: g.body2D?.servoMarkers, anchors: defaultAnchorsFromGeometry(g),
    };
    setGeometry({ body2D });
    commitHistory("Ancrages réinitialisés");
  };

  const shapeRow = (s: Shape2D, i: number) => (
    <div key={s.id} className={`r2d-shape-row${selectedShapeId === s.id ? " selected" : ""}`} onClick={() => selectShape(s.id)}>
      <span className={`r2d-shape-dot ${s.layer} ${s.op}`} aria-hidden="true" />
      <span className="r2d-shape-name">Forme {i + 1}</span>
      {s.layer === "real" && (
        <button type="button" className="r2d-shape-op" title="Matière ou découpe" onClick={(e) => { e.stopPropagation(); toggleOp(s.id); }}>
          {s.op === "add" ? "Matière" : "Découpe"}
        </button>
      )}
      <button type="button" className="r2d-shape-op" title="Faire passer dans l'autre calque"
        onClick={(e) => { e.stopPropagation(); changeLayer(s.id); }}>
        {s.layer === "real" ? "→ Virtuel" : "→ Réel"}
      </button>
      <button type="button" className="r2d-shape-del" title="Supprimer" onClick={(e) => { e.stopPropagation(); removeShape(s.id); }}>✕</button>
    </div>
  );

  return (
    <div className="panel r2d-tools-panel">
      <div className="r2d-panel-title">Réglages</div>

      {/* Formes réelles */}
      <div className="r2d-section-title">Masque réel (jaune)</div>
      {reals.length === 0 ? (
        <p className="r2d-hint">Choisissez un outil (Crayon, Rectangle, Cercle) et dessinez sur le calque <b>Réel</b>.</p>
      ) : reals.map((s, i) => shapeRow(s, i))}

      {overlap && (
        <button type="button" className="btn btn-sm btn-primary" onClick={fuse} title="Fusionner les formes qui se chevauchent">
          ⛶ Fusionner les chevauchements
        </button>
      )}
      {invalid.length > 0 && (
        <>
          <div className="r2d-validity bad">⚠ {invalid.length} forme(s) au tracé invalide (arêtes croisées)</div>
          <button type="button" className="btn btn-sm btn-primary" onClick={autoFix}>⟲ Corriger automatiquement</button>
        </>
      )}
      {reals.length > 0 && invalid.length === 0 && (
        <div className="r2d-validity ok">✓ {geometry.body2D?.pieces?.length ?? 0} morceau(x) de châssis</div>
      )}

      {/* Formes virtuelles */}
      {virtuals.length > 0 && (
        <>
          <div className="r2d-section-title">Masque virtuel (gris)</div>
          {virtuals.map((s, i) => shapeRow(s, i))}
        </>
      )}

      {/* Forme sélectionnée */}
      {selectedShape && (
        <p className="r2d-hint">Forme sélectionnée : {selectedShape.poly.length} sommets. Glissez l'intérieur pour déplacer, les poignées pour éditer (« + » ajoute, double-clic supprime un sommet) ; Suppr retire la forme.</p>
      )}

      {/* Patte sélectionnée */}
      <div className="r2d-section-title">
        {selectedLeg ? `Patte ${selectedLeg.index} — ${LEG_NAMES[selectedLeg.index]}` : "Patte (aucune)"}
      </div>
      <Field label="Position X (avant)" unit="cm" value={(selectedLeg?.x ?? 0) * 100} disabled={!selectedLeg}
        onChange={(v) => selectedLeg && setLegAnchor(selectedLeg.index, { x: v / 100 })} onCommit={() => commitHistory("Ancrage déplacé")} />
      <Field label="Position Z (droite)" unit="cm" value={(selectedLeg?.z ?? 0) * 100} disabled={!selectedLeg}
        onChange={(v) => selectedLeg && setLegAnchor(selectedLeg.index, { z: v / 100 })} onCommit={() => commitHistory("Ancrage déplacé")} />
      <Field label="Orientation" unit="°" value={selectedLeg?.yawDeg ?? 0} disabled={!selectedLeg}
        onChange={(v) => selectedLeg && setLegAnchor(selectedLeg.index, { yawDeg: v })} onCommit={() => commitHistory("Orientation patte")} />

      {/* Épaisseur des parties de patte (vue de dessus) — par patte sélectionnée */}
      <div className="r2d-section-title">
        {selectedLeg ? `Épaisseur — Patte ${selectedLeg.index}` : "Épaisseur de patte (sélectionnez une patte)"}
      </div>
      <Field label="Coxa" unit="cm" value={segW.coxa * 100} disabled={legIdx === null}
        onChange={(v) => legIdx !== null && setSegmentWidth(legIdx, "coxa", v / 100)} onCommit={() => commitHistory("Épaisseur coxa")} />
      <Field label="Fémur" unit="cm" value={segW.femur * 100} disabled={legIdx === null}
        onChange={(v) => legIdx !== null && setSegmentWidth(legIdx, "femur", v / 100)} onCommit={() => commitHistory("Épaisseur fémur")} />
      <Field label="Tibia" unit="cm" value={segW.tibia * 100} disabled={legIdx === null}
        onChange={(v) => legIdx !== null && setSegmentWidth(legIdx, "tibia", v / 100)} onCommit={() => commitHistory("Épaisseur tibia")} />
      <button type="button" className="btn btn-sm" disabled={legIdx === null}
        onClick={() => { if (legIdx !== null) { applySegmentWidthsToAll(legIdx); commitHistory("Épaisseur appliquée à toutes les pattes"); } }}>
        Appliquer aux autres pattes
      </button>

      {/* Hauteur de profil (vue de face) — par patte sélectionnée */}
      <div className="r2d-section-title">
        {selectedLeg ? `Hauteur de face — Patte ${selectedLeg.index}` : "Hauteur de face (sélectionnez une patte)"}
      </div>
      <Field label={`Coxa (${servoHcm.toFixed(1)}–${chassisHcm.toFixed(1)})`} unit="cm" value={coxaHcm} disabled={legIdx === null}
        onChange={(v) => legIdx !== null && setSegmentHeight(legIdx, "coxa", Math.min(chassisHcm, Math.max(servoHcm, v)) / 100)} onCommit={() => commitHistory("Hauteur coxa")} />
      <Field label="Fémur" unit="cm" value={segH.femur * 100} disabled={legIdx === null}
        onChange={(v) => legIdx !== null && setSegmentHeight(legIdx, "femur", v / 100)} onCommit={() => commitHistory("Hauteur fémur")} />
      <Field label="Tibia (genou)" unit="cm" value={tibiaKneeCm} disabled={legIdx === null}
        onChange={(v) => legIdx !== null && setSegmentHeight(legIdx, "tibia", v / 100)} onCommit={() => commitHistory("Hauteur tibia genou")} />
      <Field label="Tibia (pied)" unit="cm" value={segH.tibiaFoot * 100} disabled={legIdx === null}
        onChange={(v) => legIdx !== null && setSegmentHeight(legIdx, "tibiaFoot", v / 100)} onCommit={() => commitHistory("Hauteur tibia pied")} />
      <button type="button" className="btn btn-sm" disabled={legIdx === null}
        onClick={() => { if (legIdx !== null) { applySegmentHeightsToAll(legIdx); commitHistory("Hauteur appliquée à toutes les pattes"); } }}>
        Appliquer aux autres pattes
      </button>

      {/* Grille / affichage */}
      <div className="r2d-section-title">Grille & affichage</div>
      <label className="r2d-check">
        <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} />
        <span>Magnétisme</span>
      </label>
      <Field label="Pas magnétisme" unit="cm" value={snapStepCm} step={0.1} min={0.1}
        onChange={(v) => setSnapStepCm(v)} disabled={!snapEnabled} />
      <Field label="Pas clavier (flèches)" unit="cm" value={keyboardStepCm} step={0.01} min={0.001}
        onChange={(v) => setKeyboardStepCm(v)} />
      <label className="r2d-check">
        <input type="checkbox" checked={showServos} onChange={(e) => setShowServos(e.target.checked)} />
        <span>Afficher les servos</span>
      </label>

      {/* Actions */}
      <div className="r2d-section-title">Actions</div>
      <button type="button" className="btn btn-sm" onClick={handleResetAnchors}>Réinitialiser les ancrages</button>
      <button type="button" className="btn btn-sm" onClick={resetView}>Recentrer la vue</button>
    </div>
  );
}
