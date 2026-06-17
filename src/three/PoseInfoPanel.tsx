import { useEffect, useState } from 'react';
import { useSavedPosesStore } from '../store/useSavedPosesStore';
import { useSequencerStore } from '../store/useSequencerStore';
import { useHexapodStore } from '../store/useHexapodStore';
import { useToastStore } from '../store/useToastStore';
import { confirmTri } from '../store/useConfirmStore';
import { posesEqual } from '../store/stepEditGuard';
import type { Pose } from '../model/pose';

/**
 * Indicateur « Pose sélectionnée » de l'espace 3D (bas-droite) — pendant de
 * StepInfoPanel pour les poses de la boîte « Poses ». Rend explicite quelle pose
 * est en cours d'édition, signale les modifications non enregistrées, et offre
 * « Enregistrer » (avec arbitrage si la pose est liée à des étapes) et « Annuler
 * la sélection » (revient aux angles enregistrés et désélectionne). Sélection
 * mutuellement exclusive avec les étapes : une étape sélectionnée a la priorité.
 */
export function PoseInfoPanel() {
  const poses = useSavedPosesStore((s) => s.poses);
  const selectedPoseId = useSavedPosesStore((s) => s.selectedPoseId);
  const selectedStepIndex = useSequencerStore((s) => s.selectedStepIndex);
  const isPlaying = useSequencerStore((s) => s.isPlaying);

  const pose = selectedPoseId ? poses.find((p) => p.id === selectedPoseId) : null;
  const active = !!pose && selectedStepIndex < 0 && !isPlaying;

  const [editName, setEditName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (pose) setEditName(pose.name);
  }, [pose?.id, pose?.name]);

  // Dirty : la pose 3D live diffère-t-elle des angles enregistrés ?
  useEffect(() => {
    const poseId = active ? pose?.id : null;
    if (!poseId) { setDirty(false); return; }
    const compute = () => {
      const cur = useSavedPosesStore.getState().getById(poseId);
      if (!cur) return;
      setDirty(!posesEqual(useHexapodStore.getState().pose as Pose, cur.angles));
    };
    compute();
    const unsub = useHexapodStore.subscribe((state, prev) => {
      if (state.pose === prev.pose) return;
      compute();
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pose?.id]);

  if (!active || !pose) return null;

  const handleNameBlur = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== pose.name) {
      void useSavedPosesStore.getState().rename(pose.id, trimmed);
    }
  };
  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') { setEditName(pose.name); e.currentTarget.blur(); }
  };

  const handleSave = async () => {
    const id = pose.id;
    const live = (useHexapodStore.getState().pose as Pose).slice();
    const store = useSavedPosesStore.getState();
    setSaving(true);
    try {
      // Si la pose est utilisée par des étapes, on arbitre : propager ou pose seule.
      const u = await store.usage(id);
      if (u.total > 0) {
        const choice = await confirmTri({
          title: 'Pose liée à des étapes',
          message: [
            `Cette pose est utilisée par ${u.total} étape(s) dans ${u.sequences.length} séquence(s).`,
            'Que faire de votre modification ?',
          ],
          confirmLabel: 'Mettre à jour les étapes liées',
          discardLabel: 'Pose seulement',
          cancelLabel: 'Annuler',
        });
        if (choice === 'cancel') return;
        if (choice === 'confirm') await store.propagateAngles(id, live);
        else await store.updateAngles(id, live);
      } else {
        await store.updateAngles(id, live);
      }
      setDirty(false);
      useToastStore.getState().show('Pose enregistrée');
    } finally {
      setSaving(false);
    }
  };

  const handleDeselect = () => {
    // Revient aux angles enregistrés (abandonne les modifs) puis désélectionne.
    useHexapodStore.getState().applyPose(pose.angles);
    useSavedPosesStore.getState().setSelectedPoseId(null);
  };

  return (
    <div className={`step-info-panel${dirty ? ' step-info-panel--dirty' : ''}`}>
      <div className="step-info-head">
        <div className="step-info-kind">
          Pose sélectionnée
          {dirty && <span className="step-info-dirty"> · ● modifié</span>}
        </div>
        <button
          type="button"
          className="step-info-close"
          onClick={handleDeselect}
          title="Revenir aux angles enregistrés et désélectionner"
          aria-label="Fermer la sélection"
        >
          ✕
        </button>
      </div>
      <input
        className="step-info-name"
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        onBlur={handleNameBlur}
        onKeyDown={handleNameKeyDown}
        title="Cliquer pour renommer la pose"
        spellCheck={false}
      />
      <div className="step-info-actions">
        <button
          type="button"
          className="step-info-btn step-info-btn-save"
          onClick={() => void handleSave()}
          disabled={!dirty || saving}
          title={dirty ? 'Enregistrer la pose 3D actuelle' : 'Aucune modification à enregistrer'}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
