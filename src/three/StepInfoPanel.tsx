import { useState, useEffect, useRef } from 'react';
import { useSequencerStore } from '../store/useSequencerStore';
import { useHexapodStore } from '../store/useHexapodStore';
import { posesEqual } from '../store/stepEditGuard';
import type { Pose } from '../model/pose';

const MAX_LOCAL_HISTORY = 30;
const DEBOUNCE_MS = 600;

export function StepInfoPanel() {
  const steps = useSequencerStore((s) => s.steps);
  const selectedStepIndex = useSequencerStore((s) => s.selectedStepIndex);
  const autoApply = useSequencerStore((s) => s.autoApply);
  const step = selectedStepIndex >= 0 ? steps[selectedStepIndex] : null;

  const [editName, setEditName] = useState('');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Vrai quand la pose 3D live diffère de la pose stockée de l'étape (modif non appliquée).
  const [dirty, setDirty] = useState(false);

  // Historique local en mémoire — non persisté, réinitialisé à l'Appliquer
  const localHistory = useRef<Pose[]>([]);
  const localHistoryIdx = useRef(0);
  const isNavigating = useRef(false);   // évite d'enregistrer les navigations elles-mêmes
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync nom quand l'étape change
  useEffect(() => {
    if (step) setEditName(step.name);
  }, [step?.id, step?.name]);

  // Initialise l'historique local à chaque changement d'étape sélectionnée
  useEffect(() => {
    if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
    setDirty(false);
    if (!step) {
      localHistory.current = [];
      localHistoryIdx.current = 0;
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    localHistory.current = [step.pose.slice() as Pose];
    localHistoryIdx.current = 0;
    setCanUndo(false);
    setCanRedo(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);

  // Subscribe aux changements de pose du robot → état dirty + snapshots debounce
  useEffect(() => {
    if (!step) return;
    const stepId = step.id;
    const unsub = useHexapodStore.subscribe((state, prev) => {
      if (state.pose === prev.pose) return;   // pas de changement de pose
      // Dirty immédiat : la pose live diffère-t-elle de la pose stockée de l'étape ?
      const cur = useSequencerStore.getState().steps.find((s) => s.id === stepId);
      if (!cur) return;
      setDirty(!posesEqual(state.pose as Pose, cur.pose));
      if (isNavigating.current) return;       // navigation interne, pas d'historique
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        const pose = (useHexapodStore.getState().pose as Pose).slice() as Pose;
        const hist = localHistory.current;
        const idx = localHistoryIdx.current;
        const next = [...hist.slice(0, idx + 1), pose].slice(-MAX_LOCAL_HISTORY);
        localHistory.current = next;
        localHistoryIdx.current = next.length - 1;
        setCanUndo(next.length > 1);
        setCanRedo(false);
        // Enregistrement automatique : on applique à l'étape une fois la pose
        // stabilisée. Les étapes liées à une pose enregistrée sont exclues — le
        // lien doit être arbitré à la main via PoseConflictModal.
        const seq = useSequencerStore.getState();
        const fresh = seq.steps.find((s) => s.id === stepId);
        if (seq.autoApply && fresh && !fresh.sourcePoseId && !posesEqual(pose, fresh.pose)) {
          seq.updateStepPose(stepId, pose);
          setDirty(false);
        }
      }, DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (debounceTimer.current) { clearTimeout(debounceTimer.current); debounceTimer.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.id]);

  if (!step) return null;

  const handleNameBlur = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== step.name) {
      useSequencerStore.getState().updateStepName(step.id, trimmed);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') { setEditName(step.name); e.currentTarget.blur(); }
  };

  const handleUndo = () => {
    const idx = localHistoryIdx.current;
    if (idx <= 0) return;
    const newIdx = idx - 1;
    localHistoryIdx.current = newIdx;
    isNavigating.current = true;
    useHexapodStore.getState().applyPose(localHistory.current[newIdx]);
    isNavigating.current = false;
    setCanUndo(newIdx > 0);
    setCanRedo(true);
  };

  const handleRedo = () => {
    const idx = localHistoryIdx.current;
    const hist = localHistory.current;
    if (idx >= hist.length - 1) return;
    const newIdx = idx + 1;
    localHistoryIdx.current = newIdx;
    isNavigating.current = true;
    useHexapodStore.getState().applyPose(hist[newIdx]);
    isNavigating.current = false;
    setCanUndo(true);
    setCanRedo(newIdx < hist.length - 1);
  };

  const handleSavePose = (e: React.MouseEvent<HTMLButtonElement>) => {
    const pose = useHexapodStore.getState().pose;
    // Si le step est lié à une pose enregistrée, requestStepPoseUpdate lève
    // un PendingPoseConflict que l'utilisateur arbitre via le modal.
    useSequencerStore.getState().requestStepPoseUpdate(step.id, pose);
    // Réinitialise l'historique local à la pose enregistrée
    localHistory.current = [(pose as Pose).slice() as Pose];
    localHistoryIdx.current = 0;
    setCanUndo(false);
    setCanRedo(false);
    setDirty(false);
    e.currentTarget.focus();
  };

  const handleDeselect = () => {
    // Revient à la pose enregistrée de l'étape (abandonne les modifs en cours)
    // puis désélectionne — l'utilisateur retrouve une scène « propre ».
    useHexapodStore.getState().applyPose(step.pose);
    useSequencerStore.getState().setSelectedStepIndex(-1);
  };

  const handleAutoApplyChange = (checked: boolean) => {
    useSequencerStore.getState().setAutoApply(checked);
    if (!checked || !step) return;
    // En activant l'option, on applique immédiatement une modif déjà en attente
    // (sauf étape liée, arbitrée à la main).
    const live = (useHexapodStore.getState().pose as Pose).slice() as Pose;
    const cur = useSequencerStore.getState().steps.find((s) => s.id === step.id);
    if (cur && !cur.sourcePoseId && !posesEqual(live, cur.pose)) {
      useSequencerStore.getState().updateStepPose(step.id, live);
      setDirty(false);
    }
  };

  return (
    <div className={`step-info-panel${dirty ? " step-info-panel--dirty" : ""}`}>
      <div className="step-info-kind">
        Étape sélectionnée
        {dirty && <span className="step-info-dirty"> · ● modifié</span>}
      </div>
      <input
        className="step-info-name"
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        onBlur={handleNameBlur}
        onKeyDown={handleNameKeyDown}
        title="Cliquer pour renommer l'étape"
        spellCheck={false}
      />
      <div className="step-info-actions">
        <button
          type="button"
          className="step-info-btn"
          onClick={handleUndo}
          disabled={!canUndo}
          title="Poser précédente"
        >
          ←
        </button>
        <button
          type="button"
          className="step-info-btn"
          onClick={handleRedo}
          disabled={!canRedo}
          title="Pose suivante"
        >
          →
        </button>
        <button
          type="button"
          className="step-info-btn step-info-btn-save"
          onClick={(e) => handleSavePose(e)}
          disabled={!dirty}
          title={dirty ? 'Enregistrer la pose 3D actuelle dans cette étape' : 'Aucune modification à appliquer'}
        >
          Appliquer
        </button>
      </div>
      <label
        className="step-info-autosave"
        title="Appliquer automatiquement les modifications à l'étape, sans cliquer sur Appliquer"
      >
        <input
          type="checkbox"
          checked={autoApply}
          onChange={(e) => handleAutoApplyChange(e.target.checked)}
        />
        <span>Enregistrer automatiquement</span>
      </label>
      <button
        type="button"
        className="step-info-deselect"
        onClick={handleDeselect}
        title="Revenir à la pose enregistrée de l'étape et désélectionner"
      >
        Annuler la sélection
      </button>
    </div>
  );
}
