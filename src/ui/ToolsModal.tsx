import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { useSavedPosesStore } from '../store/useSavedPosesStore';
import { useSavedSequencesStore, type SequenceSummary } from '../store/useSavedSequencesStore';
import { useProgramsStore } from '../store/useProgramsStore';
import { useSequencerStore } from '../store/useSequencerStore';
import { useHexapodStore } from '../store/useHexapodStore';
import { useProfilesStore } from '../store/useProfilesStore';
import { useToastStore } from '../store/useToastStore';
import type { SavedPose } from '../model/pose';
import type { ProgramSummary } from '../model/program';
import {
  poseToTransfer,
  sequenceToTransfer,
  programToTransfer,
  transferToJson,
  parseTransfer,
  type TransferKind,
} from '../model/jsonTransfer';

interface Props {
  open: boolean;
  onClose: () => void;
}

type ImportMode = 'create' | 'replace';

/** Type de source : entités transférables + le robot complet (base mécanique). */
type SourceKind = TransferKind | 'robot';

/** Source actuellement chargée dans l'éditeur. */
interface ActiveSource {
  kind: SourceKind;
  /** 'live' = pose 3D / séquence en cours ; 'saved' = entité enregistrée. */
  origin: 'live' | 'saved';
  id: string | null;
  name: string;
}

const KIND_LABEL: Record<SourceKind, string> = {
  pose: 'pose',
  sequence: 'séquence',
  program: 'programme',
  robot: 'robot',
};

function resolveSeq(id: string) {
  return useSavedSequencesStore.getState().getSequence(id);
}

