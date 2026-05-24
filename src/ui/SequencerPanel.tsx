import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { DragEvent } from 'react';
import { useSequencerStore, MAX_FPS } from '../store/useSequencerStore';
import { useHexapodStore } from '../store/useHexapodStore';
import { useToolboxStore } from '../store/useToolboxStore';
import { useSavedSequencesStore } from '../store/useSavedSequencesStore';
import { SERVOS } from '../model/hexapod';

const JOINT_FR: Record<string, string> = { coxa: 'Coxa', femur: 'Fém.', tibia: 'Tib.' };

function servoLabel(id: number): string {
  const s = SERVOS[id];
  if (!s) return `S${id}`;
  return `L${s.legIndex} ${JOINT_FR[s.joint] ?? s.joint}`;
}

const MIN_PANEL_H = 100;
const MAX_PANEL_H = 700;

export function SequencerPanel() {
  const seqOpen = useToolboxStore((s) => s.uiPrefs.sequencerOpen);
  const setSequencerOpen = useToolboxStore((s) => s.setSequencerOpen);
  const [isResizing, setIsResizing] = useState(false);
  const [dragRowFrom, setDragRowFrom] = useState<number | null>(null);
  const [dragRowOver, setDragRowOver] = useState<number | null>(null);
  const [dragColFrom, setDragColFrom] = useState<number | null>(null);
  const [dragColOver, setDragColOver] = useState<number | null>(null);

  // Sequence save/new modal
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isNewSequence, setIsNewSequence] = useState(false);
  const [saveModalName, setSaveModalName] = useState('');
  const [saveModalError, setSaveModalError] = useState('');
  const saveInputRef = useRef<HTMLInputElement>(null);

  // Options dropdown (portal)
  const [showOptions, setShowOptions] = useState(false);
  const [optionsRect, setOptionsRect] = useState<DOMRect | null>(null);
  const optionsBtnRef = useRef<HTMLButtonElement>(null);
  const optionsMenuRef = useRef<HTMLDivElement>(null);

  // Step context menu (portal)
  const [stepMenuId, setStepMenuId] = useState<string | null>(null);
  const [stepMenuRect, setStepMenuRect] = useState<DOMRect | null>(null);
  const stepMenuRef = useRef<HTMLDivElement>(null);

  // Rename modal
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const steps = useSequencerStore((s) => s.steps);
  const servoOrder = useSequencerStore((s) => s.servoOrder);
  const transitionSpeed = useSequencerStore((s) => s.transitionSpeed);
  const stepDelay = useSequencerStore((s) => s.stepDelay);
  const currentStepIndex = useSequencerStore((s) => s.currentStepIndex);
  const selectedStepIndex = useSequencerStore((s) => s.selectedStepIndex);
  const isPlaying = useSequencerStore((s) => s.isPlaying);
  const history = useSequencerStore((s) => s.history);
  const panelHeight = useSequencerStore((s) => s.panelHeight);
  const sequenceName = useSequencerStore((s) => s.sequenceName);
  const showInterpolated = useSequencerStore((s) => s.showInterpolated);

  const definedStepsCount = steps.filter((s) => s.type === 'defined').length;
  const displayedSteps = showInterpolated ? steps : steps.filter((s) => s.type !== 'interpolated');

  const sequences = useSavedSequencesStore((s) => s.sequences);
  const activeSequenceId = useSavedSequencesStore((s) => s.activeSequenceId);

  const pose = useHexapodStore((s) => s.pose);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  const stopPlayback = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    useSequencerStore.getState().setIsPlaying(false);
    useSequencerStore.getState().setCurrentStepIndex(-1);
  }, []);

  const playStepRef = useRef<(idx: number) => void>(() => {});

  useEffect(() => {
    playStepRef.current = (idx: number) => {
      const store = useSequencerStore.getState();
      if (!store.isPlaying || store.steps.length === 0) { stopPlayback(); return; }
      const stepIdx = idx % store.steps.length;
      store.setCurrentStepIndex(stepIdx);
      useHexapodStore.getState().applyPose(store.steps[stepIdx].pose);
      timerRef.current = setTimeout(
        () => playStepRef.current(stepIdx + 1),
        (store.transitionSpeed + store.stepDelay) * 1000
      );
    };
  }, [stopPlayback]);

  const startPlayback = useCallback(() => {
    setPlayError(null);
    const definedBefore = useSequencerStore.getState().steps.filter(
      (st) => !st.type || st.type === 'defined'
    ).length;
    useSequencerStore.getState().generateInterpolations();
    const afterSteps = useSequencerStore.getState().steps;
    if (afterSteps.length === 0) {
      if (definedBefore > 0) {
        setPlayError(
          `Impossible de générer les interpolations : ${definedBefore} étape${definedBefore > 1 ? 's' : ''} définie${definedBefore > 1 ? 's' : ''} mais aucune n'a pu être traitée. Vérifiez que les poses sont valides.`
        );
      }
      return;
    }
    useSequencerStore.getState().setSelectedStepIndex(-1);
    useSequencerStore.getState().setIsPlaying(true);
    playStepRef.current(0);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Load sequences list on mount
  useEffect(() => {
    useSavedSequencesStore.getState().list().catch(() => {});
  }, []);

  // Close options dropdown on outside click (menu is a portal)
  useEffect(() => {
    if (!showOptions) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      const inMenu = optionsMenuRef.current?.contains(t);
      const inBtn = optionsBtnRef.current?.contains(t);
      if (!inMenu && !inBtn) setShowOptions(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showOptions]);

  // Close step context menu on outside click
  useEffect(() => {
    if (!stepMenuId) return;
    const handler = (e: MouseEvent) => {
      if (!stepMenuRef.current?.contains(e.target as Node)) setStepMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [stepMenuId]);

  // Focus save modal input when it opens
  useEffect(() => {
    if (showSaveModal) {
      setSaveModalName(isNewSequence ? 'Nouvelle séquence' : sequenceName);
      setSaveModalError('');
      setTimeout(() => saveInputRef.current?.select(), 30);
    }
  }, [showSaveModal, isNewSequence, sequenceName]);

  // Focus rename modal input when it opens
  useEffect(() => {
    if (showRenameModal) {
      setRenameValue(sequenceName);
      setTimeout(() => renameInputRef.current?.select(), 30);
    }
  }, [showRenameModal, sequenceName]);

  const handleExportJson = () => {
    const json = useSequencerStore.getState().exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hexagram-seq-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Save sequence to backend
  const handleSaveSequence = async () => {
    const name = saveModalName.trim();
    if (!name) { setSaveModalError('Le nom ne peut pas être vide.'); return; }
    try {
      if (isNewSequence) {
        useSequencerStore.getState().loadSteps([], name);
        await useSavedSequencesStore.getState().save(name, []);
      } else {
        const definedSteps = useSequencerStore.getState().steps.filter((s) => s.type !== 'interpolated');
        await useSavedSequencesStore.getState().save(name, definedSteps);
        useSequencerStore.getState().setSequenceName(name);
      }
      setShowSaveModal(false);
    } catch (err) {
      setSaveModalError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
    }
  };

  // Direct save (overwrite active sequence without asking for name)
  const handleDirectSave = async () => {
    const { activeSequenceId } = useSavedSequencesStore.getState();
    if (!activeSequenceId) {
      setIsNewSequence(false);
      setShowSaveModal(true);
      return;
    }
    const definedSteps = useSequencerStore.getState().steps.filter((s) => s.type !== 'interpolated');
    try {
      await useSavedSequencesStore.getState().updateSteps(activeSequenceId, definedSteps);
    } catch { /* ignore — no steps to save */ }
  };

  // Load sequence from select
  const handleSelectSequence = async (id: string) => {
    if (!id) return;
    try {
      const seq = await useSavedSequencesStore.getState().load(id);
      useSequencerStore.getState().loadSteps(seq.steps, seq.name);
    } catch { /* ignore */ }
  };

  // Rename active sequence
  const handleRenameConfirm = async () => {
    const name = renameValue.trim();
    if (!name || !activeSequenceId) return;
    try {
      await useSavedSequencesStore.getState().rename(activeSequenceId, name);
      useSequencerStore.getState().setSequenceName(name);
      setShowRenameModal(false);
    } catch { /* ignore */ }
  };

  // Duplicate active sequence
  const handleDuplicate = async () => {
    setShowOptions(false);
    if (!activeSequenceId) return;
    const newName = `${sequenceName} (copie)`;
    try {
      const copy = await useSavedSequencesStore.getState().duplicate(activeSequenceId, newName);
      useSequencerStore.getState().setSequenceName(copy.name);
    } catch { /* ignore */ }
  };

  // Delete active sequence
  const handleDelete = async () => {
    setShowOptions(false);
    if (!activeSequenceId) return;
    if (!window.confirm(`Supprimer la séquence « ${sequenceName} » ?`)) return;
    try {
      await useSavedSequencesStore.getState().remove(activeSequenceId);
      useSequencerStore.getState().setSequenceName('Séquence');
    } catch { /* ignore */ }
  };

  // Servo row drag-and-drop
  const onRowDragStart = (e: DragEvent<HTMLDivElement>, orderIdx: number) => {
    setDragRowFrom(orderIdx);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onRowDragOver = (e: DragEvent<HTMLDivElement>, orderIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragRowOver !== orderIdx) setDragRowOver(orderIdx);
  };
  const onRowDrop = (e: DragEvent<HTMLDivElement>, orderIdx: number) => {
    e.preventDefault();
    if (dragRowFrom !== null && dragRowFrom !== orderIdx) {
      const next = useSequencerStore.getState().servoOrder.slice();
      const [item] = next.splice(dragRowFrom, 1);
      next.splice(orderIdx, 0, item);
      useSequencerStore.getState().reorderServos(next);
    }
    setDragRowFrom(null);
    setDragRowOver(null);
  };
  const onRowDragEnd = () => { setDragRowFrom(null); setDragRowOver(null); };

  // Step column drag-and-drop
  const onColDragStart = (e: DragEvent<HTMLDivElement>, colIdx: number) => {
    setDragColFrom(colIdx);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onColDragOver = (e: DragEvent<HTMLDivElement>, colIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragColOver !== colIdx) setDragColOver(colIdx);
  };
  const onColDrop = (e: DragEvent<HTMLDivElement>, colIdx: number) => {
    e.preventDefault();
    if (dragColFrom !== null && dragColFrom !== colIdx) {
      useSequencerStore.getState().moveStep(dragColFrom, colIdx);
    }
    setDragColFrom(null);
    setDragColOver(null);
  };
  const onColDragEnd = () => { setDragColFrom(null); setDragColOver(null); };

  // Resize du panneau
  const resizeStartRef = useRef<{ y: number; h: number } | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartRef.current = { y: e.clientY, h: useSequencerStore.getState().panelHeight };
    setIsResizing(true);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const dy = resizeStartRef.current.y - ev.clientY;
      const newH = Math.max(MIN_PANEL_H, Math.min(MAX_PANEL_H, resizeStartRef.current.h + dy));
      useSequencerStore.getState().setPanelHeight(newH);
    };

    const onUp = () => {
      resizeStartRef.current = null;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  const handleStepClick = (colIdx: number) => {
    const step = steps[colIdx];
    if (!step) return;
    const isAlreadySelected = selectedStepIndex === colIdx;
    useSequencerStore.getState().setSelectedStepIndex(isAlreadySelected ? -1 : colIdx);
    if (!isAlreadySelected) {
      useHexapodStore.getState().applyPose(step.pose);
    }
  };

  return (
    <>
      {/* ── Save sequence modal ──────────────────────────── */}
      {showSaveModal && (
        <div className="seq-modal-backdrop" onClick={() => setShowSaveModal(false)}>
          <div className="seq-modal" onClick={(e) => e.stopPropagation()}>
            <div className="seq-modal-title">{isNewSequence ? 'Nouvelle séquence' : 'Enregistrer la séquence'}</div>
            <input
              ref={saveInputRef}
              className="seq-modal-input"
              value={saveModalName}
              onChange={(e) => setSaveModalName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSequence(); if (e.key === 'Escape') setShowSaveModal(false); }}
              placeholder="Nom de la séquence"
              spellCheck={false}
            />
            {saveModalError && <div className="seq-modal-error">{saveModalError}</div>}
            <div className="seq-modal-actions">
              <button type="button" className="seq-modal-btn" onClick={() => setShowSaveModal(false)}>Annuler</button>
              <button type="button" className="seq-modal-btn seq-modal-btn-primary" onClick={handleSaveSequence}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rename modal ────────────────────────────────── */}
      {showRenameModal && (
        <div className="seq-modal-backdrop" onClick={() => setShowRenameModal(false)}>
          <div className="seq-modal" onClick={(e) => e.stopPropagation()}>
            <div className="seq-modal-title">Renommer la séquence</div>
            <input
              ref={renameInputRef}
              className="seq-modal-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRenameConfirm(); if (e.key === 'Escape') setShowRenameModal(false); }}
              placeholder="Nouveau nom"
              spellCheck={false}
            />
            <div className="seq-modal-actions">
              <button type="button" className="seq-modal-btn" onClick={() => setShowRenameModal(false)}>Annuler</button>
              <button type="button" className="seq-modal-btn seq-modal-btn-primary" onClick={handleRenameConfirm}>Renommer</button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`sequencer-panel${seqOpen ? ' open' : ''}${isResizing ? ' resizing' : ''}`}
        // eslint-disable-next-line react/forbid-component-props
        style={{ '--seq-panel-h': `${panelHeight}px` } as React.CSSProperties}
      >

        {/* ── Onglet / poignée ──────────────────────────── */}
        <button
          type="button"
          className="seq-panel-handle"
          onClick={() => setSequencerOpen(!seqOpen)}
          title={`${seqOpen ? 'Fermer' : 'Ouvrir'} le séquenceur${steps.length > 0 ? ` · ${steps.length} étape${steps.length !== 1 ? 's' : ''}` : ''}`}
        >
          Séquenceur {seqOpen ? '▾' : '▴'}
        </button>

        {/* ── Contenu collapsible ───────────────────────── */}
        <div className="sequencer-content">

          {/* Bord de redimensionnement */}
          <div className="seq-resize-handle" onMouseDown={handleResizeStart} />

          {/* Toolbar */}
          <div className="seq-toolbar">
            {/* Gauche : contrôles lecture/édition */}
            <div className="seq-toolbar-left">
              <button
                type="button"
                className={`seq-btn${isPlaying ? ' seq-btn-active' : ''}`}
                onClick={isPlaying ? stopPlayback : startPlayback}
                disabled={steps.length === 0}
                title={isPlaying ? 'Arrêter' : 'Lancer la séquence'}
              >
                {isPlaying ? '■' : '▶'}
              </button>

              <button
                type="button"
                className="seq-btn"
                onClick={() => useSequencerStore.getState().undo()}
                disabled={history.length === 0}
                title={`Annuler (${history.length} disponible${history.length > 1 ? 's' : ''})`}
              >
                ↩
              </button>

              <button
                type="button"
                className="seq-btn"
                onClick={handleExportJson}
                disabled={steps.length === 0}
                title="Exporter la séquence (JSON)"
              >
                ↓
              </button>

              <div className="seq-sep" />

              <label className="seq-ctrl">
                <span className="seq-ctrl-label">Trans.</span>
                <input
                  type="range" min="0.1" max="1.5" step="0.1"
                  value={transitionSpeed}
                  onChange={(e) => useSequencerStore.getState().setTransitionSpeed(Number(e.target.value))}
                  title={`Durée de transition : ${transitionSpeed.toFixed(1)} s`}
                />
                <span className="seq-ctrl-val">{transitionSpeed.toFixed(1)}s</span>
              </label>

              <label className="seq-ctrl">
                <span className="seq-ctrl-label">Délai</span>
                <input
                  type="range" min="0" max="2" step="0.1"
                  value={stepDelay}
                  onChange={(e) => useSequencerStore.getState().setStepDelay(Number(e.target.value))}
                  title={`Délai après chaque étape : ${stepDelay.toFixed(1)} s`}
                />
                <span className="seq-ctrl-val">{stepDelay.toFixed(1)}s</span>
              </label>

              <div className="seq-sep" />

              <button
                type="button"
                className="seq-btn seq-btn-generate"
                onClick={() => useSequencerStore.getState().generateInterpolations()}
                disabled={definedStepsCount < 2}
                title={`Générer les étapes interpolées entre les ${definedStepsCount} étapes définies (${MAX_FPS} fps, délai ${stepDelay.toFixed(1)}s)`}
              >
                ↔ Générer
              </button>
              <label className="seq-interp-toggle" title="Afficher / masquer les étapes interpolées dans le tableau">
                <input
                  type="checkbox"
                  checked={showInterpolated}
                  onChange={() => useSequencerStore.getState().toggleShowInterpolated()}
                />
                <span>Interpolées</span>
              </label>
            </div>

            {/* Droite : gestion de la séquence */}
            <div className="seq-toolbar-right">
              <button
                type="button"
                className="seq-btn seq-btn-save"
                onClick={handleDirectSave}
                disabled={steps.length === 0}
                title={activeSequenceId ? `Enregistrer dans « ${sequenceName} »` : 'Enregistrer la séquence (nouveau nom)'}
              >
                💾
              </button>

              {/* Options dropdown — portal pour échapper au stacking context */}
              <div className="seq-options-wrap">
                <button
                  ref={optionsBtnRef}
                  type="button"
                  className={`seq-btn${showOptions ? ' seq-btn-active' : ''}`}
                  onClick={() => {
                    if (!showOptions && optionsBtnRef.current) {
                      setOptionsRect(optionsBtnRef.current.getBoundingClientRect());
                    }
                    setShowOptions((v) => !v);
                  }}
                  disabled={!activeSequenceId}
                  title="Options de la séquence"
                >
                  ⋮
                </button>
              </div>
              {showOptions && optionsRect && createPortal(
                <div
                  ref={optionsMenuRef}
                  className="seq-options-menu seq-options-menu-portal"
                  // eslint-disable-next-line react/forbid-component-props
                  style={{
                    '--om-bottom': `${window.innerHeight - optionsRect.top + 4}px`,
                    '--om-right': `${window.innerWidth - optionsRect.right}px`,
                  } as React.CSSProperties}
                >
                  <button
                    type="button"
                    className="seq-options-item"
                    onClick={() => { setShowOptions(false); setShowRenameModal(true); }}
                  >
                    Renommer
                  </button>
                  <button
                    type="button"
                    className="seq-options-item"
                    onClick={handleDuplicate}
                  >
                    Dupliquer
                  </button>
                  <div className="seq-options-sep" />
                  <button
                    type="button"
                    className="seq-options-item seq-options-item-danger"
                    onClick={handleDelete}
                  >
                    Supprimer
                  </button>
                </div>,
                document.body
              )}

              <div className="seq-sep" />

              {/* Select : séquence active */}
              <select
                className="seq-name-select"
                value={activeSequenceId ?? ''}
                onChange={(e) => handleSelectSequence(e.target.value)}
                title="Séquence active"
              >
                <option value="">—</option>
                {sequences.map((sq) => (
                  <option key={sq.id} value={sq.id}>{sq.name}</option>
                ))}
              </select>

              {/* Nouvelle séquence */}
              <button
                type="button"
                className="seq-btn"
                onClick={() => { setIsNewSequence(true); setShowSaveModal(true); }}
                title="Nouvelle séquence (vide le séquenceur)"
              >
                +
              </button>
            </div>
          </div>

          {/* Erreur de lecture */}
          {playError && (
            <div className="seq-play-error" onClick={() => setPlayError(null)} title="Cliquer pour fermer">
              ⚠ {playError}
            </div>
          )}

          {/* Timeline */}
          <div className="seq-scroll-wrapper">
            <div className="seq-inner">

              {/* Sticky servo labels column */}
              <div className="seq-sticky-labels">
                <div className="seq-hdr-cell seq-labels-hdr">Servo</div>
                {servoOrder.map((servoId, orderIdx) => (
                  <div
                    key={servoId}
                    className={`seq-label-row${dragRowOver === orderIdx && dragRowFrom !== orderIdx ? ' drag-over' : ''}`}
                    draggable
                    onDragStart={(e) => onRowDragStart(e, orderIdx)}
                    onDragOver={(e) => onRowDragOver(e, orderIdx)}
                    onDrop={(e) => onRowDrop(e, orderIdx)}
                    onDragEnd={onRowDragEnd}
                  >
                    <span className="seq-row-drag">⠿</span>
                    <span className="seq-row-label-text">{servoLabel(servoId)}</span>
                  </div>
                ))}
              </div>

              {/* Step columns */}
              {displayedSteps.map((step) => {
                const colIdx = steps.indexOf(step);
                const isInterp = step.type === 'interpolated';
                return (
                  <div
                    key={step.id}
                    className={`seq-step-col${isInterp ? ' interpolated' : ''}${currentStepIndex === colIdx || selectedStepIndex === colIdx ? ' active' : ''}${dragColOver === colIdx && dragColFrom !== colIdx ? ' drag-col-over' : ''}`}
                    draggable={!isInterp}
                    onDragStart={isInterp ? undefined : (e) => onColDragStart(e, colIdx)}
                    onDragOver={(e) => onColDragOver(e, colIdx)}
                    onDrop={(e) => onColDrop(e, colIdx)}
                    onDragEnd={onColDragEnd}
                  >
                    <div className="seq-hdr-cell seq-step-hdr">
                      <span
                        className="seq-step-name"
                        title={step.name}
                        onClick={() => handleStepClick(colIdx)}
                      >{step.name}</span>
                      <span className="seq-step-actions">
                        <button
                          type="button"
                          className="seq-icon-btn"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setStepMenuId(stepMenuId === step.id ? null : step.id);
                            setStepMenuRect(rect);
                          }}
                          title="Actions"
                        >⋯</button>
                      </span>
                      {stepMenuId === step.id && stepMenuRect && createPortal(
                        <div
                          ref={stepMenuRef}
                          className="seq-step-ctx-menu seq-step-ctx-menu-portal"
                          // eslint-disable-next-line react/forbid-component-props
                          style={{
                            '--scm-top': `${stepMenuRect.bottom + 4}px`,
                            '--scm-left': `${stepMenuRect.left}px`,
                          } as React.CSSProperties}
                        >
                          {isInterp && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={() => { useSequencerStore.getState().convertToDefined(step.id); setStepMenuId(null); }}
                            >Convertir en définie</button>
                          )}
                          {!isInterp && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={() => { useSequencerStore.getState().duplicateStep(step.id); setStepMenuId(null); }}
                            >Dupliquer</button>
                          )}
                          <button
                            type="button"
                            className="danger"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => { useSequencerStore.getState().removeStep(step.id); setStepMenuId(null); }}
                          >Supprimer</button>
                        </div>,
                        document.body
                      )}
                    </div>
                    {servoOrder.map((servoId) => (
                      <div key={servoId} className="seq-cell">
                        {step.pose[servoId] !== undefined ? `${step.pose[servoId].toFixed(1)}°` : '—'}
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* Add-step column */}
              <div className="seq-add-col">
                <div className="seq-hdr-cell">
                  <button
                    type="button"
                    className="seq-add-btn"
                    onClick={() => {
                      const { steps, addStep } = useSequencerStore.getState();
                      const defaultPose = steps.length > 0 ? steps[steps.length - 1].pose : pose;
                      addStep(defaultPose);
                    }}
                    title="Capturer la pose actuelle comme nouvelle étape"
                  >
                    + Étape
                  </button>
                </div>
                {servoOrder.map((servoId) => (
                  <div key={servoId} className="seq-cell seq-cell-empty" />
                ))}
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );
}
