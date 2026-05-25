import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { useProgramsStore } from "../store/useProgramsStore";
import { useSavedSequencesStore } from "../store/useSavedSequencesStore";
import { useProfilesStore } from "../store/useProfilesStore";
import { useSequencerStore } from "../store/useSequencerStore";
import { useToastStore } from "../store/useToastStore";
import type { Pose } from "../model/pose";
import type { Program, ProgramStep, LoopTarget } from "../model/program";
import type { SequencerStep } from "../store/useSequencerStore";

type Draft = Omit<Program, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

function makeDraft(profileId: string): Draft {
  return {
    name: "Nouveau programme",
    profileId,
    initPose: null,
    initPoseName: "",
    steps: [],
    loop: { type: 'none' },
  };
}

function newStepId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function ProgramPage() {
  const programs = useProgramsStore((s) => s.programs);
  const loading = useProgramsStore((s) => s.loading);
  const listPrograms = useProgramsStore((s) => s.list);
  const loadProgram = useProgramsStore((s) => s.load);
  const createProgram = useProgramsStore((s) => s.create);
  const updateProgram = useProgramsStore((s) => s.update);
  const removeProgram = useProgramsStore((s) => s.remove);

  const activeProfileId = useProfilesStore((s) => s.activeProfileId);
  const sequences = useSavedSequencesStore((s) => s.sequences);
  const listSequences = useSavedSequencesStore((s) => s.list);
  const loadSequence = useSavedSequencesStore((s) => s.load);
  const sequencerSteps = useSequencerStore((s) => s.steps);
  const showToast = useToastStore((s) => s.show);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAddOptions, setShowAddOptions] = useState(false);

  type PickerTarget = 'init' | 'add-step';
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>('add-step');
  const [showSeqPicker, setShowSeqPicker] = useState(false);
  const [pickerSeqId, setPickerSeqId] = useState<string | null>(null);
  const [pickerSteps, setPickerSteps] = useState<SequencerStep[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  useEffect(() => {
    listPrograms();
    listSequences();
  }, []);

  useEffect(() => {
    if (!pickerSeqId) { setPickerSteps([]); return; }
    setPickerLoading(true);
    loadSequence(pickerSeqId)
      .then((seq) => setPickerSteps(seq.steps.filter((s) => s.type !== 'interpolated')))
      .catch(() => setPickerSteps([]))
      .finally(() => setPickerLoading(false));
  }, [pickerSeqId]);

  const patch = (p: Partial<Draft>) => setDraft((d) => d ? { ...d, ...p } : d);

  const openPicker = useCallback((target: PickerTarget) => {
    setPickerTarget(target);
    setPickerSeqId(null);
    setPickerSteps([]);
    setShowSeqPicker(true);
    setShowAddOptions(false);
  }, []);

  const handlePickerStep = (step: SequencerStep, pose: Pose) => {
    const seqName = sequences.find((s) => s.id === pickerSeqId)?.name ?? "";
    if (pickerTarget === 'init') {
      patch({ initPose: pose, initPoseName: `${seqName} / ${step.name}` });
    } else {
      if (!draft) return;
      patch({ steps: [...draft.steps, { id: newStepId(), type: 'ref', sequenceId: pickerSeqId!, sequenceName: seqName }] });
    }
    setShowSeqPicker(false);
  };

  const handleSelect = async (id: string) => {
    setSelectedId(id);
    setConfirmDelete(false);
    setShowAddOptions(false);
    const prog = await loadProgram(id);
    setDraft(prog);
  };

  const handleNew = () => {
    setSelectedId(null);
    setDraft(makeDraft(activeProfileId ?? ""));
    setConfirmDelete(false);
    setShowAddOptions(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      if (draft.id) {
        const updated = await updateProgram(draft.id, draft);
        setDraft(updated);
        showToast(`Programme « ${updated.name} » sauvegardé`);
      } else {
        const created = await createProgram(draft);
        setSelectedId(created.id);
        setDraft(created);
        showToast(`Programme « ${created.name} » créé`);
      }
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Erreur de sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft?.id) return;
    setDeleting(true);
    try {
      await removeProgram(draft.id);
      setDraft(null);
      setSelectedId(null);
      setConfirmDelete(false);
      showToast("Programme supprimé");
    } finally {
      setDeleting(false);
    }
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    if (!draft) return;
    const steps = [...draft.steps];
    const ni = idx + dir;
    if (ni < 0 || ni >= steps.length) return;
    [steps[idx], steps[ni]] = [steps[ni], steps[idx]];
    patch({ steps });
  };

  const removeStep = (idx: number) => {
    if (!draft) return;
    const removed = draft.steps[idx];
    const steps = draft.steps.filter((_, i) => i !== idx);
    let loop: LoopTarget = draft.loop;
    if (loop.type === 'step' && loop.stepId === removed.id) loop = { type: 'none' };
    patch({ steps, loop });
  };

  const addInlineStep = () => {
    if (!draft) return;
    const defined = sequencerSteps.filter((s) => s.type !== 'interpolated');
    const step: ProgramStep = {
      id: newStepId(), type: 'inline',
      name: `Inline (${defined.length} étape${defined.length !== 1 ? 's' : ''})`,
      steps: defined,
    };
    patch({ steps: [...draft.steps, step] });
    setShowAddOptions(false);
  };

  const replaceInlineStep = (idx: number) => {
    if (!draft) return;
    const defined = sequencerSteps.filter((s) => s.type !== 'interpolated');
    const steps = draft.steps.map((s, i) => {
      if (i !== idx || s.type !== 'inline') return s;
      return { ...s, steps: defined, name: `Inline (${defined.length} étape${defined.length !== 1 ? 's' : ''})` };
    });
    patch({ steps });
  };

  const updateRefSeq = (idx: number, sequenceId: string) => {
    if (!draft) return;
    const seq = sequences.find((s) => s.id === sequenceId);
    if (!seq) return;
    const steps = draft.steps.map((s, i) =>
      i !== idx || s.type !== 'ref' ? s : { ...s, sequenceId, sequenceName: seq.name }
    );
    patch({ steps });
  };

  const profilePrograms = programs.filter(
    (p) => !activeProfileId || p.profileId === activeProfileId
  );

  const pickerRef = useRef<string | null>(null);
  pickerRef.current = pickerSeqId;

  return (
    <div className="program-page">
      <div className="program-layout">
        {/* Sidebar gauche */}
        <aside className="program-sidebar">
          <div className="program-sidebar-head">Programmes</div>

          {loading && <span className="picker-msg">Chargement…</span>}

          {profilePrograms.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`program-sidebar-item${selectedId === p.id ? ' active' : ''}`}
              onClick={() => handleSelect(p.id)}
            >
              {p.name}
            </button>
          ))}

          {profilePrograms.length === 0 && !loading && (
            <span className="picker-msg">Aucun programme</span>
          )}

          <button type="button" className="btn btn-sm program-new-btn" onClick={handleNew}>
            + Nouveau
          </button>
        </aside>

        {/* Éditeur */}
        <div className="program-editor">
          {!draft ? (
            <div className="program-empty-hint">
              Sélectionnez un programme<br />ou créez-en un nouveau
            </div>
          ) : (
            <>
              <input
                type="text"
                className="program-name-input"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Nom du programme"
              />

              <div className="program-flow">
                {/* INIT block */}
                <div className="flow-block flow-block-init">
                  <div className="flow-block-label">🏠 Init</div>
                  {draft.initPose ? (
                    <div className="flow-row">
                      <span className="flow-init-name">{draft.initPoseName}</span>
                      <button type="button" className="btn btn-sm flow-btn-right" onClick={() => openPicker('init')}>
                        Changer
                      </button>
                      <button type="button" className="flow-step-btn flow-step-btn-del" title="Retirer" onClick={() => patch({ initPose: null, initPoseName: "" })}>×</button>
                    </div>
                  ) : (
                    <div className="flow-row">
                      <span className="flow-hint">Pose au lancement</span>
                      <button type="button" className="btn btn-sm flow-btn-right" onClick={() => openPicker('init')}>
                        Choisir un step…
                      </button>
                    </div>
                  )}
                </div>

                {/* Step blocks */}
                {draft.steps.map((step, idx) => (
                  <Fragment key={step.id}>
                    <div className="flow-arrow">↓</div>
                    <div className="flow-block flow-block-step">
                      <div className="flow-block-label">📋 Étape {idx + 1}</div>
                      <div className="flow-step-btns">
                        <button type="button" className="flow-step-btn" title="Monter" disabled={idx === 0} onClick={() => moveStep(idx, -1)}>↑</button>
                        <button type="button" className="flow-step-btn" title="Descendre" disabled={idx === draft.steps.length - 1} onClick={() => moveStep(idx, 1)}>↓</button>
                        <button type="button" className="flow-step-btn flow-step-btn-del" title="Supprimer" onClick={() => removeStep(idx)}>×</button>
                      </div>

                      {step.type === 'ref' ? (
                        <div className="flow-row">
                          <span className="flow-hint">Séq. :</span>
                          <select aria-label="Séquence de l'étape" className="flow-select" value={step.sequenceId} onChange={(e) => updateRefSeq(idx, e.target.value)}>
                            <option value="">— choisir —</option>
                            {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </div>
                      ) : (
                        <div className="flow-row">
                          <span className="flow-hint">{step.steps.length} étape{step.steps.length !== 1 ? 's' : ''} inline</span>
                          <button type="button" className="btn btn-sm flow-btn-right" title="Remplacer par le séquenceur actuel" onClick={() => replaceInlineStep(idx)}>
                            Remplacer
                          </button>
                        </div>
                      )}
                    </div>
                  </Fragment>
                ))}

                {/* Ajouter */}
                <div className="flow-arrow">↓</div>
                {showAddOptions ? (
                  <div className="flow-add-panel">
                    <button type="button" className="flow-add-option" onClick={() => openPicker('add-step')}>📂 Depuis une séquence sauvegardée</button>
                    <button type="button" className="flow-add-option" onClick={addInlineStep}>📍 Capturer le séquenceur actuel</button>
                    <button type="button" className="flow-add-cancel" onClick={() => setShowAddOptions(false)}>Annuler</button>
                  </div>
                ) : (
                  <button type="button" className="flow-add-btn" onClick={() => setShowAddOptions(true)}>
                    + Ajouter une séquence
                  </button>
                )}

                {/* Loop block */}
                <div className="flow-arrow">↓</div>
                <div className="flow-block flow-block-loop">
                  <div className="flow-block-label">🔄 Boucle</div>
                  <div className="flow-loop-row">
                    <label className="flow-loop-opt"><input type="radio" name={`loop-${draft.id ?? 'new'}`} checked={draft.loop.type === 'none'} onChange={() => patch({ loop: { type: 'none' } })} /> Fin</label>
                    <label className="flow-loop-opt"><input type="radio" name={`loop-${draft.id ?? 'new'}`} checked={draft.loop.type === 'init'} onChange={() => patch({ loop: { type: 'init' } })} /> → Init</label>
                    <label className="flow-loop-opt"><input type="radio" name={`loop-${draft.id ?? 'new'}`} checked={draft.loop.type === 'step'} onChange={() => patch({ loop: { type: 'step', stepId: draft.steps[0]?.id ?? '' } })} /> → Étape</label>
                    {draft.loop.type === 'step' && (
                      <select aria-label="Étape cible de la boucle" className="flow-select flow-loop-select" value={draft.loop.stepId} onChange={(e) => patch({ loop: { type: 'step', stepId: e.target.value } })}>
                        <option value="">—</option>
                        {draft.steps.map((s, i) => <option key={s.id} value={s.id}>Étape {i + 1}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="program-actions-row">
                {draft.id && (
                  confirmDelete ? (
                    <>
                      <span className="text-sm-danger">Confirmer ?</span>
                      <button type="button" className="btn btn-danger" disabled={deleting} onClick={handleDelete}>{deleting ? "…" : "Supprimer"}</button>
                      <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>Annuler</button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Supprimer</button>
                  )
                )}
                <span className="program-spacer" />
                <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
                  {saving ? "Sauvegarde…" : draft.id ? "Enregistrer" : "Créer"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Picker de step */}
      <Modal open={showSeqPicker} onClose={() => setShowSeqPicker(false)}>
        <h3 className="modal-title">
          {pickerTarget === 'init' ? "Choisir le step d'init" : "Ajouter une séquence"}
        </h3>

        <label className="modal-field">
          <span>Séquence</span>
          <select className="flow-select picker-seq-select" value={pickerSeqId ?? ""} onChange={(e) => setPickerSeqId(e.target.value || null)}>
            <option value="">— choisir une séquence —</option>
            {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        {pickerTarget === 'init' && pickerSeqId && (
          <div className="seq-picker-list">
            {pickerLoading ? (
              <p className="picker-msg">Chargement…</p>
            ) : pickerSteps.length === 0 ? (
              <p className="picker-msg">Aucun step défini</p>
            ) : (
              pickerSteps.map((step) => (
                <button key={step.id} type="button" className="seq-picker-item" onClick={() => handlePickerStep(step, step.pose)}>
                  {step.name}
                </button>
              ))
            )}
          </div>
        )}

        <div className="modal-actions">
          {pickerTarget === 'add-step' && pickerSeqId && (
            <button type="button" className="btn btn-primary" onClick={() => {
              const seqName = sequences.find((s) => s.id === pickerSeqId)?.name ?? "";
              if (!draft) return;
              patch({ steps: [...draft.steps, { id: newStepId(), type: 'ref', sequenceId: pickerSeqId, sequenceName: seqName }] });
              setShowSeqPicker(false);
            }}>
              Ajouter
            </button>
          )}
          <button type="button" className="btn" onClick={() => setShowSeqPicker(false)}>Annuler</button>
        </div>
      </Modal>
    </div>
  );
}
