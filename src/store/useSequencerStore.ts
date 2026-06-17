import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Pose } from '../model/pose';
import { SERVOS, LEG_NAMES } from '../model/hexapod';
import { useHexapodStore } from './useHexapodStore';

export type StepType = 'defined' | 'interpolated';

/**
 * Type de transition menant À une étape définie (segment depuis l'étape
 * précédente). « linear » = interpolation linéaire (défaut historique),
 * « ease » = adouci en entrée/sortie (smoothstep), « instant » = saut direct
 * sans images interpolées.
 */
export type TransitionKind = 'linear' | 'ease' | 'instant';

export interface SequencerStep {
  id: string;
  name: string;
  pose: Pose;
  type: StepType;
  /**
   * Si défini : l'étape "réfère" à une pose enregistrée (useSavedPosesStore).
   * Quand la pose source est modifiée, tous les steps avec ce sourcePoseId
   * sont mis à jour (propagation). Quand l'utilisateur modifie un step lié,
   * un PendingPoseConflict est levé pour proposer "modifier la source" /
   * "rompre le lien".
   */
  sourcePoseId?: string | null;
  /**
   * Durée (s) de la transition menant À cette étape définie depuis la
   * précédente. Absent ⇒ on retombe sur la durée globale (`transitionSpeed`).
   * Gouverne le nombre d'images interpolées du segment + son timing de lecture.
   */
  durationS?: number;
  /** Type de transition du segment menant à cette étape (cf. TransitionKind). */
  transition?: TransitionKind;
  /**
   * Durée (ms) d'affichage de cette image avant de passer à la suivante.
   * Dérivée (jamais persistée) : recalculée par `buildInterpolated`. Pilote
   * le minutage de la lecture (`_scheduleStep`).
   */
  frameMs?: number;
  /**
   * Vignette PNG (dataURL) persistée avec la séquence. Hydrate le cache de
   * vignettes à l'ouverture, évitant un re-rendu offscreen systématique.
   * `thumbnailContext` permet d'invalider si le contexte de rendu a changé.
   */
  thumbnail?: string | null;
  thumbnailContext?: string | null;
}

/** Conflit en attente : un step lié à une pose source vient d'être édité. */
export interface PendingPoseConflict {
  stepId: string;
  sourcePoseId: string;
  newPose: Pose;
}

export const MAX_FPS = 40;

const MAX_HISTORY = 20;

// Module-level playback timer (shared across components)
let _timer: ReturnType<typeof setTimeout> | null = null;

function _clearTimer() {
  if (_timer !== null) { clearTimeout(_timer); _timer = null; }
}

/** Indice de la dernière étape DÉFINIE (les images de bouclage sont après elle). */
function _lastDefinedIndex(steps: SequencerStep[]): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    if (!steps[i].type || steps[i].type === 'defined') return i;
  }
  return steps.length - 1;
}

function _scheduleStep(idx: number) {
  const s = useSequencerStore.getState();
  if (!s.isPlaying || s.steps.length === 0) return;
  const n = s.steps.length;
  // En boucle : modulo (lecture continue, via les images de retour). Sans boucle :
  // index direct, on s'arrêtera après la dernière étape définie.
  const stepIdx = s.loop ? ((idx % n) + n) % n : idx;
  if (stepIdx >= n) {
    useSequencerStore.setState({ isPlaying: false, isPaused: false, currentStepIndex: -1 });
    return;
  }
  s.setCurrentStepIndex(stepIdx);
  const frame = s.steps[stepIdx];
  useHexapodStore.getState().applyPose(frame.pose);
  const { transitionSpeed, stepDelay, playbackSpeed } = useSequencerStore.getState();
  const speed = playbackSpeed > 0 ? playbackSpeed : 1;
  // Minutage par image : `frameMs` (tranche de transition, dérivée par
  // buildInterpolated) + le délai d'arrêt à chaque étape DÉFINIE. Repli sur
  // l'ancienne formule globale pour les images sans timing dérivé.
  const sliceMs = frame.frameMs ?? transitionSpeed * 1000;
  const holdMs = frame.type !== 'interpolated' ? stepDelay * 1000 : 0;
  const waitMs = (sliceMs + holdMs) / speed;
  // Sans boucle : une fois la dernière étape définie affichée (et maintenue son
  // délai), la lecture s'arrête — les images de retour vers la 1re ne sont pas jouées.
  if (!s.loop && stepIdx >= _lastDefinedIndex(s.steps)) {
    _timer = setTimeout(() => {
      useSequencerStore.setState({ isPlaying: false, isPaused: false, currentStepIndex: -1 });
    }, waitMs);
    return;
  }
  _timer = setTimeout(() => _scheduleStep(stepIdx + 1), waitMs);
}

