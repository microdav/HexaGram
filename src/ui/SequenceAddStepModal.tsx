import { useEffect, useState } from 'react';
import { useSequencerStore, type SequencerStep } from '../store/useSequencerStore';
import { useSavedSequencesStore } from '../store/useSavedSequencesStore';
import { useHexapodStore } from '../store/useHexapodStore';
import { defaultPose } from '../model/pose';
import { PoseThumbnail } from './PoseThumbnail';

type View = 'menu' | 'sequences' | 'steps';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Vue d'ouverture (défaut « menu ») : « sequences » ouvre directement l'import. */
  initialView?: View;
}

export function SequenceAddStepModal({ open, onClose, initialView = 'menu' }: Props) {
  const [view, setView] = useState<View>(initialView);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pickedSteps, setPickedSteps] = useState<SequencerStep[]>([]);
  const [pickedName, setPickedName] = useState('');

  const sequences = useSavedSequencesStore((s) => s.sequences);
  const activeSequenceId = useSavedSequencesStore((s) => s.activeSequenceId);
  const steps = useSequencerStore((s) => s.steps);
  const definedSteps = steps.filter((st) => !st.type || st.type === 'defined');
  const lastDefined = definedSteps[definedSteps.length - 1];
  // Importer une étape concerne « une autre séquence » : on masque l'active.
  const otherSequences = sequences.filter((sq) => sq.id !== activeSequenceId);

  // Réinitialise sur (ré)ouverture.
  useEffect(() => {
    if (open) {
      setView(initialView);
      setError('');
      setPickedSteps([]);
      setPickedName('');
      setLoading(false);
    }
  }, [open, initialView]);

  if (!open) return null;

  const close = () => onClose();

  const addCurrent = () => {
    useSequencerStore.getState().addStep(useHexapodStore.getState().pose, undefined, null);
    close();
  };

  const addNeutral = () => {
    useSequencerStore.getState().addStep(defaultPose(), undefined, null);
    close();
  };

  const duplicateLast = () => {
    if (!lastDefined) return;
    useSequencerStore.getState().duplicateStep(lastDefined.id);
    close();
  };

  const pickSequence = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const seq = await useSavedSequencesStore.getState().getSequence(id);
      const defined = seq.steps.filter((st) => !st.type || st.type === 'defined');
      setPickedSteps(defined);
      setPickedName(seq.name);
      setView('steps');
    } catch {
      setError('Impossible de charger cette séquence.');
    } finally {
      setLoading(false);
    }
  };

  const pickStep = (step: SequencerStep) => {
    useSequencerStore.getState().addStep(step.pose, step.name, step.sourcePoseId ?? null);
    close();
  };

  return (
    <div className="seq-modal-backdrop" onClick={close}>
      <div className="seq-modal seq-addstep-modal" onClick={(e) => e.stopPropagation()}>
        {view === 'menu' && (
          <>
            <div className="seq-modal-title">Ajouter une étape</div>
            <div className="seq-addstep-choices">
              <button type="button" className="seq-addstep-choice" onClick={addCurrent}>
                <span className="seq-addstep-choice-icon">◉</span>
                <span className="seq-addstep-choice-title">État courant</span>
                <span className="seq-addstep-choice-desc">Capture la pose actuelle du robot 3D.</span>
              </button>
              <button type="button" className="seq-addstep-choice" onClick={addNeutral}>
                <span className="seq-addstep-choice-icon">⊕</span>
                <span className="seq-addstep-choice-title">Étape neutre</span>
                <span className="seq-addstep-choice-desc">Une nouvelle étape avec la pose par défaut.</span>
              </button>
              <button
                type="button"
                className="seq-addstep-choice"
                onClick={duplicateLast}
                disabled={!lastDefined}
                title={lastDefined ? undefined : 'Aucune étape à dupliquer'}
              >
                <span className="seq-addstep-choice-icon">⧉</span>
                <span className="seq-addstep-choice-title">Dupliquer la dernière</span>
                <span className="seq-addstep-choice-desc">Copie la dernière étape de la séquence.</span>
              </button>
              <button
                type="button"
                className="seq-addstep-choice"
                onClick={() => { setError(''); setView('sequences'); }}
              >
                <span className="seq-addstep-choice-icon">↧</span>
                <span className="seq-addstep-choice-title">Importer une étape</span>
                <span className="seq-addstep-choice-desc">Reprendre une étape d'une autre séquence.</span>
              </button>
            </div>
            <div className="seq-modal-actions">
              <button type="button" className="seq-modal-btn" onClick={close}>Annuler</button>
            </div>
          </>
        )}

        {view === 'sequences' && (
          <>
            <div className="seq-modal-title">Choisir une séquence</div>
            {error && <div className="seq-modal-error">{error}</div>}
            {loading ? (
              <div className="picker-msg">Chargement…</div>
            ) : otherSequences.length === 0 ? (
              <div className="picker-msg">Aucune autre séquence enregistrée.</div>
            ) : (
              <div className="seq-picker-list">
                {otherSequences.map((sq) => (
                  <button
                    key={sq.id}
                    type="button"
                    className="seq-picker-item"
                    onClick={() => pickSequence(sq.id)}
                  >
                    <span className="seq-picker-item-name">{sq.name}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="seq-modal-actions">
              <button type="button" className="seq-modal-btn" onClick={() => setView('menu')}>‹ Retour</button>
            </div>
          </>
        )}

        {view === 'steps' && (
          <>
            <div className="seq-modal-title">Étape de « {pickedName} »</div>
            {pickedSteps.length === 0 ? (
              <div className="picker-msg">Cette séquence ne contient aucune étape.</div>
            ) : (
              <div className="seq-picker-list">
                {pickedSteps.map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    className="seq-picker-item"
                    onClick={() => pickStep(step)}
                  >
                    <span className="seq-picker-item-thumb">
                      <PoseThumbnail id={step.id} pose={step.pose} alt={step.name} />
                    </span>
                    <span className="seq-picker-item-name">{step.name}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="seq-modal-actions">
              <button type="button" className="seq-modal-btn" onClick={() => setView('sequences')}>‹ Retour</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