export function ToolsModal({ open, onClose }: Props) {
  const poses = useSavedPosesStore((s) => s.poses);
  const sequences = useSavedSequencesStore((s) => s.sequences);
  const programs = useProgramsStore((s) => s.programs);
  const activeProfileId = useProfilesStore((s) => s.activeProfileId);
  const showToast = useToastStore((s) => s.show);

  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveSource | null>(null);
  const [mode, setMode] = useState<ImportMode>('create');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Recharge les listes à l'ouverture (les stores gèrent l'absence de projet).
  useEffect(() => {
    if (!open) return;
    useSavedPosesStore.getState().list().catch(() => {});
    useSavedSequencesStore.getState().list().catch(() => {});
    useProgramsStore.getState().list().catch(() => {});
  }, [open]);

  if (!open) return null;

  const loadInto = (jsonText: string, src: ActiveSource) => {
    setText(jsonText);
    setActive(src);
    setMode('create');
    setError(null);
  };

  // ───────────── Sélection des sources ─────────────

  // « Mon robot » = base mécanique complète (géométrie + dessin body2D + poses + calibration…).
  const selectRobot = () => {
    const data = useHexapodStore.getState().serializeProfile();
    loadInto(JSON.stringify(data, null, 2), {
      kind: 'robot',
      origin: 'live',
      id: activeProfileId,
      name: 'Mon robot',
    });
  };

  const selectLivePose = () => {
    const pose = useHexapodStore.getState().pose;
    loadInto(transferToJson(poseToTransfer('Pose', pose)), {
      kind: 'pose',
      origin: 'live',
      id: null,
      name: 'Pose 3D courante',
    });
  };

  const selectPose = (p: SavedPose) => {
    loadInto(transferToJson(poseToTransfer(p.name, p.angles)), {
      kind: 'pose',
      origin: 'saved',
      id: p.id,
      name: p.name,
    });
  };

  const selectLiveSequence = () => {
    const s = useSequencerStore.getState();
    loadInto(
      transferToJson(sequenceToTransfer(s.sequenceName, s.steps, s.transitionSpeed, s.stepDelay)),
      { kind: 'sequence', origin: 'live', id: null, name: s.sequenceName || 'Séquence en cours' },
    );
  };

  const selectSequence = async (sq: SequenceSummary) => {
    setBusy(true);
    setError(null);
    try {
      const full = await resolveSeq(sq.id);
      const seq = useSequencerStore.getState();
      loadInto(
        transferToJson(sequenceToTransfer(full.name, full.steps, seq.transitionSpeed, seq.stepDelay)),
        { kind: 'sequence', origin: 'saved', id: sq.id, name: full.name },
      );
    } catch (e) {
      setError('Chargement impossible : ' + (e instanceof Error ? e.message : 'erreur'));
    } finally {
      setBusy(false);
    }
  };

  const selectProgram = async (pr: ProgramSummary) => {
    setBusy(true);
    setError(null);
    try {
      const full = await useProgramsStore.getState().load(pr.id);
      const transfer = await programToTransfer(full, resolveSeq);
      loadInto(transferToJson(transfer), {
        kind: 'program',
        origin: 'saved',
        id: pr.id,
        name: full.name,
      });
    } catch (e) {
      setError('Chargement impossible : ' + (e instanceof Error ? e.message : 'erreur'));
    } finally {
      setBusy(false);
    }
  };

  // ───────────── Actions éditeur ─────────────

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('JSON copié dans le presse-papier');
    } catch {
      setError('Copie impossible (presse-papier indisponible).');
    }
  };

  const handleDownload = () => {
    const kind = active?.kind ?? 'json';
    const base = active?.name ?? 'export';
    const safe = base.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hexagram-${kind}-${safe || 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
      setError(null);
      setMode('create');
      // On ne sait pas à quoi rattacher un fichier : on repart en création.
      setActive((a) => (a ? { ...a, origin: 'live', id: null } : a));
    } catch (err) {
      setError('Lecture du fichier impossible : ' + (err instanceof Error ? err.message : 'erreur'));
    }
  };

  const canReplace = !!active && (active.origin === 'saved' || active.kind === 'sequence');

  const handleImport = async () => {
    setError(null);

    // Robot complet : applique la base mécanique et la persiste (pas de mode create/replace).
    if (active?.kind === 'robot') {
      setBusy(true);
      try {
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object' || !data.geometry) {
          throw new Error('JSON robot invalide (champ "geometry" manquant).');
        }
        useHexapodStore.getState().applyProfile(data);
        if (activeProfileId) await useProfilesStore.getState().update(activeProfileId);
        showToast('Robot importé et appliqué');
      } catch (e) {
        setError('Import robot impossible : ' + (e instanceof Error ? e.message : 'erreur'));
      } finally {
        setBusy(false);
      }
      return;
    }

    let parsed;
    try {
      parsed = parseTransfer(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'JSON invalide.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'replace') {
        if (!active) {
          setError('Sélectionnez d\'abord une cible à remplacer.');
          return;
        }
        if (parsed.kind !== active.kind) {
          setError(
            `Le JSON (${KIND_LABEL[parsed.kind]}) ne correspond pas à la cible sélectionnée (${KIND_LABEL[active.kind]}).`,
          );
          return;
        }
        await applyReplace(parsed, active);
      } else {
        await applyCreate(parsed);
      }
    } catch (e) {
      setError('Import impossible : ' + (e instanceof Error ? e.message : 'erreur'));
    } finally {
      setBusy(false);
    }
  };

  async function applyCreate(parsed: ReturnType<typeof parseTransfer>) {
    if (parsed.kind === 'pose') {
      await useSavedPosesStore.getState().add(parsed.name ?? 'Pose importée', parsed.pose);
      showToast('Pose importée');
    } else if (parsed.kind === 'sequence') {
      await useSavedSequencesStore.getState().save(parsed.name, parsed.steps);
      showToast('Séquence importée');
    } else {
      if (!activeProfileId) throw new Error('Aucune base mécanique active pour créer le programme.');
      await useProgramsStore.getState().create({
        name: parsed.name,
        profileId: activeProfileId,
        initPose: parsed.initPose,
        initPoseName: parsed.initPoseName,
        steps: parsed.steps,
        loop: parsed.loop,
      });
      showToast('Programme importé');
    }
  }

  async function applyReplace(parsed: ReturnType<typeof parseTransfer>, src: ActiveSource) {
    if (parsed.kind === 'pose') {
      if (!src.id) throw new Error('Cible de pose introuvable.');
      await useSavedPosesStore.getState().updateAngles(src.id, parsed.pose);
      if (parsed.name && parsed.name !== src.name) {
        await useSavedPosesStore.getState().rename(src.id, parsed.name);
      }
      showToast('Pose remplacée');
    } else if (parsed.kind === 'sequence') {
      if (src.origin === 'live') {
        useSequencerStore.getState().loadSteps(parsed.steps, parsed.name);
        if (parsed.transitionSpeed !== null) useSequencerStore.getState().setTransitionSpeed(parsed.transitionSpeed);
        if (parsed.stepDelay !== null) useSequencerStore.getState().setStepDelay(parsed.stepDelay);
        showToast('Séquence en cours remplacée');
      } else {
        if (!src.id) throw new Error('Cible de séquence introuvable.');
        await useSavedSequencesStore.getState().updateSteps(src.id, parsed.steps);
        if (parsed.name && parsed.name !== src.name) {
          await useSavedSequencesStore.getState().rename(src.id, parsed.name);
        }
        showToast('Séquence remplacée');
      }
    } else {
      if (!src.id) throw new Error('Cible de programme introuvable.');
      await useProgramsStore.getState().update(src.id, {
        name: parsed.name,
        initPose: parsed.initPose,
        initPoseName: parsed.initPoseName,
        steps: parsed.steps,
        loop: parsed.loop,
      });
      showToast('Programme remplacé');
    }
  }

  const isActive = (kind: TransferKind, origin: 'live' | 'saved', id: string | null) =>
    active?.kind === kind && active.origin === origin && active.id === id;

  return (
    <div className="seq-modal-backdrop" onClick={onClose}>
      <div className="seq-modal tools-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tools-header">
          <div className="seq-modal-title">Outils — Import / Export JSON</div>
          <button type="button" className="tools-close" onClick={onClose} title="Fermer">
            ✕
          </button>
        </div>

        <div className="tools-layout">
          {/* Colonne gauche : arbre des sources */}
          <div className="tools-tree">
            <div className="tools-tree-section">Mon robot</div>
            <button
              type="button"
              className={`tools-tree-item live${active?.kind === 'robot' ? ' active' : ''}`}
              onClick={selectRobot}
            >
              Robot (base mécanique)
            </button>

            <div className="tools-tree-section">Poses</div>
            <button
              type="button"
              className={`tools-tree-item live${isActive('pose', 'live', null) ? ' active' : ''}`}
              onClick={selectLivePose}
            >
              Pose 3D courante
            </button>
            {poses.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`tools-tree-item${isActive('pose', 'saved', p.id) ? ' active' : ''}`}
                onClick={() => selectPose(p)}
              >
                {p.name}
              </button>
            ))}

            <div className="tools-tree-section">Séquences</div>
            <button
              type="button"
              className={`tools-tree-item live${isActive('sequence', 'live', null) ? ' active' : ''}`}
              onClick={selectLiveSequence}
            >
              Séquence en cours d'édition
            </button>
            {sequences.map((sq) => (
              <button
                key={sq.id}
                type="button"
                className={`tools-tree-item${isActive('sequence', 'saved', sq.id) ? ' active' : ''}`}
                onClick={() => selectSequence(sq)}
              >
                {sq.name}
              </button>
            ))}

            <div className="tools-tree-section">Programmes</div>
            {programs.length === 0 && <div className="tools-tree-empty">Aucun programme.</div>}
            {programs.map((pr) => (
              <button
                key={pr.id}
                type="button"
                className={`tools-tree-item${isActive('program', 'saved', pr.id) ? ' active' : ''}`}
                onClick={() => selectProgram(pr)}
              >
                {pr.name}
              </button>
            ))}
          </div>

          {/* Colonne droite : éditeur + actions */}
          <div className="tools-main">
            <div className="tools-actions">
              <button type="button" className="seq-modal-btn" onClick={handleCopy} disabled={!text}>
                📋 Copier
              </button>
              <button type="button" className="seq-modal-btn" onClick={handleDownload} disabled={!text}>
                ↓ Télécharger
              </button>
              <button
                type="button"
                className="seq-modal-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                📂 Charger un fichier…
              </button>
              <input
                ref={fileInputRef}
                className="tools-file-input"
                type="file"
                accept="application/json,.json"
                onChange={handleUploadFile}
                aria-label="Charger un fichier JSON"
                title="Charger un fichier JSON"
              />
              <div className="tools-actions-spacer" />
              <label className="tools-mode">
                <input
                  type="radio"
                  name="tools-import-mode"
                  checked={mode === 'create'}
                  onChange={() => setMode('create')}
                />
                Créer
              </label>
              <label className={`tools-mode${canReplace ? '' : ' disabled'}`}>
                <input
                  type="radio"
                  name="tools-import-mode"
                  checked={mode === 'replace'}
                  disabled={!canReplace}
                  onChange={() => setMode('replace')}
                />
                Remplacer la sélection
              </label>
              <button
                type="button"
                className="seq-modal-btn seq-modal-btn-primary"
                onClick={handleImport}
                disabled={busy || !text}
              >
                Importer / Appliquer
              </button>
            </div>

            <div className="tools-editor">
              <CodeMirror
                value={text}
                height="100%"
                theme={oneDark}
                extensions={[json()]}
                onChange={(v) => {
                  setText(v);
                  if (error) setError(null);
                }}
                placeholder="Sélectionnez une source à gauche, ou collez / chargez un JSON ici."
              />
            </div>

            {error ? (
              <div className="tools-status error">{error}</div>
            ) : (
              <div className="tools-status">
                {active
                  ? `Source : ${active.name} (${KIND_LABEL[active.kind]})`
                  : 'Aucune source sélectionnée.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
