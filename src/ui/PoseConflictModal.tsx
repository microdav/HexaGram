import { useSequencerStore } from '../store/useSequencerStore';
import { useSavedPosesStore } from '../store/useSavedPosesStore';

/**
 * Modal levé quand on tente de modifier la pose d'un step lié à une pose
 * enregistrée. Trois choix :
 * - "Modifier la pose source" → updateAngles sur la pose + propagation à tous les steps liés
 * - "Rompre le lien" → unlink + applique la nouvelle pose au step seul
 * - "Annuler" → ferme le modal sans changement
 */
export function PoseConflictModal() {
  const conflict = useSequencerStore((s) => s.pendingPoseConflict);
  const sourcePose = useSavedPosesStore((s) =>
    conflict ? s.poses.find((p) => p.id === conflict.sourcePoseId) : null
  );

  if (!conflict) return null;

  const sourceName = sourcePose?.name ?? '(pose supprimée)';

  const close = () => useSequencerStore.getState().clearPendingPoseConflict();

  const handleModifySource = async () => {
    if (sourcePose) {
      await useSavedPosesStore.getState().updateAngles(sourcePose.id, conflict.newPose);
      useSequencerStore.getState().propagatePoseChange(sourcePose.id, conflict.newPose);
    } else {
      // Pose source disparue : on applique au step et on coupe le lien orphelin.
      useSequencerStore.getState().updateStepPose(conflict.stepId, conflict.newPose);
      useSequencerStore.getState().unlinkStep(conflict.stepId);
    }
    close();
  };

  const handleBreakLink = () => {
    useSequencerStore.getState().unlinkStep(conflict.stepId);
    useSequencerStore.getState().updateStepPose(conflict.stepId, conflict.newPose);
    close();
  };

  return (
    <div className="seq-modal-backdrop" onClick={close}>
      <div className="seq-modal pose-conflict-modal" onClick={(e) => e.stopPropagation()}>
        <div className="seq-modal-title">Étape liée à une pose</div>
        <div className="pose-conflict-body">
          Cette étape est liée à la pose <strong>« {sourceName} »</strong>.
          <br />
          Que voulez-vous faire de votre modification ?
        </div>
        <div className="pose-conflict-actions">
          <button
            type="button"
            className="seq-modal-btn seq-modal-btn-primary"
            onClick={handleModifySource}
            disabled={!sourcePose}
            title={
              sourcePose
                ? "Mettre à jour la pose source — tous les steps liés seront mis à jour"
                : "La pose source n'existe plus"
            }
          >
            Modifier la pose source
          </button>
          <button
            type="button"
            className="seq-modal-btn"
            onClick={handleBreakLink}
            title="L'étape devient indépendante de la pose"
          >
            Rompre le lien
          </button>
          <button type="button" className="seq-modal-btn" onClick={close}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
