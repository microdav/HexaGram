import { useState, useRef, useEffect, useCallback } from 'react';
import type { DragEvent } from 'react';
import { useSequencerStore } from '../store/useSequencerStore';
import { useHexapodStore } from '../store/useHexapodStore';
import { useToolboxStore } from '../store/useToolboxStore';
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

  const steps = useSequencerStore((s) => s.steps);
  const servoOrder = useSequencerStore((s) => s.servoOrder);
  const transitionSpeed = useSequencerStore((s) => s.transitionSpeed);
  const stepDelay = useSequencerStore((s) => s.stepDelay);
  const currentStepIndex = useSequencerStore((s) => s.currentStepIndex);
  const isPlaying = useSequencerStore((s) => s.isPlaying);
  const history = useSequencerStore((s) => s.history);
  const panelHeight = useSequencerStore((s) => s.panelHeight);

  const pose = useHexapodStore((s) => s.pose);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPlayback = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    useSequencerStore.getState().setIsPlaying(false);
    useSequencerStore.getState().setCurrentStepIndex(-1);
  }, []);

  // Ref to always use fresh state inside the timeout chain
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
    if (useSequencerStore.getState().steps.length === 0) return;
    useSequencerStore.getState().setIsPlaying(true);
    playStepRef.current(0);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const handleSave = () => {
    const json = useSequencerStore.getState().exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hexagram-seq-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Servo row drag-and-drop (vertical reorder)
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

  // Resize du panneau par drag du bord supérieur
  const resizeStartRef = useRef<{ y: number; h: number } | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeStartRef.current = { y: e.clientY, h: useSequencerStore.getState().panelHeight };
    setIsResizing(true);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!resizeStartRef.current) return;
      const dy = resizeStartRef.current.y - ev.clientY; // tirer vers le haut → agrandir
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

  return (
    <div
      className={`sequencer-panel${seqOpen ? ' open' : ''}${isResizing ? ' resizing' : ''}`}
      // eslint-disable-next-line react/forbid-component-props
      style={{ '--seq-panel-h': `${panelHeight}px` } as React.CSSProperties}
    >

      {/* ── Onglet / poignée centré en haut ─────────────────── */}
      <button
        type="button"
        className="seq-panel-handle"
        onClick={() => setSequencerOpen(!seqOpen)}
        title={`${seqOpen ? 'Fermer' : 'Ouvrir'} le séquenceur${steps.length > 0 ? ` · ${steps.length} étape${steps.length !== 1 ? 's' : ''}` : ''}`}
      >
        Séquenceur {seqOpen ? '▾' : '▴'}
      </button>

      {/* ── Contenu collapsible ──────────────────────────────── */}
      <div className="sequencer-content">

        {/* Bord de redimensionnement — drag vertical */}
        <div className="seq-resize-handle" onMouseDown={handleResizeStart} />

        {/* Toolbar */}
        <div className="seq-toolbar">
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
            onClick={handleSave}
            disabled={steps.length === 0}
            title="Exporter la séquence (JSON)"
          >
            ↓
          </button>

          <div className="seq-sep" />

          <label className="seq-ctrl">
            <span className="seq-ctrl-label">Trans.</span>
            <input
              type="range" min="0.1" max="5" step="0.1"
              value={transitionSpeed}
              onChange={(e) => useSequencerStore.getState().setTransitionSpeed(Number(e.target.value))}
              title={`Durée de transition : ${transitionSpeed.toFixed(1)} s`}
            />
            <span className="seq-ctrl-val">{transitionSpeed.toFixed(1)}s</span>
          </label>

          <label className="seq-ctrl">
            <span className="seq-ctrl-label">Délai</span>
            <input
              type="range" min="0" max="5" step="0.1"
              value={stepDelay}
              onChange={(e) => useSequencerStore.getState().setStepDelay(Number(e.target.value))}
              title={`Délai après chaque étape : ${stepDelay.toFixed(1)} s`}
            />
            <span className="seq-ctrl-val">{stepDelay.toFixed(1)}s</span>
          </label>
        </div>

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
            {steps.map((step, colIdx) => (
              <div
                key={step.id}
                className={`seq-step-col${currentStepIndex === colIdx ? ' active' : ''}`}
              >
                <div className="seq-hdr-cell seq-step-hdr">
                  <span className="seq-step-name" title={step.name}>{step.name}</span>
                  <span className="seq-step-actions">
                    {colIdx > 0 && (
                      <button
                        type="button"
                        className="seq-icon-btn"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => useSequencerStore.getState().moveStep(colIdx, colIdx - 1)}
                        title="Déplacer à gauche"
                      >‹</button>
                    )}
                    {colIdx < steps.length - 1 && (
                      <button
                        type="button"
                        className="seq-icon-btn"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => useSequencerStore.getState().moveStep(colIdx, colIdx + 1)}
                        title="Déplacer à droite"
                      >›</button>
                    )}
                    <button
                      type="button"
                      className="seq-icon-btn seq-icon-btn-danger"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => useSequencerStore.getState().removeStep(step.id)}
                      title="Supprimer cette étape"
                    >×</button>
                  </span>
                </div>
                {servoOrder.map((servoId) => (
                  <div key={servoId} className="seq-cell">
                    {step.pose[servoId] !== undefined ? `${step.pose[servoId].toFixed(1)}°` : '—'}
                  </div>
                ))}
              </div>
            ))}

            {/* Add-step column */}
            <div className="seq-add-col">
              <div className="seq-hdr-cell">
                <button
                  type="button"
                  className="seq-add-btn"
                  onClick={() => useSequencerStore.getState().addStep(pose)}
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
  );
}