interface SequencerState {
  steps: SequencerStep[];
  servoOrder: number[];
  transitionSpeed: number;
  stepDelay: number;
  playbackSpeed: number;
  /** Lecture en boucle (true) ou une seule fois (false). Persisté. */
  loop: boolean;
  currentStepIndex: number;
  selectedStepIndex: number;
  isPlaying: boolean;
  isPaused: boolean;
  playError: string | null;
  history: SequencerStep[][];
  future: SequencerStep[][];
  panelHeight: number;
  sequenceName: string;
  showInterpolated: boolean;
  /**
   * Si vrai, toute modification de pose de l'étape sélectionnée est appliquée
   * automatiquement (après stabilisation), sans bouton « Appliquer » ni modale.
   * Volontairement non persisté : repart à false à chaque session.
   */
  autoApply: boolean;
  pendingPoseConflict: PendingPoseConflict | null;

  addStep: (pose: Pose, name?: string, sourcePoseId?: string | null) => void;
  insertStep: (pose: Pose, index: number, name?: string, sourcePoseId?: string | null) => void;
  duplicateStep: (id: string) => void;
  removeStep: (id: string) => void;
  reorderStep: (fromDef: number, toGap: number) => void;
  reorderServos: (order: number[]) => void;
  setTransitionSpeed: (v: number) => void;
  setStepDelay: (v: number) => void;
  setPlaybackSpeed: (v: number) => void;
  setLoop: (v: boolean) => void;
  setCurrentStepIndex: (i: number) => void;
  setSelectedStepIndex: (i: number) => void;
  setIsPlaying: (v: boolean) => void;
  setPlayError: (v: string | null) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  setPanelHeight: (h: number) => void;
  setSequenceName: (name: string) => void;
  toggleShowInterpolated: () => void;
  setAutoApply: (v: boolean) => void;
  updateStepName: (id: string, name: string) => void;
  updateStepPose: (id: string, pose: Pose) => void;
  /** Durée (s) de transition menant à cette étape (null = revient au défaut global). */
  setStepDuration: (id: string, durationS: number | null) => void;
  /** Type de transition menant à cette étape (linear / ease / instant). */
  setStepTransition: (id: string, transition: TransitionKind) => void;
  /**
   * Demande la mise à jour de la pose d'un step. Si le step est lié à une
   * pose source, un PendingPoseConflict est levé au lieu d'appliquer
   * directement ; sinon, comportement identique à updateStepPose.
   */
  requestStepPoseUpdate: (id: string, pose: Pose) => void;
  /** Rompt le lien step → pose source (le step devient indépendant). */
  unlinkStep: (id: string) => void;
  /** Propage les nouveaux angles d'une pose source à tous les steps liés. */
  propagatePoseChange: (sourcePoseId: string, angles: Pose) => void;
  /** Met fin au conflit (annulation ou résolution). */
  clearPendingPoseConflict: () => void;
  generateInterpolations: () => void;
  convertToDefined: (id: string) => void;
  undo: () => void;
  redo: () => void;
  exportJson: () => string;
  loadSteps: (steps: SequencerStep[], name?: string) => void;
}

const DEFAULT_SERVO_ORDER = Array.from({ length: 18 }, (_, i) => i);

function pushHistory(history: SequencerStep[][], steps: SequencerStep[]): SequencerStep[][] {
  return [...history.slice(-MAX_HISTORY + 1), steps];
}

/** Adoucissement (smoothstep) pour la transition « ease ». */
function easeT(t: number, kind: TransitionKind): number {
  return kind === 'ease' ? t * t * (3 - 2 * t) : t;
}

