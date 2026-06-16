import { useEffect, useMemo, useState } from "react";
import { LEG_NAMES, computeLegMounts, defaultAnchorsFromGeometry, type Body2D, type LegLayout } from "../model/hexapod";
import { findServoType } from "../model/servoTypes";
import {
  DEFAULT_SERVO_CALIB,
  useHexapodStore,
  type ServoCalibration,
  type WeightConfig,
} from "../store/useHexapodStore";
import { useProjectStore } from "../store/useProjectStore";
import { SERVO_CONTROLLER_CATALOG } from "../model/servoControllers";
import { COMMAND_ELECTRONICS_CATALOG } from "../model/commandElectronics";
import { DEFAULT_COLLISION_PREFS, type CollisionPrefs } from "../model/collisions";
import { useProfilesStore } from "../store/useProfilesStore";
import { useToastStore } from "../store/useToastStore";
import { useSavedSequencesStore } from "../store/useSavedSequencesStore";
import { useSavedPosesStore } from "../store/useSavedPosesStore";
import { useSequencerStore } from "../store/useSequencerStore";
import {
  generateGait,
  gaitSequenceName,
  stabilityLevel,
  STABILITY_LABELS,
  type GaitType,
} from "../model/gaitGenerator";
import { Modal } from "./Modal";
import { LegLayoutPicker } from "./LegLayoutPicker";

type Tab = "general" | "servos" | "collisions" | "sequences";

const JOINTS = ["coxa", "femur", "tibia"] as const;
const JOINT_LABELS: Record<string, string> = { coxa: "Coxa", femur: "Fémur", tibia: "Tibia" };

// ── Calibration d'un servo ───────────────────────────────────────────────────

function ServoCalibBlock({
  joint,
  calib,
  onChange,
}: {
  joint: string;
  calib: ServoCalibration;
  onChange: (field: keyof ServoCalibration, value: number | boolean) => void;
}) {
  return (
    <div className="servo-calib-block">
      <div className="scb-joint-label">{JOINT_LABELS[joint]}</div>

      <div className="scb-row">
        <span className="scb-label">Offset zéro</span>
        <div className="scb-inputs">
          <input
            className="scb-num-input"
            type="number"
            step={1}
            min={-180}
            max={180}
            aria-label={`Offset zéro ${JOINT_LABELS[joint]}`}
            value={calib.zeroOffsetDeg}
            onChange={(e) => onChange("zeroOffsetDeg", parseFloat(e.target.value) || 0)}
          />
          <span className="scb-unit">°</span>
        </div>
      </div>

      <div className="scb-row">
        <span className="scb-label">Limites physiques</span>
        <div className="scb-inputs">
          <input className="scb-num-input" type="number" step={1}
            aria-label={`Limite physique min ${JOINT_LABELS[joint]}`}
            value={calib.hardMinDeg}
            onChange={(e) => onChange("hardMinDeg", parseFloat(e.target.value) || 0)} />
          <span className="scb-arrow">→</span>
          <input className="scb-num-input" type="number" step={1}
            aria-label={`Limite physique max ${JOINT_LABELS[joint]}`}
            value={calib.hardMaxDeg}
            onChange={(e) => onChange("hardMaxDeg", parseFloat(e.target.value) || 0)} />
          <span className="scb-unit">°</span>
        </div>
      </div>

      <div className="scb-row">
        <span className="scb-label">Limites logicielles</span>
        <div className="scb-inputs">
          <input className="scb-num-input" type="number" step={1}
            min={calib.hardMinDeg} max={calib.hardMaxDeg}
            aria-label={`Limite logicielle min ${JOINT_LABELS[joint]}`}
            value={calib.softMinDeg}
            onChange={(e) => onChange("softMinDeg", parseFloat(e.target.value) || 0)} />
          <span className="scb-arrow">→</span>
          <input className="scb-num-input" type="number" step={1}
            min={calib.hardMinDeg} max={calib.hardMaxDeg}
            aria-label={`Limite logicielle max ${JOINT_LABELS[joint]}`}
            value={calib.softMaxDeg}
            onChange={(e) => onChange("softMaxDeg", parseFloat(e.target.value) || 0)} />
          <span className="scb-unit">°</span>
        </div>
      </div>

      <div className="scb-row">
        <span className="scb-label">Inversé</span>
        <label className="scb-invert-label">
          <input
            type="checkbox"
            checked={calib.invert}
            onChange={(e) => onChange("invert", e.target.checked)}
          />
          <span>{calib.invert ? "Oui" : "Non"}</span>
        </label>
      </div>
    </div>
  );
}

