import { useState } from 'react';
import { useSequencerStore, type SequencerStep, type StepType } from '../store/useSequencerStore';
import { SERVOS } from '../model/hexapod';
import { defaultPose, type Pose } from '../model/pose';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface RawStep {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  pose?: unknown;
}

interface RawPayload {
  name?: unknown;
  transitionSpeed?: unknown;
  stepDelay?: unknown;
  steps?: unknown;
}

function parsePoseDict(dict: Record<string, unknown>): Pose {
  const pose = defaultPose();
  for (const [key, value] of Object.entries(dict)) {
    const m = key.match(/\(S(\d+)\)\s*$/);
    if (!m) continue;
    const id = Number(m[1]);
    if (!Number.isInteger(id) || id < 0 || id >= SERVOS.length) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    pose[id] = value;
  }
  return pose;
}

function newId(seed: number): string {
  return `${seed}-${Math.random().toString(36).slice(2, 6)}`;
}

export function SequenceImportModal({ open, onClose }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const handleImport = () => {
    setError('');
    let payload: RawPayload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      setError('JSON invalide : ' + (e instanceof Error ? e.message : 'erreur de parsing'));
      return;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      setError('Le JSON doit être un objet.');
      return;
    }
    if (!Array.isArray(payload.steps)) {
      setError('Le champ "steps" est manquant ou n\'est pas un tableau.');
      return;
    }
    if (payload.steps.length === 0) {
      setError('La séquence ne contient aucune étape.');
      return;
    }

    const baseStamp = Date.now();
    const newSteps: SequencerStep[] = [];
    const rawSteps = payload.steps as RawStep[];
    for (let i = 0; i < rawSteps.length; i++) {
      const raw = rawSteps[i];
      if (!raw || typeof raw !== 'object') {
        setError(`Étape ${i + 1} : format invalide.`);
        return;
      }
      if (!raw.pose || typeof raw.pose !== 'object' || Array.isArray(raw.pose)) {
        setError(`Étape ${i + 1} : champ "pose" manquant ou invalide.`);
        return;
      }
      const pose = parsePoseDict(raw.pose as Record<string, unknown>);
      newSteps.push({
        id: newId(baseStamp + i),
        name: typeof raw.name === 'string' ? raw.name : `Étape ${i + 1}`,
        pose,
        type: (raw.type === 'interpolated' ? 'interpolated' : 'defined') as StepType,
        sourcePoseId: null,
      });
    }

    const name =
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name
        : 'Séquence importée';
    const ts = typeof payload.transitionSpeed === 'number' ? payload.transitionSpeed : null;
    const sd = typeof payload.stepDelay === 'number' ? payload.stepDelay : null;

    if (ts !== null) useSequencerStore.getState().setTransitionSpeed(ts);
    if (sd !== null) useSequencerStore.getState().setStepDelay(sd);
    useSequencerStore.getState().loadSteps(newSteps, name);

    setText('');
    setError('');
    onClose();
  };

  const handleClose = () => {
    setText('');
    setError('');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="seq-modal-backdrop" onClick={handleClose}>
      <div className="seq-modal seq-import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="seq-modal-title">Importer une séquence</div>
        <div className="seq-import-help">
          Colle ci-dessous un JSON de séquence (format exporté par HexaGram).
          Les étapes <strong>remplaceront</strong> la séquence actuelle ; de
          nouvelles vignettes seront générées.
        </div>
        <textarea
          className="seq-import-textarea"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleClose();
          }}
          placeholder={'{\n  "name": "...",\n  "steps": [ ... ]\n}'}
          spellCheck={false}
          autoFocus
        />
        {error && <div className="seq-modal-error">{error}</div>}
        <div className="seq-modal-actions">
          <button type="button" className="seq-modal-btn" onClick={handleClose}>
            Annuler
          </button>
          <button
            type="button"
            className="seq-modal-btn seq-modal-btn-primary"
            onClick={handleImport}
            disabled={!text.trim()}
          >
            Importer
          </button>
        </div>
      </div>
    </div>
  );
}
