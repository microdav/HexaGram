import { useMemo, useState } from 'react';
import { useSequencerStore, type SequencerStep } from '../store/useSequencerStore';
import { SERVOS, LEG_NAMES } from '../model/hexapod';
import { PoseThumbnail } from './PoseThumbnail';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface StepBlock {
  step: SequencerStep;
  lines: string[];
}

function buildStepBlocks(steps: SequencerStep[]): StepBlock[] {
  return steps.map((st) => {
    const obj = {
      id: st.id,
      name: st.name,
      type: st.type ?? 'defined',
      pose: Object.fromEntries(
        SERVOS.map((servo) => [
          `${LEG_NAMES[servo.legIndex]} - ${servo.joint} (S${servo.id})`,
          +(st.pose[servo.id] ?? 0).toFixed(2),
        ])
      ),
    };
    const lines = JSON.stringify(obj, null, 2).split('\n');
    return { step: st, lines };
  });
}

export function SequenceExportModal({ open, onClose }: Props) {
  const steps = useSequencerStore((s) => s.steps);
  const sequenceName = useSequencerStore((s) => s.sequenceName);

  const blocks = useMemo(() => {
    const defined = steps.filter((st) => st.type !== 'interpolated');
    return buildStepBlocks(defined);
  }, [steps]);

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    blocks.forEach((b, bi) => b.lines.forEach((_, li) => keys.push(`${bi}-${li}`)));
    return keys;
  }, [blocks]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const allSelected = allKeys.length > 0 && selected.size === allKeys.length;

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const toggleStep = (bi: number) => {
    const keys = blocks[bi].lines.map((_, li) => `${bi}-${li}`);
    const allOn = keys.every((k) => selected.has(k));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOn) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allKeys));
  };

  const handleCopy = async () => {
    const chunks = blocks
      .map((b, bi) => b.lines.filter((_, li) => selected.has(`${bi}-${li}`)).join('\n'))
      .filter((s) => s.length > 0);
    const text = chunks.join('\n');
    if (!text) {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1500);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1500);
    }
  };

  const handleDownload = () => {
    const json = useSequencerStore.getState().exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hexagram-seq-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  return (
    <div className="seq-modal-backdrop" onClick={onClose}>
      <div className="seq-modal seq-export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="seq-export-header">
          <div className="seq-modal-title">Exporter « {sequenceName} »</div>
          <div className="seq-export-controls">
            <label className="seq-export-allcheck">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span>Tout sélectionner</span>
            </label>
            <span className="seq-export-selcount">
              {selected.size} / {allKeys.length} ligne{allKeys.length > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              className="seq-modal-btn"
              onClick={handleCopy}
              disabled={selected.size === 0}
              title="Copier les lignes sélectionnées"
            >
              {copyState === 'copied' ? '✓ Copié' : copyState === 'error' ? '✕ Erreur' : '📋 Copier'}
            </button>
            <button
              type="button"
              className="seq-modal-btn"
              onClick={handleDownload}
              title="Télécharger la séquence complète (.json)"
            >
              ↓ Fichier
            </button>
          </div>
        </div>

        <div className="seq-export-body">
          {blocks.length === 0 ? (
            <div className="seq-export-empty">Aucune étape à exporter.</div>
          ) : (
            blocks.map((b, bi) => {
              const stepKeys = b.lines.map((_, li) => `${bi}-${li}`);
              const stepAllOn = stepKeys.every((k) => selected.has(k));
              return (
                <div key={b.step.id} className="seq-export-row">
                  <div className="seq-export-thumb">
                    <PoseThumbnail id={b.step.id} pose={b.step.pose} alt={b.step.name} />
                    <div className="seq-export-thumb-name">
                      {bi + 1}. {b.step.name}
                    </div>
                  </div>
                  <div className="seq-export-code">
                    <label className="seq-export-step-allcheck">
                      <input
                        type="checkbox"
                        checked={stepAllOn}
                        onChange={() => toggleStep(bi)}
                      />
                      <span>Étape {bi + 1} ({b.lines.length} lignes)</span>
                    </label>
                    <div className="seq-export-code-block">
                      {b.lines.map((line, li) => {
                        const key = `${bi}-${li}`;
                        const checked = selected.has(key);
                        return (
                          <label key={li} className={`seq-export-line${checked ? ' selected' : ''}`}>
                            <input type="checkbox" checked={checked} onChange={() => toggle(key)} />
                            <span className="seq-export-line-num">{li + 1}</span>
                            <code>{line || ' '}</code>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="seq-modal-actions">
          <button type="button" className="seq-modal-btn seq-modal-btn-primary" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