// Reconstruit la liste complète (définies + interpolées avec bouclage) à partir
// des seules étapes définies. Chaque segment menant à l'étape `b` adopte SA
// durée (`b.durationS`, repli sur `defaultDurationS`) et SON type de transition
// (`b.transition`) : nombre d'images interpolées, courbe et minutage de lecture
// (`frameMs`). Exporté pour que d'autres écrans (génération du script série dans
// l'onglet Électronique) reproduisent à l'identique les images jouées.
export function buildInterpolated(defined: SequencerStep[], defaultDurationS: number): SequencerStep[] {
  if (defined.length < 2) return defined.slice();
  const result: SequencerStep[] = [];
  const stamp = Date.now();

  // Construit le segment from→to gouverné par les réglages de `to`. Pousse
  // d'abord l'image de départ (taguée du `frameMs` du segment sortant), puis
  // les images interpolées. L'étape d'arrivée est poussée par le segment suivant.
  const pushSegment = (
    from: SequencerStep,
    to: SequencerStep,
    label: (f: number) => string,
    idTag: string,
  ) => {
    const kind = to.transition ?? 'linear';
    const durS = Math.max(0, to.durationS ?? defaultDurationS);
    const insertCount = kind === 'instant' ? 0 : Math.max(0, Math.round(durS * MAX_FPS) - 1);
    const sliceMs = kind === 'instant' ? 0 : (durS * 1000) / (insertCount + 1);
    // Image de départ : on la rejoue avec le timing du segment sortant.
    result.push({ ...from, frameMs: sliceMs });
    for (let f = 1; f <= insertCount; f++) {
      const t = easeT(f / (insertCount + 1), kind);
      result.push({
        id: `interp-${stamp}-${idTag}-${f}-${Math.random().toString(36).slice(2, 5)}`,
        name: label(f),
        type: 'interpolated',
        frameMs: sliceMs,
        pose: from.pose.map((angle, k) => angle + (to.pose[k] - angle) * t),
      });
    }
  };

  for (let i = 0; i < defined.length - 1; i++) {
    pushSegment(defined[i], defined[i + 1], (f) => `↔ ${i + 1}.${f}`, String(i));
  }
  // Bouclage : segment dernière → première (la lecture revient à 0 via modulo),
  // gouverné par les réglages de la première étape.
  pushSegment(defined[defined.length - 1], defined[0], (f) => `↔ ${defined.length}.${f}`, 'loop');
  return result;
}

function onlyDefined(steps: SequencerStep[]): SequencerStep[] {
  return steps.filter((st) => !st.type || st.type === 'defined');
}

