import { useState, useEffect, useRef } from 'react';
import { useSequencerStore } from '../store/useSequencerStore';
import { useHexapodStore } from '../store/useHexapodStore';
import type { Pose } from '../model/pose';

const MAX_LOCAL_HISTORY = 30;
const DEBOUNCE_MS = 600;

export function StepInfoPanel() {
  const steps = useSequencerStore((s) => s.steps);
  const selectedStepIndex = useSequencerStore((s) => s.selectedStepIndex);
  const step = selectedStepIndex >= 0 ? steps[selectedStepIndex] : null;

  const [editName, setEditName] = useState('');
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

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

  // Subscribe aux changements de pose du robot → snapshots debounce
  useEffect(() => {
    if (!step) return;
    const unsub = useHexapodStore.subscribe((state, prev) => {
      if (state.pose === prev.pose) return;   // pas de changement de pose
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
    useSequencerStore.getState().updateStepPose(step.id, pose);
    // Réinitialise l'historique local à la pose enregistrée
    localHistory.current = [(pose as Pose).slice() as Pose];
    localHistoryIdx.current = 0;
    setCanUndo(false);
    setCanRedo(false);
    e.currentTarget.focus();
  };

  return (
    <div className="step-info-panel">
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
          title="Enregistrer la pose 3D actuelle dans cette étape"
        >
          Appliquer
        </button>
      </div>
    </div>
  );
}
