import { useState, useRef, useEffect, type DragEvent } from 'react';
import { useSavedPosesStore } from '../store/useSavedPosesStore';
import { useHexapodStore } from '../store/useHexapodStore';
import { useSequencerStore } from '../store/useSequencerStore';
import { useToolboxStore } from '../store/useToolboxStore';
import { useAuthStore } from '../store/useAuthStore';
import { useProjectStore } from '../store/useProjectStore';
import { confirmDialog } from '../store/useConfirmStore';
import { guardStepEdit } from '../store/stepEditGuard';
import { guardPoseEdit } from '../store/poseEditGuard';
import { PoseThumbnail } from './PoseThumbnail';
import type { SavedPose } from '../model/pose';

/** Format MIME utilisé pour transporter l'id de pose lors d'un drag → séquenceur. */
export const POSE_DRAG_MIME = 'application/x-hexagram-pose-id';

export function PosesContent() {
  const poses = useSavedPosesStore((s) => s.poses);
  const selectedPoseId = useSavedPosesStore((s) => s.selectedPoseId);
  const setSelectedPoseId = useSavedPosesStore((s) => s.setSelectedPoseId);
  const user = useAuthStore((s) => s.user);
  const projectId = useProjectStore((s) => s.activeProjectId);
  const applyPose = useHexapodStore((s) => s.applyPose);
  const tabletMode = useToolboxStore((s) => s.tabletMode);

  // Mode tablette : ajoute la pose comme étape liée en fin de séquence
  // (remplace le glisser-déposer HTML5 inopérant au doigt) et ouvre le séquenceur.
  const handleAddToSequence = (p: SavedPose) => {
    const seq = useSequencerStore.getState();
    const definedCount = seq.steps.filter((st) => !st.type || st.type === 'defined').length;
    seq.insertStep(p.angles, definedCount, p.name, p.id);
    useToolboxStore.getState().setSequencerOpen(true);
  };

  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [internalDragId, setInternalDragId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Recharge la liste quand on est connecté avec un projet actif
  useEffect(() => {
    if (user && projectId) {
      useSavedPosesStore.getState().list().catch(() => {});
    }
  }, [user, projectId]);

  useEffect(() => {
    if (renameId) setTimeout(() => renameInputRef.current?.select(), 30);
  }, [renameId]);

  const handleSave = async () => {
    const pose = useHexapodStore.getState().pose;
    try {
      await useSavedPosesStore.getState().add(`Pose ${poses.length + 1}`, pose);
    } catch (err) {
      console.error('Save pose failed', err);
    }
  };

  // Sélectionner une pose : on quitte d'abord proprement le contexte courant
  // (étape éditée OU pose éditée), puis on applique la pose, on la marque
  // sélectionnée et on désactive l'étape de séquence active (exclusion mutuelle).
  const handleSelectPose = async (p: SavedPose) => {
    if (!(await guardStepEdit())) return;
    if (!(await guardPoseEdit())) return;
    applyPose(p.angles);
    setSelectedPoseId(p.id);
    useSequencerStore.getState().setSelectedStepIndex(-1);
  };

  const handleRenameConfirm = async () => {
    if (renameId) {
      await useSavedPosesStore.getState().rename(renameId, renameValue);
    }
    setRenameId(null);
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: 'Supprimer la pose',
      message: `Voulez-vous vraiment supprimer la pose « ${name} » ?`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    await useSavedPosesStore.getState().remove(id);
  };

  // Drag vers le séquenceur (via dataTransfer) + drag interne pour réordonner
  const onPoseDragStart = (e: DragEvent<HTMLDivElement>, poseId: string) => {
    e.dataTransfer.setData(POSE_DRAG_MIME, poseId);
    e.dataTransfer.setData('text/plain', poseId);
    e.dataTransfer.effectAllowed = 'copyMove';
    setInternalDragId(poseId);
  };

  const onPoseDragOver = (e: DragEvent<HTMLDivElement>, idx: number) => {
    if (!internalDragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIdx !== idx) setDragOverIdx(idx);
  };

  const onPoseDrop = (e: DragEvent<HTMLDivElement>, targetIdx: number) => {
    if (!internalDragId) return;
    e.preventDefault();
    const from = poses.findIndex((p) => p.id === internalDragId);
    if (from === -1 || from === targetIdx) {
      setInternalDragId(null);
      setDragOverIdx(null);
      return;
    }
    const next = poses.slice();
    const [moved] = next.splice(from, 1);
    next.splice(targetIdx, 0, moved);
    useSavedPosesStore.getState().reorder(next.map((p) => p.id));
    setInternalDragId(null);
    setDragOverIdx(null);
  };

  const onPoseDragEnd = () => {
    setInternalDragId(null);
    setDragOverIdx(null);
  };

  return (
    <div className="poses-panel">
      <button
        type="button"
        className="poses-save-btn"
        onClick={handleSave}
        title="Capturer la pose 3D actuelle"
      >
        + Enregistrer la pose
      </button>

      {poses.length === 0 ? (
        <div className="poses-empty">
          Aucune pose. Bougez les servos puis cliquez sur « Enregistrer ».
        </div>
      ) : (
        <div className="poses-grid">
          {poses.map((p, idx) => {
            const isRenaming = renameId === p.id;
            return (
              <div
                key={p.id}
                className={`pose-card${selectedPoseId === p.id ? ' selected' : ''}${dragOverIdx === idx && internalDragId !== p.id ? ' drag-over' : ''}${internalDragId === p.id ? ' dragging' : ''}`}
                draggable={!isRenaming}
                onDragStart={(e) => onPoseDragStart(e, p.id)}
                onDragOver={(e) => onPoseDragOver(e, idx)}
                onDrop={(e) => onPoseDrop(e, idx)}
                onDragEnd={onPoseDragEnd}
                onClick={() => !isRenaming && handleSelectPose(p)}
                onDoubleClick={() => {
                  setRenameId(p.id);
                  setRenameValue(p.name);
                }}
                title={`${p.name} — cliquer pour appliquer, double-clic pour renommer, glisser vers le séquenceur`}
              >
                <div className="pose-card-thumb">
                  <PoseThumbnail id={p.id} pose={p.angles} alt={p.name} />
                </div>
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    className="pose-card-rename"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={handleRenameConfirm}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenameConfirm();
                      if (e.key === 'Escape') setRenameId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    spellCheck={false}
                    placeholder="Nom de la pose"
                    title="Renommer la pose"
                    aria-label="Renommer la pose"
                  />
                ) : (
                  <div className="pose-card-label" title={p.name}>{p.name}</div>
                )}
                {tabletMode && !isRenaming && (
                  <button
                    type="button"
                    className="pose-card-add"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddToSequence(p);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    title="Ajouter à la séquence"
                  >
                    +seq
                  </button>
                )}
                <button
                  type="button"
                  className="pose-card-del"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(p.id, p.name);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  title="Supprimer cette pose"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
