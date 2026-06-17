import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { DragEvent } from 'react';
import { useSequencerStore, type TransitionKind } from '../store/useSequencerStore';
import { useHexapodStore } from '../store/useHexapodStore';
import { useToolboxStore } from '../store/useToolboxStore';
import { useSavedSequencesStore } from '../store/useSavedSequencesStore';
import { useSavedPosesStore } from '../store/useSavedPosesStore';
import { confirmDialog } from '../store/useConfirmStore';
import { guardStepEdit } from '../store/stepEditGuard';
import { guardPoseEdit } from '../store/poseEditGuard';
import { useAuthStore } from '../store/useAuthStore';
import { useProjectStore } from '../store/useProjectStore';
import { usePoseThumbnailStore } from '../store/usePoseThumbnailStore';
import { SERVOS } from '../model/hexapod';
import { defaultPose } from '../model/pose';
import { ToolboxSlot } from './ToolboxSlot';
import { PoseThumbnail } from './PoseThumbnail';
import { POSE_DRAG_MIME } from './PosesPanel';
import { SequenceAddStepModal } from './SequenceAddStepModal';

const JOINT_FR: Record<string, string> = { coxa: 'Coxa', femur: 'Fém.', tibia: 'Tib.' };

const TRANSITION_ICON: Record<TransitionKind, string> = { linear: '⟶', ease: '⤳', instant: '⇥' };
const TRANSITION_LABEL: Record<TransitionKind, string> = {
  linear: 'Linéaire',
  ease: 'Adoucie',
  instant: 'Instantanée (saut)',
};

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
  const tabletMode = useToolboxStore((s) => s.tabletMode);
  const isDraggingToSeq = useToolboxStore((s) => s.draggingId !== null && s.hoveredPanel === 'sequencer');
  const [isResizing, setIsResizing] = useState(false);
  const [dragRowFrom, setDragRowFrom] = useState<number | null>(null);
  const [dragRowOver, setDragRowOver] = useState<number | null>(null);
  // Déplacement d'une étape : dragColFrom = indice de l'étape définie déplacée ;
  // colDropIndex = gap d'insertion visé (0 = avant la 1re, N = après la dernière).
  const [dragColFrom, setDragColFrom] = useState<number | null>(null);
  const [colDropIndex, setColDropIndex] = useState<number | null>(null);
  // Drag d'une pose enregistrée depuis la toolbox Poses vers le séquenceur
  const [posedragActive, setPosedragActive] = useState(false);
  // Position d'insertion visée (index parmi les étapes définies, 0 = avant la 1re,
  // N = après la dernière / colonne d'ajout). null tant qu'aucune colonne n'est survolée.
  const [poseDropIndex, setPoseDropIndex] = useState<number | null>(null);
  const posedragCounter = useRef(0);

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

  // Modal d'ajout d'étape (neutre / dupliquer / importer d'une autre séquence)
  const [showAddStepModal, setShowAddStepModal] = useState(false);
  const [addStepInitialView, setAddStepInitialView] = useState<'menu' | 'sequences'>('menu');

  const steps = useSequencerStore((s) => s.steps);
  const servoOrder = useSequencerStore((s) => s.servoOrder);
  const transitionSpeed = useSequencerStore((s) => s.transitionSpeed);
  const stepDelay = useSequencerStore((s) => s.stepDelay);
  const currentStepIndex = useSequencerStore((s) => s.currentStepIndex);
  const selectedStepIndex = useSequencerStore((s) => s.selectedStepIndex);
  const playError = useSequencerStore((s) => s.playError);
  const history = useSequencerStore((s) => s.history);
  const panelHeight = useSequencerStore((s) => s.panelHeight);
  const sequenceName = useSequencerStore((s) => s.sequenceName);
  const showInterpolated = useSequencerStore((s) => s.showInterpolated);

  const displayedSteps = showInterpolated ? steps : steps.filter((s) => s.type !== 'interpolated');
  const definedSteps = steps.filter((s) => !s.type || s.type === 'defined');
  const definedCount = definedSteps.length;
  const lastDefinedStep = definedSteps[definedSteps.length - 1];
  // Gap où afficher la barre d'insertion (drop de pose ou déplacement d'étape).
  // Pour un déplacement, on masque les gaps qui n'auraient aucun effet (avant/après soi-même).
  const activeInsertGap =
    poseDropIndex !== null
      ? poseDropIndex
      : colDropIndex !== null && dragColFrom !== null && colDropIndex !== dragColFrom && colDropIndex !== dragColFrom + 1
        ? colDropIndex
        : null;

  const sequences = useSavedSequencesStore((s) => s.sequences);
  const activeSequenceId = useSavedSequencesStore((s) => s.activeSequenceId);
  const savedPoses = useSavedPosesStore((s) => s.poses);
  const user = useAuthStore((s) => s.user);
  const projectId = useProjectStore((s) => s.activeProjectId);


  // Recharge la liste quand on est connecté avec un projet actif. On dépend
  // de projectId (et pas seulement de user) car au hard refresh le projet de
  // l'URL n'est résolu qu'après la connexion : sans cette dépendance, list()
  // tournerait à vide (projet null) et les séquences n'apparaîtraient jamais.
  useEffect(() => {
    if (!user || !projectId) return;
    useSavedSequencesStore.getState().list().catch(() => {});
  }, [user, projectId]);

  // Nettoyage du cache de vignettes pour les steps/poses disparus.
  // Le cache est partagé entre les steps du séquenceur et les poses enregistrées :
  // on ne supprime une entrée que si elle ne correspond plus à AUCUN des deux,
  // sinon on entrerait dans une boucle générer → cleanup → régénérer.
  useEffect(() => {
    const liveIds = new Set<string>([
      ...steps.map((s) => s.id),
      ...savedPoses.map((p) => p.id),
    ]);
    const cached = usePoseThumbnailStore.getState().thumbnails;
    for (const id of Object.keys(cached)) {
      if (!liveIds.has(id)) usePoseThumbnailStore.getState().remove(id);
    }
  }, [steps, savedPoses]);

  // ── Auto-enregistrement de la séquence active ──────────────────────────────
  // Toute modification (ajout/suppression/réordonnancement d'étape, pose, durée,
  // transition…) est persistée automatiquement (debounce 700 ms). On compare une
  // signature des étapes DÉFINIES pour ne sauvegarder qu'aux vrais changements ;
  // au chargement d'une séquence (changement d'id actif) la signature devient la
  // référence afin de ne pas réécrire le contenu fraîchement chargé.
  const stepsSignature = useMemo(() => {
    const defined = steps.filter((s) => !s.type || s.type === 'defined');
    return JSON.stringify(
      defined.map((s) => [s.id, s.name, s.pose, s.sourcePoseId ?? null, s.durationS ?? null, s.transition ?? null])
    );
  }, [steps]);
  const lastSavedSigRef = useRef<string | null>(null);
  const lastSeqIdRef = useRef<string | null>(activeSequenceId);
  useEffect(() => {
    // Premier passage (référence nulle) ou changement de séquence active
    // (chargement) : on fixe la référence sans réécrire le contenu courant.
    if (lastSavedSigRef.current === null || lastSeqIdRef.current !== activeSequenceId) {
      lastSeqIdRef.current = activeSequenceId;
      lastSavedSigRef.current = stepsSignature;
      return;
    }
    if (!user || !activeSequenceId) return;
    if (lastSavedSigRef.current === stepsSignature) return;
    const t = setTimeout(() => {
      lastSavedSigRef.current = stepsSignature;
      const defined = useSequencerStore.getState().steps.filter((s) => s.type !== 'interpolated');
      useSavedSequencesStore.getState().updateSteps(activeSequenceId, defined).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [stepsSignature, activeSequenceId, user]);

  // Ancre par défaut la boîte « Lecture » (seq-ctrl) dans l'emplacement de la
  // barre d'outils, une seule fois par appareil : les profils existants la
  // gardaient flottante. L'utilisateur peut ensuite la dés-épingler librement.
  useEffect(() => {
    const KEY = 'hexagram.seqctrl-docked-default-v2';
    try {
      if (localStorage.getItem(KEY)) return;
      localStorage.setItem(KEY, '1');
    } catch { /* ignore */ }
    const cfg = useToolboxStore.getState().configs['seq-ctrl'];
    if (cfg && cfg.panel === null) {
      useToolboxStore.getState().dock('seq-ctrl', 'sequencer', 0);
    }
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
    const ok = await confirmDialog({
      title: 'Supprimer la séquence',
      message: `Voulez-vous vraiment supprimer la séquence « ${sequenceName} » ?`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await useSavedSequencesStore.getState().remove(activeSequenceId);
      useSequencerStore.getState().loadSteps([], 'Séquence');
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
  // Calcule le gap d'insertion visé selon la moitié de colonne survolée
  // (colonne interpolée → segment auquel elle appartient).
  const gapFromColumn = (e: DragEvent<HTMLDivElement>, definedBefore: number, isInterp: boolean): number => {
    if (isInterp) return definedBefore;
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientX < rect.left + rect.width / 2 ? definedBefore : definedBefore + 1;
  };
  const onColDragStart = (e: DragEvent<HTMLDivElement>, definedBefore: number) => {
    setDragColFrom(definedBefore);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onColDragOver = (e: DragEvent<HTMLDivElement>, definedBefore: number, isInterp: boolean) => {
    e.preventDefault();
    const idx = gapFromColumn(e, definedBefore, isInterp);
    // Drag d'une pose (copie) vs déplacement d'une étape (move) : même calcul, états distincts.
    if (hasPoseInDrag(e)) {
      e.dataTransfer.dropEffect = 'copy';
      if (poseDropIndex !== idx) setPoseDropIndex(idx);
      return;
    }
    e.dataTransfer.dropEffect = 'move';
    if (colDropIndex !== idx) setColDropIndex(idx);
  };
  const onColDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (hasPoseInDrag(e)) { onPoseDrop(e); return; }
    if (dragColFrom !== null && colDropIndex !== null) {
      useSequencerStore.getState().reorderStep(dragColFrom, colDropIndex);
    }
    setDragColFrom(null);
    setColDropIndex(null);
  };
  const onColDragEnd = () => { setDragColFrom(null); setColDropIndex(null); };

  // Resize du panneau
  const resizeStartRef = useRef<{ y: number; h: number } | null>(null);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizeStartRef.current = { y: e.clientY, h: useSequencerStore.getState().panelHeight };
    setIsResizing(true);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
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
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []);

  // Drop d'une pose enregistrée → nouvelle étape liée
  const hasPoseInDrag = (e: DragEvent<HTMLDivElement>): boolean => {
    for (const t of Array.from(e.dataTransfer.types)) {
      if (t === POSE_DRAG_MIME) return true;
    }
    return false;
  };

  const onPoseDragEnter = (e: DragEvent<HTMLDivElement>) => {
    if (!hasPoseInDrag(e)) return;
    e.preventDefault();
    posedragCounter.current++;
    setPosedragActive(true);
    if (!seqOpen) setSequencerOpen(true);
  };

  const onPoseDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasPoseInDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onPoseDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!hasPoseInDrag(e)) return;
    posedragCounter.current = Math.max(0, posedragCounter.current - 1);
    if (posedragCounter.current === 0) {
      setPosedragActive(false);
      setPoseDropIndex(null);
    }
  };

  const onPoseDrop = (e: DragEvent<HTMLDivElement>) => {
    const poseId = e.dataTransfer.getData(POSE_DRAG_MIME);
    const targetIndex = poseDropIndex;
    posedragCounter.current = 0;
    setPosedragActive(false);
    setPoseDropIndex(null);
    if (!poseId) return;
    e.preventDefault();
    e.stopPropagation();
    const sp = useSavedPosesStore.getState().getById(poseId);
    if (!sp) return;
    const definedCount = useSequencerStore.getState().steps.filter((st) => !st.type || st.type === 'defined').length;
    // Sans colonne survolée (drop sur une zone vide du panneau), on ajoute à la fin.
    useSequencerStore.getState().insertStep(sp.angles, targetIndex ?? definedCount, sp.name, sp.id);
  };

  // Ajout d'étape depuis la barre d'outils : désélectionne d'abord l'étape
  // active (en arbitrant ses modifications non enregistrées), puis exécute
  // l'action d'ajout.
  const addStepInline = async (action: () => void) => {
    if (selectedStepIndex !== -1) {
      if (!(await guardStepEdit())) return;
      useSequencerStore.getState().setSelectedStepIndex(-1);
    }
    action();
  };

  const handleStepClick = async (colIdx: number) => {
    const step = steps[colIdx];
    if (!step) return;
    const isAlreadySelected = selectedStepIndex === colIdx;
    // Si la pose de l'étape courante a été modifiée sans être appliquée,
    // on propose de l'enregistrer avant de changer (ou de désélectionner).
    if (!(await guardStepEdit())) return;
    // Si une pose de la boîte « Poses » était sélectionnée et modifiée, on la
    // traite aussi (exclusion mutuelle : activer une étape désélectionne la pose).
    if (!(await guardPoseEdit())) return;
    useSavedPosesStore.getState().setSelectedPoseId(null);
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

      {/* ── Add-step modal (neutre / dupliquer / importer) ─── */}
      <SequenceAddStepModal open={showAddStepModal} initialView={addStepInitialView} onClose={() => setShowAddStepModal(false)} />

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
        className={`sequencer-panel${seqOpen ? ' open' : ''}${isResizing ? ' resizing' : ''}${isDraggingToSeq ? ' seq-drop-zone' : ''}${posedragActive ? ' seq-pose-drop-zone' : ''}`}
        // eslint-disable-next-line react/forbid-component-props
        style={{ '--seq-panel-h': `${panelHeight}px` } as React.CSSProperties}
        onDragEnter={onPoseDragEnter}
        onDragOver={onPoseDragOver}
        onDragLeave={onPoseDragLeave}
        onDrop={onPoseDrop}
      >

        {/* ── Onglet / poignée ──────────────────────────── */}
        <button
          type="button"
          className="seq-panel-handle"
          data-dock-panel="sequencer"
          onClick={() => setSequencerOpen(!seqOpen)}
          title={`${seqOpen ? 'Fermer' : 'Ouvrir'} le séquenceur${steps.length > 0 ? ` · ${steps.length} étape${steps.length !== 1 ? 's' : ''}` : ''}`}
        >
          Séquenceur {seqOpen ? '▾' : '▴'}
        </button>

        {/* ── Contenu collapsible ───────────────────────── */}
        <div className="sequencer-content" data-dock-panel="sequencer">

          {/* Bord de redimensionnement */}
          <div className="seq-resize-handle" onPointerDown={handleResizeStart} />

          {/* Toolbar — une seule zone agrandie */}
          <div className="seq-toolbar">
            {/* Gauche : réglages globaux */}
            <div className="seq-toolbar-left">
              <label className="seq-ctrl">
                <span className="seq-ctrl-label">Trans.</span>
                <input
                  type="range" min="0.1" max="1.5" step="0.1"
                  value={transitionSpeed}
                  onChange={(e) => useSequencerStore.getState().setTransitionSpeed(Number(e.target.value))}
                  title={`Durée de transition par défaut : ${transitionSpeed.toFixed(1)} s`}
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

              <label className="seq-interp-toggle" title="Afficher / masquer les étapes interpolées dans le tableau">
                <input
                  type="checkbox"
                  checked={showInterpolated}
                  onChange={() => useSequencerStore.getState().toggleShowInterpolated()}
                />
                <span>Interpolées</span>
              </label>
            </div>

            {/* Centre : ajout d'étape (pleine hauteur) · Annuler · boîte ancrée */}
            <div className="seq-addstep-bar">
              <button
                type="button"
                className="seq-add-inline"
                onClick={() => addStepInline(() => useSequencerStore.getState().addStep(useHexapodStore.getState().pose, undefined, null))}
                title="Ajouter une étape capturant la pose 3D actuelle"
              >
                <span className="seq-add-inline-ic">◉</span>
                <span>État courant</span>
              </button>
              <button
                type="button"
                className="seq-add-inline"
                onClick={() => addStepInline(() => useSequencerStore.getState().addStep(defaultPose(), undefined, null))}
                title="Ajouter une étape neutre (pose par défaut)"
              >
                <span className="seq-add-inline-ic">⊕</span>
                <span>Neutre</span>
              </button>
              <button
                type="button"
                className="seq-add-inline"
                disabled={!lastDefinedStep}
                onClick={() => addStepInline(() => { if (lastDefinedStep) useSequencerStore.getState().duplicateStep(lastDefinedStep.id); })}
                title={lastDefinedStep ? 'Dupliquer la dernière étape' : 'Aucune étape à dupliquer'}
              >
                <span className="seq-add-inline-ic">⧉</span>
                <span>Dupliquer</span>
              </button>
              <button
                type="button"
                className="seq-add-inline"
                onClick={() => addStepInline(() => { setAddStepInitialView('sequences'); setShowAddStepModal(true); })}
                title="Importer une étape d'une autre séquence"
              >
                <span className="seq-add-inline-ic">↧</span>
                <span>Importer</span>
              </button>

              <button
                type="button"
                className="seq-btn seq-undo-btn"
                onClick={() => useSequencerStore.getState().undo()}
                disabled={history.length === 0}
                title={`Annuler (${history.length} disponible${history.length > 1 ? 's' : ''})`}
              >
                ↩
              </button>

              {/* Emplacement d'accueil d'une boîte d'outils (Lecture par défaut) */}
              <div className="seq-dock-slot" data-dock-panel="sequencer">
                <ToolboxSlot panel="sequencer" />
              </div>
            </div>

            {/* Droite : gestion de la séquence */}
            <div className="seq-toolbar-right">
              {user ? (
                <>
                  {/* Nouvelle séquence — bouton mis en avant, à gauche du sélecteur */}
                  <button
                    type="button"
                    className="seq-btn-newseq"
                    onClick={() => { setIsNewSequence(true); setShowSaveModal(true); }}
                    title="Nouvelle séquence (vide le séquenceur)"
                  >
                    <span className="seq-btn-newseq-ic">＋</span>
                    <span>Nouvelle séquence</span>
                  </button>

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
                        disabled={!activeSequenceId}
                      >
                        Renommer
                      </button>
                      <button
                        type="button"
                        className="seq-options-item"
                        onClick={handleDuplicate}
                        disabled={!activeSequenceId}
                      >
                        Dupliquer
                      </button>
                      <div className="seq-options-sep" />
                      <button
                        type="button"
                        className="seq-options-item seq-options-item-danger"
                        onClick={handleDelete}
                        disabled={!activeSequenceId}
                      >
                        Supprimer
                      </button>
                    </div>,
                    document.body
                  )}
                </>
              ) : (
                <span className="seq-demo-name">{sequenceName}</span>
              )}
            </div>
          </div>

          {/* Erreur de lecture */}
          {playError && (
            <div className="seq-play-error" onClick={() => useSequencerStore.getState().setPlayError(null)} title="Cliquer pour fermer">
              ⚠ {playError}
            </div>
          )}

          {/* Timeline */}
          <div className="seq-scroll-wrapper">
            <div className="seq-inner">

              {/* Sticky servo labels column */}
              <div className="seq-sticky-labels">
                <div className="seq-step-thumb-row seq-step-thumb-row-spacer" aria-hidden="true" />
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
                    {tabletMode && (
                      <span className="seq-row-move">
                        <button
                          type="button"
                          className="seq-icon-btn"
                          disabled={orderIdx === 0}
                          onClick={() => {
                            const next = useSequencerStore.getState().servoOrder.slice();
                            [next[orderIdx - 1], next[orderIdx]] = [next[orderIdx], next[orderIdx - 1]];
                            useSequencerStore.getState().reorderServos(next);
                          }}
                          title="Monter la ligne"
                        >↑</button>
                        <button
                          type="button"
                          className="seq-icon-btn"
                          disabled={orderIdx === servoOrder.length - 1}
                          onClick={() => {
                            const next = useSequencerStore.getState().servoOrder.slice();
                            [next[orderIdx + 1], next[orderIdx]] = [next[orderIdx], next[orderIdx + 1]];
                            useSequencerStore.getState().reorderServos(next);
                          }}
                          title="Descendre la ligne"
                        >↓</button>
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Step columns */}
              {displayedSteps.map((step) => {
                const colIdx = steps.indexOf(step);
                const isInterp = step.type === 'interpolated';
                const isLinked = !!step.sourcePoseId;
                const linkedPoseName = isLinked
                  ? savedPoses.find((p) => p.id === step.sourcePoseId)?.name
                  : null;
                // Nombre d'étapes définies situées avant cette colonne (= son propre index défini si elle est définie).
                const definedBefore = steps.slice(0, colIdx).filter((st) => !st.type || st.type === 'defined').length;
                return (
                  <div
                    key={step.id}
                    className={`seq-step-col${isInterp ? ' interpolated' : ''}${isLinked ? ' linked' : ''}${currentStepIndex === colIdx || selectedStepIndex === colIdx ? ' active' : ''}${!isInterp && activeInsertGap === definedBefore ? ' seq-insert-before' : ''}`}
                    draggable={!isInterp}
                    onDragStart={isInterp ? undefined : (e) => onColDragStart(e, definedBefore)}
                    onDragOver={(e) => onColDragOver(e, definedBefore, isInterp)}
                    onDrop={onColDrop}
                    onDragEnd={onColDragEnd}
                  >
                    <div
                      className={`seq-step-thumb-row${isInterp ? ' is-interp' : ''}`}
                      onClick={() => !isInterp && handleStepClick(colIdx)}
                    >
                      {!isInterp && <PoseThumbnail id={step.id} pose={step.pose} alt={`Pose ${step.name}`} />}
                    </div>
                    <div className="seq-hdr-cell seq-step-hdr">
                      <span
                        className="seq-step-name"
                        title={step.name}
                        onClick={() => handleStepClick(colIdx)}
                      >
                        {isLinked && (
                          <span
                            className="seq-step-link-badge"
                            title={linkedPoseName ? `Liée à la pose « ${linkedPoseName} »` : 'Pose source supprimée'}
                          >🔗</span>
                        )}
                        {step.name}
                      </span>
                      <span className="seq-step-actions">
                        {tabletMode && !isInterp && (
                          <>
                            <button
                              type="button"
                              className="seq-icon-btn"
                              disabled={definedBefore === 0}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                useSequencerStore.getState().reorderStep(definedBefore, definedBefore - 1);
                              }}
                              title="Déplacer vers la gauche"
                            >◀</button>
                            <button
                              type="button"
                              className="seq-icon-btn"
                              disabled={definedBefore >= definedCount - 1}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                useSequencerStore.getState().reorderStep(definedBefore, definedBefore + 2);
                              }}
                              title="Déplacer vers la droite"
                            >▶</button>
                          </>
                        )}
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
                          {!isInterp && (
                            <div className="seq-step-ctx-fields" onMouseDown={(e) => e.stopPropagation()}>
                              <label className="seq-step-ctx-field">
                                <span>Durée transition (s)</span>
                                <input
                                  type="number"
                                  min="0"
                                  max="10"
                                  step="0.1"
                                  value={step.durationS ?? ''}
                                  placeholder={`défaut ${transitionSpeed.toFixed(1)}`}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    useSequencerStore.getState().setStepDuration(step.id, v === '' ? null : Number(v));
                                  }}
                                />
                              </label>
                              <label className="seq-step-ctx-field">
                                <span>Transition</span>
                                <select
                                  value={step.transition ?? 'linear'}
                                  onChange={(e) =>
                                    useSequencerStore.getState().setStepTransition(step.id, e.target.value as TransitionKind)
                                  }
                                >
                                  <option value="linear">Linéaire</option>
                                  <option value="ease">Adoucie</option>
                                  <option value="instant">Instantanée (saut)</option>
                                </select>
                              </label>
                              <div className="seq-options-sep" />
                            </div>
                          )}
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
                          {isLinked && (
                            <button
                              type="button"
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={() => { useSequencerStore.getState().unlinkStep(step.id); setStepMenuId(null); }}
                              title="L'étape devient indépendante de la pose source"
                            >Rompre le lien</button>
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
                    {!isInterp && (
                      <button
                        type="button"
                        className={`seq-step-trans${(step.durationS !== undefined || (step.transition ?? 'linear') !== 'linear') ? ' custom' : ''}`}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setStepMenuId(stepMenuId === step.id ? null : step.id);
                          setStepMenuRect(rect);
                        }}
                        title={`Durée ${(step.durationS ?? transitionSpeed).toFixed(1)} s · transition ${TRANSITION_LABEL[step.transition ?? 'linear']} — cliquer pour régler`}
                      >
                        {(step.durationS ?? transitionSpeed).toFixed(1)}s {TRANSITION_ICON[step.transition ?? 'linear']}
                      </button>
                    )}
                    {servoOrder.map((servoId) => (
                      <div key={servoId} className="seq-cell">
                        {step.pose[servoId] !== undefined ? `${step.pose[servoId].toFixed(1)}°` : '—'}
                      </div>
                    ))}
                  </div>
                );
              })}

              {/* Add-step column */}
              <div
                className={`seq-add-col${activeInsertGap === definedCount ? ' seq-insert-before' : ''}`}
                onDragOver={(e) => {
                  if (hasPoseInDrag(e)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    if (poseDropIndex !== definedCount) setPoseDropIndex(definedCount);
                  } else if (dragColFrom !== null) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (colDropIndex !== definedCount) setColDropIndex(definedCount);
                  }
                }}
                onDrop={onColDrop}
              >
                <div className="seq-step-thumb-row seq-step-thumb-row-spacer" aria-hidden="true" />
                <div className="seq-hdr-cell">
                  <button
                    type="button"
                    className="seq-add-btn"
                    onClick={async () => {
                      // Désélectionne l'étape active (en gardant ses modifs non enregistrées).
                      if (selectedStepIndex !== -1) {
                        if (!(await guardStepEdit())) return;
                        useSequencerStore.getState().setSelectedStepIndex(-1);
                      }
                      setAddStepInitialView('menu');
                      setShowAddStepModal(true);
                    }}
                    title="Ajouter une étape (neutre, copie, ou import d'une autre séquence)"
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