// ── Bloc Poids (intégré dans l'onglet Général) ─────────────────────────────

interface WeightBlockProps {
  weightConfig: WeightConfig;
  onChange: (cfg: WeightConfig) => void;
  servoCount: number;
}

export function WeightBlock({ weightConfig, onChange, servoCount }: WeightBlockProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const hardware = activeProject?.hardware;

  const selectedServo = hardware?.servoTypeId
    ? findServoType(hardware.servoTypeId, hardware.customServoTypes)
    : null;
  const selectedController = SERVO_CONTROLLER_CATALOG.find(
    (c) => c.id === hardware?.servoControllerId
  );
  const selectedCommand = COMMAND_ELECTRONICS_CATALOG.find(
    (c) => c.id === hardware?.commandElectronicsId
  );

  const canEstimate = !!(
    weightConfig.emptyWeightG !== undefined || weightConfig.totalWeightG !== undefined
  );

  const handleEstimate = () => {
    const servoWeightG = (selectedServo?.weightG ?? 0) * servoCount;
    const controllerWeightG = selectedController?.weightG ?? 0;
    const commandWeightG = selectedCommand?.weightG ?? 0;
    const electronicsWeightG = servoWeightG + controllerWeightG + commandWeightG;

    if (weightConfig.emptyWeightG !== undefined && weightConfig.totalWeightG === undefined) {
      onChange({
        ...weightConfig,
        totalWeightG: Math.round(weightConfig.emptyWeightG + electronicsWeightG),
      });
    } else if (weightConfig.totalWeightG !== undefined && weightConfig.emptyWeightG === undefined) {
      onChange({
        ...weightConfig,
        emptyWeightG: Math.max(0, Math.round(weightConfig.totalWeightG - electronicsWeightG)),
      });
    } else if (
      weightConfig.emptyWeightG !== undefined &&
      weightConfig.totalWeightG !== undefined
    ) {
      onChange({
        ...weightConfig,
        totalWeightG: Math.round(weightConfig.emptyWeightG + electronicsWeightG),
      });
    }
  };

  const estimateHint = useMemo(() => {
    const parts: string[] = [];
    if (selectedServo?.weightG) parts.push(`${servoCount}× servos : ${(selectedServo.weightG * servoCount).toFixed(0)} g`);
    if (selectedController?.weightG) parts.push(`contrôleur : ${selectedController.weightG} g`);
    if (selectedCommand?.weightG) parts.push(`commande : ${selectedCommand.weightG} g`);
    if (parts.length === 0) return "Définissez le matériel dans les paramètres du projet pour estimer";
    return "Base : " + parts.join(" + ");
  }, [selectedServo, selectedController, selectedCommand, servoCount]);

  return (
    <div className="hw-section">
      <div className="hw-section-title">Poids du robot</div>

      <div className="hw-weight-grid">
        <label className="hw-field">
          <span className="hw-label">Poids à vide</span>
          <span className="hw-sublabel">Squelette hors servomoteurs</span>
          <div className="hw-input-row">
            <input
              className="hw-num-input"
              type="number"
              min={0}
              step={1}
              placeholder="—"
              value={weightConfig.emptyWeightG ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? undefined : parseFloat(e.target.value);
                onChange({ ...weightConfig, emptyWeightG: v });
              }}
            />
            <span className="hw-unit">g</span>
          </div>
        </label>

        <label className="hw-field">
          <span className="hw-label">Poids total embarqué</span>
          <span className="hw-sublabel">Squelette + servos + électronique (hors batterie)</span>
          <div className="hw-input-row">
            <input
              className="hw-num-input"
              type="number"
              min={0}
              step={1}
              placeholder="—"
              value={weightConfig.totalWeightG ?? ""}
              onChange={(e) => {
                const v = e.target.value === "" ? undefined : parseFloat(e.target.value);
                onChange({ ...weightConfig, totalWeightG: v });
              }}
            />
            <span className="hw-unit">g</span>
          </div>
        </label>
      </div>

      <div className="hw-estimate-row">
        <span className="hw-estimate-hint">{estimateHint}</span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!canEstimate}
          onClick={handleEstimate}
          title="Calcule la valeur manquante depuis le matériel du projet"
        >
          Estimer
        </button>
      </div>
    </div>
  );
}