export const useSequencerStore = create<SequencerState>()(
  persist(
    (set, get) => ({
      steps: [],
      servoOrder: DEFAULT_SERVO_ORDER,
      transitionSpeed: 0.5,
      stepDelay: 0.3,
      playbackSpeed: 1,
      loop: true,
      currentStepIndex: -1,
      selectedStepIndex: -1,
      isPlaying: false,
      isPaused: false,
      playError: null,
      history: [],
      future: [],
      panelHeight: 258,
      sequenceName: 'Séquence',
      showInterpolated: false,
      autoApply: false,
      pendingPoseConflict: null,

      addStep: (pose, name, sourcePoseId) =>
        set((s) => {
          const defined = onlyDefined(s.steps);
          const newStep: SequencerStep = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: name ?? `Étape ${defined.length + 1}`,
            pose: pose.slice(),
            type: 'defined',
            sourcePoseId: sourcePoseId ?? null,
          };
          const newDefined = [...defined, newStep];
          const newSteps = buildInterpolated(newDefined, s.transitionSpeed);
          return {
            steps: newSteps,
            selectedStepIndex: newSteps.findIndex((st) => st.id === newStep.id),
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      insertStep: (pose, index, name, sourcePoseId) =>
        set((s) => {
          const defined = onlyDefined(s.steps);
          const at = Math.max(0, Math.min(index, defined.length));
          const newStep: SequencerStep = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: name ?? `Étape ${defined.length + 1}`,
            pose: pose.slice(),
            type: 'defined',
            sourcePoseId: sourcePoseId ?? null,
          };
          const newDefined = defined.slice();
          newDefined.splice(at, 0, newStep);
          const newSteps = buildInterpolated(newDefined, s.transitionSpeed);
          return {
            steps: newSteps,
            selectedStepIndex: newSteps.findIndex((st) => st.id === newStep.id),
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      duplicateStep: (id) =>
        set((s) => {
          const defined = onlyDefined(s.steps);
          const idx = defined.findIndex((st) => st.id === id);
          if (idx === -1) return s;
          const src = defined[idx];
          const copy: SequencerStep = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: `${src.name} (copie)`,
            pose: src.pose.slice(),
            type: 'defined',
            sourcePoseId: src.sourcePoseId ?? null,
          };
          const newDefined = defined.slice();
          newDefined.splice(idx + 1, 0, copy);
          const newSteps = buildInterpolated(newDefined, s.transitionSpeed);
          return {
            steps: newSteps,
            selectedStepIndex: newSteps.findIndex((st) => st.id === copy.id),
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      removeStep: (id) =>
        set((s) => {
          const newDefined = onlyDefined(s.steps).filter((st) => st.id !== id);
          return {
            steps: buildInterpolated(newDefined, s.transitionSpeed),
            history: pushHistory(s.history, s.steps),
            future: [],
            selectedStepIndex: -1,
          };
        }),

      // Déplace l'étape définie d'indice fromDef vers le gap d'insertion toGap
      // (0 = avant la 1re définie, N = après la dernière).
      reorderStep: (fromDef, toGap) =>
        set((s) => {
          const defined = onlyDefined(s.steps);
          if (fromDef < 0 || fromDef >= defined.length) return s;
          let to = Math.max(0, Math.min(toGap, defined.length));
          // Insérer juste avant ou juste après soi-même = aucun changement.
          if (to === fromDef || to === fromDef + 1) return s;
          const newDefined = defined.slice();
          const [moved] = newDefined.splice(fromDef, 1);
          if (fromDef < to) to -= 1; // le retrait décale les indices au-delà de fromDef
          newDefined.splice(to, 0, moved);
          return {
            steps: buildInterpolated(newDefined, s.transitionSpeed),
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      reorderServos: (order) => set({ servoOrder: order }),

      // `transitionSpeed` est la durée de transition par défaut (segments sans
      // durée propre) : la changer recalcule les images + leur minutage.
      setTransitionSpeed: (v) =>
        set((s) => ({
          transitionSpeed: v,
          steps: buildInterpolated(onlyDefined(s.steps), v),
        })),
      // `stepDelay` = délai d'arrêt à chaque étape (appliqué à la lecture) : il
      // n'influe plus sur le nombre d'images, donc aucun recalcul nécessaire.
      setStepDelay: (v) => set({ stepDelay: v }),
      setPlaybackSpeed: (v) => set({ playbackSpeed: v }),
      setLoop: (v) => set({ loop: v }),
      setCurrentStepIndex: (i) => set({ currentStepIndex: i }),
      setSelectedStepIndex: (i) => set({ selectedStepIndex: i }),
      setIsPlaying: (v) => set({ isPlaying: v }),
      setPlayError: (v) => set({ playError: v }),

      play: () => {
        const s = get();
        if (s.isPaused) {
          set({ isPlaying: true, isPaused: false });
          _scheduleStep(s.currentStepIndex >= 0 ? s.currentStepIndex : 0);
          return;
        }
        if (s.isPlaying) return;
        const definedBefore = s.steps.filter((st) => !st.type || st.type === 'defined').length;
        get().generateInterpolations();
        const after = get();
        if (after.steps.length === 0) {
          if (definedBefore > 0) {
            set({ playError: `Impossible de générer les interpolations : ${definedBefore} étape${definedBefore > 1 ? 's' : ''} définie${definedBefore > 1 ? 's' : ''} mais aucune n'a pu être traitée. Vérifiez que les poses sont valides.` });
          }
          return;
        }
        set({ isPlaying: true, isPaused: false, selectedStepIndex: -1, playError: null });
        _scheduleStep(0);
      },

      pause: () => {
        _clearTimer();
        set({ isPlaying: false, isPaused: true });
      },

      stop: () => {
        _clearTimer();
        const { steps } = useSequencerStore.getState();
        const firstDefined = steps.find((st) => st.type !== 'interpolated') ?? steps[0];
        if (firstDefined) useHexapodStore.getState().applyPose(firstDefined.pose);
        set({
          isPlaying: false,
          isPaused: false,
          currentStepIndex: -1,
          selectedStepIndex: firstDefined ? steps.indexOf(firstDefined) : -1,
        });
      },

      setPanelHeight: (h) => set({ panelHeight: h }),
      setSequenceName: (name) => set({ sequenceName: name }),
      toggleShowInterpolated: () => set((s) => ({ showInterpolated: !s.showInterpolated })),
      setAutoApply: (v) => set({ autoApply: v }),

      updateStepName: (id, name) =>
        set((s) => ({
          steps: s.steps.map((st) => (st.id === id ? { ...st, name } : st)),
          history: pushHistory(s.history, s.steps),
          future: [],
        })),

      updateStepPose: (id, pose) =>
        set((s) => {
          const newDefined = onlyDefined(s.steps).map((st) =>
            st.id === id ? { ...st, pose: pose.slice() } : st
          );
          return {
            steps: buildInterpolated(newDefined, s.transitionSpeed),
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      setStepDuration: (id, durationS) =>
        set((s) => {
          const newDefined = onlyDefined(s.steps).map((st) =>
            st.id === id
              ? { ...st, durationS: durationS == null ? undefined : Math.max(0, durationS) }
              : st
          );
          return {
            steps: buildInterpolated(newDefined, s.transitionSpeed),
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      setStepTransition: (id, transition) =>
        set((s) => {
          const newDefined = onlyDefined(s.steps).map((st) =>
            st.id === id ? { ...st, transition } : st
          );
          return {
            steps: buildInterpolated(newDefined, s.transitionSpeed),
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      requestStepPoseUpdate: (id, pose) => {
        const s = get();
        const step = s.steps.find((st) => st.id === id);
        if (!step) return;
        if (step.sourcePoseId) {
          // Step lié à une pose : on lève un conflit, l'utilisateur arbitre.
          set({
            pendingPoseConflict: {
              stepId: id,
              sourcePoseId: step.sourcePoseId,
              newPose: pose.slice(),
            },
          });
          return;
        }
        get().updateStepPose(id, pose);
      },

      unlinkStep: (id) =>
        set((s) => ({
          steps: s.steps.map((st) =>
            st.id === id ? { ...st, sourcePoseId: null } : st
          ),
        })),

      propagatePoseChange: (sourcePoseId, angles) =>
        set((s) => {
          const newDefined = onlyDefined(s.steps).map((st) =>
            st.sourcePoseId === sourcePoseId ? { ...st, pose: angles.slice() } : st
          );
          return {
            steps: buildInterpolated(newDefined, s.transitionSpeed),
          };
        }),

      clearPendingPoseConflict: () => set({ pendingPoseConflict: null }),

      generateInterpolations: () =>
        set((s) => ({
          steps: buildInterpolated(onlyDefined(s.steps), s.transitionSpeed),
          history: pushHistory(s.history, s.steps),
          future: [],
          selectedStepIndex: -1,
        })),

      convertToDefined: (id) =>
        set((s) => {
          const converted = s.steps.map((st) =>
            st.id === id ? { ...st, type: 'defined' as StepType } : st
          );
          return {
            steps: buildInterpolated(onlyDefined(converted), s.transitionSpeed),
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      undo: () =>
        set((s) => {
          if (s.history.length === 0) return s;
          return {
            steps: s.history[s.history.length - 1],
            history: s.history.slice(0, -1),
            future: [s.steps, ...s.future].slice(0, MAX_HISTORY),
          };
        }),

      redo: () =>
        set((s) => {
          if (s.future.length === 0) return s;
          return {
            steps: s.future[0],
            history: pushHistory(s.history, s.steps),
            future: s.future.slice(1),
          };
        }),

      loadSteps: (steps, name) => {
        _clearTimer();
        set((s) => {
          const normalized = steps.map((st) => ({ ...st, type: st.type ?? 'defined' }));
          return {
            steps: buildInterpolated(onlyDefined(normalized), s.transitionSpeed),
            sequenceName: name ?? s.sequenceName,
            history: pushHistory(s.history, s.steps),
            future: [],
            selectedStepIndex: -1,
            currentStepIndex: -1,
            isPlaying: false,
            isPaused: false,
          };
        });
      },

      exportJson: () => {
        const { steps, transitionSpeed, stepDelay, sequenceName } = get();
        const definedSteps = steps.filter((st) => st.type !== 'interpolated');
        return JSON.stringify(
          {
            name: sequenceName,
            transitionSpeed,
            stepDelay,
            steps: definedSteps.map((st) => ({
              id: st.id,
              name: st.name,
              type: st.type ?? 'defined',
              durationS: st.durationS,
              transition: st.transition ?? 'linear',
              pose: Object.fromEntries(
                SERVOS.map((servo) => [
                  `${LEG_NAMES[servo.legIndex]} - ${servo.joint} (S${servo.id})`,
                  +(st.pose[servo.id] ?? 0).toFixed(2),
                ])
              ),
            })),
          },
          null,
          2
        );
      },
    }),
    {
      name: 'hexagram-sequencer',
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as SequencerState;
        if (version < 1) {
          return {
            ...state,
            showInterpolated: false,
            steps: (state.steps ?? []).map((st) => ({
              ...st,
              type: 'defined' as StepType,
            })),
          };
        }
        return state;
      },
      partialize: (s) => ({
        steps: s.steps,
        servoOrder: s.servoOrder,
        transitionSpeed: s.transitionSpeed,
        stepDelay: s.stepDelay,
        playbackSpeed: s.playbackSpeed,
        loop: s.loop,
        panelHeight: s.panelHeight,
        sequenceName: s.sequenceName,
        showInterpolated: s.showInterpolated,
      }),
    }
  )
);