// ── Modal principale ─────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ProfileSettingsModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("general");
  const [localName, setLocalName] = useState("");
  const [localDesc, setLocalDesc] = useState("");
  const [localLegLayout, setLocalLegLayout] = useState<LegLayout>("star");
  const [calibration, setCalibration] = useState<Record<number, ServoCalibration>>({});
  const [expandedLegs, setExpandedLegs] = useState<Set<number>>(new Set());
  const [localCollisionPrefs, setLocalCollisionPrefs] = useState<CollisionPrefs>({ ...DEFAULT_COLLISION_PREFS });
  const [localWeightConfig, setLocalWeightConfig] = useState<WeightConfig>({});
  const [saving, setSaving] = useState(false);

  // Sequences tab state
  const [showGenerator, setShowGenerator] = useState(false);
  const [selectedGaits, setSelectedGaits] = useState<Set<GaitType>>(new Set(["tripod"]));
  const [genStepFraction, setGenStepFraction] = useState(0.6);
  const [genLiftFraction, setGenLiftFraction] = useState(0.5);
  const [genUseSoft, setGenUseSoft] = useState(true);
  // Pose de base choisie pour la stance de la démarche ("" = stance intégrée).
  const [genBasePoseId, setGenBasePoseId] = useState("");
  const [generating, setGenerating] = useState(false);

  const activeProfileId = useProfilesStore((s) => s.activeProfileId);
  const profiles = useProfilesStore((s) => s.profiles);
  const rename = useProfilesStore((s) => s.rename);
  const update = useProfilesStore((s) => s.update);

  const storeDescription = useHexapodStore((s) => s.description);
  const storeCalibration = useHexapodStore((s) => s.servoCalibration);
  const storeGeometry = useHexapodStore((s) => s.geometry);
  const storeCollisionPrefs = useHexapodStore((s) => s.collisionPrefs);
  const storeWeightConfig = useHexapodStore((s) => s.weightConfig);
  const setDescription = useHexapodStore((s) => s.setDescription);
  const setServoCalibrationAll = useHexapodStore((s) => s.setServoCalibrationAll);
  const setCollisionPrefs = useHexapodStore((s) => s.setCollisionPrefs);
  const setGeometry = useHexapodStore((s) => s.setGeometry);
  const setWeightConfigStore = useHexapodStore((s) => s.setWeightConfig);

  const showToast = useToastStore((s) => s.show);

  const savedPoses = useSavedPosesStore((s) => s.poses);
  const basePoses = useMemo(() => savedPoses.filter((p) => p.isBase), [savedPoses]);
  const genBasePose = useMemo(
    () => basePoses.find((p) => p.id === genBasePoseId)?.angles,
    [basePoses, genBasePoseId]
  );

  const sequences = useSavedSequencesStore((s) => s.sequences);
  const sequencesLoading = useSavedSequencesStore((s) => s.loading);
  const listSequences = useSavedSequencesStore((s) => s.list);
  const saveSequence = useSavedSequencesStore((s) => s.save);
  const removeSequence = useSavedSequencesStore((s) => s.remove);
  const loadSequenceById = useSavedSequencesStore((s) => s.load);
  const loadSteps = useSequencerStore((s) => s.loadSteps);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

  useEffect(() => {
    if (!open) return;
    setTab("general");
    setLocalName(activeProfile?.name ?? "");
    setLocalDesc(storeDescription);
    setLocalLegLayout(storeGeometry.legLayout ?? "star");
    setCalibration({ ...storeCalibration });
    setLocalCollisionPrefs({ ...storeCollisionPrefs });
    setLocalWeightConfig({ ...storeWeightConfig });
    setExpandedLegs(new Set());
    setShowGenerator(false);
    setSelectedGaits(new Set(["tripod"]));
    setGenStepFraction(0.6);
    setGenLiftFraction(0.5);
    setGenUseSoft(true);
    setGenBasePoseId("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open && tab === "sequences") {
      listSequences();
      // Charge les poses pour proposer une « pose de base » au générateur.
      useSavedPosesStore.getState().list().catch(() => {});
    }
  }, [open, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCalibChange = (
    servoId: number,
    field: keyof ServoCalibration,
    value: number | boolean
  ) => {
    setCalibration((prev) => ({
      ...prev,
      [servoId]: { ...(prev[servoId] ?? DEFAULT_SERVO_CALIB), [field]: value },
    }));
  };

  const toggleLeg = (leg: number) =>
    setExpandedLegs((prev) => {
      const next = new Set(prev);
      if (next.has(leg)) next.delete(leg);
      else next.add(leg);
      return next;
    });

  // Per-gait: minimum stability score across all steps (worst case = bottleneck)
  const stabilityPreview = useMemo((): Partial<Record<GaitType, number>> => {
    if (!showGenerator) return {};
    const mounts = computeLegMounts(storeGeometry);
    const result: Partial<Record<GaitType, number>> = {};
    for (const gt of (["tripod", "ripple", "wave"] as GaitType[])) {
      if (selectedGaits.has(gt)) {
        const { stabilityScores } = generateGait({
          geometry: storeGeometry,
          legMounts: mounts,
          calibration,
          gaitType: gt,
          stepFraction: genStepFraction,
          liftFraction: genLiftFraction,
          useSoftLimits: genUseSoft,
          basePose: genBasePose,
        });
        result[gt] = Math.min(...stabilityScores);
      }
    }
    return result;
  }, [showGenerator, selectedGaits, genStepFraction, genLiftFraction, genUseSoft, storeGeometry, calibration, genBasePose]);

  const handleLoadSequence = async (id: string) => {
    const seq = await loadSequenceById(id);
    loadSteps(seq.steps, seq.name);
    onClose();
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const mounts = computeLegMounts(storeGeometry);
      let lastSeq: Awaited<ReturnType<typeof saveSequence>> | undefined;
      for (const gt of selectedGaits) {
        const { steps } = generateGait({
          geometry: storeGeometry,
          legMounts: mounts,
          calibration,
          gaitType: gt,
          stepFraction: genStepFraction,
          liftFraction: genLiftFraction,
          useSoftLimits: genUseSoft,
          basePose: genBasePose,
        });
        lastSeq = await saveSequence(gaitSequenceName(gt, activeProfile?.name), steps);
      }
      // Charge la dernière séquence générée dans le séquenceur : `save()` la rend
      // active mais ne pousse pas ses étapes ; sans ça la grille reste vide (le
      // <select> pointe déjà dessus → re-sélectionner ne déclenche pas onChange).
      if (lastSeq) loadSteps(lastSeq.steps, lastSeq.name);
      setShowGenerator(false);
      await listSequences();
      showToast(`${selectedGaits.size} séquence(s) générée(s)`);
    } catch {
      showToast("Erreur lors de la génération");
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (activeProfileId && localName.trim() && localName !== activeProfile?.name) {
        await rename(activeProfileId, localName.trim());
      }
      setDescription(localDesc);
      // Le picker star/linear est un préréglage : changer la disposition
      // régénère les ancrages 2D (sinon, avec des ancrages présents,
      // computeLegMounts les ignorerait et le picker n'aurait aucun effet).
      const layoutChanged = localLegLayout !== (storeGeometry.legLayout ?? "star");
      setGeometry({ legLayout: localLegLayout });
      if (layoutChanged) {
        const g = useHexapodStore.getState().geometry;
        const body2D: Body2D = {
          version: 1,
          outline: g.body2D?.outline ?? { length: g.chassis.length, width: g.chassis.width },
          points: g.body2D?.points ?? null,
          servoMarkers: g.body2D?.servoMarkers,
          anchors: defaultAnchorsFromGeometry(g),
        };
        setGeometry({ body2D });
      }
      setServoCalibrationAll(calibration);
      setCollisionPrefs(localCollisionPrefs);
      setWeightConfigStore(localWeightConfig);
      if (activeProfileId) {
        await update(activeProfileId);
        showToast("Paramètres enregistrés");
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} className="modal-wide">
      <h3 className="modal-title">Paramètres de la base mécanique</h3>

      <div className="settings-layout">
        <nav className="settings-tabs">
          <button
            type="button"
            className={`settings-tab${tab === "general" ? " active" : ""}`}
            onClick={() => setTab("general")}
          >
            Général
          </button>
          <button
            type="button"
            className={`settings-tab${tab === "servos" ? " active" : ""}`}
            onClick={() => setTab("servos")}
          >
            Servo-Moteurs
          </button>
          <button
            type="button"
            className={`settings-tab${tab === "collisions" ? " active" : ""}`}
            onClick={() => setTab("collisions")}
          >
            Collisions
          </button>
          <button
            type="button"
            className={`settings-tab${tab === "sequences" ? " active" : ""}`}
            onClick={() => setTab("sequences")}
          >
            Séquences
          </button>
        </nav>

        <div className="settings-content">
          {/* Tab Général */}
          {tab === "general" && (
            <div className="modal-form">
              <label className="modal-field">
                <span>Nom de la base mécanique</span>
                <input
                  type="text"
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                  placeholder="ex : Hexapode v1"
                />
              </label>
              <label className="modal-field">
                <span>Description</span>
                <textarea
                  className="settings-textarea"
                  rows={3}
                  value={localDesc}
                  onChange={(e) => setLocalDesc(e.target.value)}
                  placeholder="Notes sur cette base mécanique (configuration, notes de calibration…)"
                />
              </label>

              <div className="modal-field">
                <span>Position des pattes</span>
                <span className="hint">
                  Préréglage rapide — appliqué à l&apos;enregistrement, il réinitialise
                  les ancrages dessinés dans l&apos;onglet Robot 2D.
                </span>
                <LegLayoutPicker value={localLegLayout} onChange={setLocalLegLayout} />
              </div>

              <WeightBlock
                weightConfig={localWeightConfig}
                onChange={setLocalWeightConfig}
                servoCount={18}
              />
            </div>
          )}

          {/* Tab Servo-Moteurs */}
          {tab === "servos" && (
            <div className="servos-tab">
              <div className="servos-hint">
                Le modèle de servo-moteur global et l&apos;électronique sont définis au niveau
                du projet (menu Projet → Paramètres). Cet onglet ne sert qu&apos;à configurer
                la calibration de chaque articulation.
              </div>

              <div className="servos-section">
                <div className="servos-section-title">Configuration par patte</div>
                <div className="leg-calib-sections">
                  {Array.from({ length: 6 }, (_, legIndex) => {
                    const expanded = expandedLegs.has(legIndex);
                    return (
                      <div key={legIndex} className="leg-accordion">
                        <button
                          type="button"
                          className="leg-accordion-header"
                          onClick={() => toggleLeg(legIndex)}
                        >
                          <span className="leg-index-badge">{legIndex}</span>
                          {LEG_NAMES[legIndex]}
                          <span className="leg-accordion-caret">{expanded ? "▲" : "▼"}</span>
                        </button>
                        {expanded && (
                          <div className="leg-accordion-content">
                            {JOINTS.map((joint, ji) => {
                              const servoId = legIndex * 3 + ji;
                              const calib = calibration[servoId] ?? DEFAULT_SERVO_CALIB;
                              return (
                                <ServoCalibBlock
                                  key={joint}
                                  joint={joint}
                                  calib={calib}
                                  onChange={(field, val) => handleCalibChange(servoId, field, val)}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Tab Collisions */}
          {tab === "collisions" && (
            <div className="collision-prefs-tab">
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={localCollisionPrefs.enabled}
                  onChange={(e) => setLocalCollisionPrefs((p) => ({ ...p, enabled: e.target.checked }))}
                />
                <span>Activer l&apos;affichage des collisions</span>
                <span className="hint">
                  {localCollisionPrefs.enabled
                    ? "Les segments en collision s'affichent en rouge"
                    : "Détection désactivée"}
                </span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={localCollisionPrefs.includeBody}
                  onChange={(e) => setLocalCollisionPrefs((p) => ({ ...p, includeBody: e.target.checked }))}
                />
                <span>Corps et pattes</span>
                <span className="hint">
                  {localCollisionPrefs.includeBody
                    ? "Détecte aussi les collisions entre les pattes et le châssis"
                    : "Uniquement les collisions entre pattes"}
                </span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={localCollisionPrefs.showArrow}
                  onChange={(e) => setLocalCollisionPrefs((p) => ({ ...p, showArrow: e.target.checked }))}
                />
                <span>Flèche de marquage</span>
                <span className="hint">
                  {localCollisionPrefs.showArrow
                    ? "Affiche une flèche 3D pointant vers le centre de collision"
                    : "Pas de flèche de marquage"}
                </span>
              </label>
            </div>
          )}

          {/* Tab Séquences */}
          {tab === "sequences" && (
            <div className="sequences-tab">
              {!showGenerator ? (
                <>
                  <div className="sequences-list">
                    {sequencesLoading ? (
                      <div className="seq-empty">Chargement…</div>
                    ) : sequences.length === 0 ? (
                      <div className="seq-empty">Aucune séquence enregistrée</div>
                    ) : (
                      sequences.map((seq) => (
                        <div key={seq.id} className="seq-row">
                          <div className="seq-info">
                            <span className="seq-name">{seq.name}</span>
                          </div>
                          <div className="seq-actions">
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => handleLoadSequence(seq.id)}
                            >
                              Charger
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => removeSequence(seq.id)}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setShowGenerator(true)}
                  >
                    Générer une démarche…
                  </button>
                </>
              ) : (
                <div className="gait-generator">
                  <div className="ggt-title">Générer une démarche de marche</div>

                  <div className="ggt-section">
                    <div className="ggt-section-label">Type de démarche</div>
                    <div className="ggt-checkboxes">
                      {(["tripod", "ripple", "wave"] as GaitType[]).map((gt) => (
                        <label key={gt} className="ggt-check-label">
                          <input
                            type="checkbox"
                            checked={selectedGaits.has(gt)}
                            onChange={(e) => {
                              setSelectedGaits((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(gt);
                                else next.delete(gt);
                                return next;
                              });
                            }}
                          />
                          {gt === "tripod" ? "Tripod — 4 étapes (2 groupes alternés)" :
                           gt === "ripple" ? "Ripple — 6 étapes (3 paires diagonales)" :
                           "Wave — 6 étapes (séquentiel patte par patte)"}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="ggt-section">
                    <div className="ggt-section-label">Pose de base (stance)</div>
                    <select
                      className="ggt-base-select"
                      value={genBasePoseId}
                      onChange={(e) => setGenBasePoseId(e.target.value)}
                      aria-label="Pose de base pour la démarche"
                    >
                      <option value="">Stance intégrée (fémur −20°, tibia −60°)</option>
                      {basePoses.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <div className="ggt-base-hint">
                      {basePoses.length === 0
                        ? "Astuce : marquez une pose comme « base » (★) dans Conception → Poses pour l'utiliser ici."
                        : "La démarche partira de cette posture d'appui (par patte) au lieu de la stance intégrée."}
                    </div>
                  </div>

                  <div className="ggt-section">
                    <div className="ggt-section-label">Paramètres</div>
                    <div className="ggt-slider-row">
                      <span className="ggt-slider-label">Amplitude de pas</span>
                      <input
                        type="range"
                        className="ggt-slider"
                        aria-label="Amplitude de pas"
                        min={10} max={100} step={5}
                        value={Math.round(genStepFraction * 100)}
                        onChange={(e) => setGenStepFraction(parseInt(e.target.value) / 100)}
                      />
                      <span className="ggt-slider-value">{Math.round(genStepFraction * 100)}%</span>
                    </div>
                    <div className="ggt-slider-row">
                      <span className="ggt-slider-label">Hauteur de levée</span>
                      <input
                        type="range"
                        className="ggt-slider"
                        aria-label="Hauteur de levée"
                        min={10} max={100} step={5}
                        value={Math.round(genLiftFraction * 100)}
                        onChange={(e) => setGenLiftFraction(parseInt(e.target.value) / 100)}
                      />
                      <span className="ggt-slider-value">{Math.round(genLiftFraction * 100)}%</span>
                    </div>
                    <div className="ggt-limits-row">
                      <span className="ggt-slider-label">Limites</span>
                      <label>
                        <input
                          type="radio"
                          name="gen-limits"
                          checked={genUseSoft}
                          onChange={() => setGenUseSoft(true)}
                        />
                        Logicielles
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="gen-limits"
                          checked={!genUseSoft}
                          onChange={() => setGenUseSoft(false)}
                        />
                        Physiques
                      </label>
                    </div>
                  </div>

                  {selectedGaits.size > 0 && (
                    <div className="ggt-section">
                      <div className="ggt-section-label">Stabilité statique (pire étape)</div>
                      <div className="ggt-preview">
                        {(["tripod", "ripple", "wave"] as GaitType[]).filter((gt) => selectedGaits.has(gt)).map((gt) => {
                          const score = stabilityPreview[gt] ?? -1;
                          const lvl = stabilityLevel(score);
                          const needlePct = Math.max(0, Math.min(100, (score + 1) / 2 * 100));
                          return (
                            <div key={gt} className="ggt-preview-row">
                              <span className="ggt-preview-gait">{gt.charAt(0).toUpperCase() + gt.slice(1)}</span>
                              <div className="ggt-stability-bar-wrap">
                                <div className="ggt-stability-bar">
                                  <div className="ggt-sz ggt-sz-0">Danger</div>
                                  <div className="ggt-sz ggt-sz-1">(−)</div>
                                  <div className="ggt-sz ggt-sz-2">Moyenne</div>
                                  <div className="ggt-sz ggt-sz-3">(+)</div>
                                  <div className="ggt-sz ggt-sz-4">Parfait</div>
                                  <div
                                    className="ggt-stability-needle"
                                    style={{ "--needle-pos": `${needlePct}%` } as React.CSSProperties}
                                    title={`Score : ${score.toFixed(2)} — ${STABILITY_LABELS[lvl]}`}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {(["tripod", "ripple", "wave"] as GaitType[]).some(
                          (gt) => selectedGaits.has(gt) && stabilityLevel(stabilityPreview[gt] ?? -1) < 2
                        ) && (
                          <div className="ggt-warning-note">
                            Stabilité faible — réduire l&apos;amplitude ou déplacer le CoG dans la géométrie.
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="ggt-actions">
                    <button type="button" className="btn" onClick={() => setShowGenerator(false)}>
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={selectedGaits.size === 0 || generating}
                      onClick={handleGenerate}
                    >
                      {generating
                        ? "Génération…"
                        : `Générer${selectedGaits.size > 1 ? ` (${selectedGaits.size})` : ""}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="modal-actions settings-modal-actions">
        <button type="button" className="btn" onClick={onClose}>Annuler</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </Modal>
  );
}
