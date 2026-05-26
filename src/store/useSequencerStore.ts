import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Pose } from '../model/pose';
import { SERVOS, LEG_NAMES } from '../model/hexapod';
import { useHexapodStore } from './useHexapodStore';

export type StepType = 'defined' | 'interpolated';

export interface SequencerStep {
  id: string;
  name: string;
  pose: Pose;
  type: StepType;
}

export const MAX_FPS = 40;

const MAX_HISTORY = 20;

// Module-level playback timer (shared across components)
let _timer: ReturnType<typeof setTimeout> | null = null;

function _clearTimer() {
  if (_timer !== null) { clearTimeout(_timer); _timer = null; }
}

function _scheduleStep(idx: number) {
  const s = useSequencerStore.getState();
  if (!s.isPlaying || s.steps.length === 0) return;
  const stepIdx = idx % s.steps.length;
  s.setCurrentStepIndex(stepIdx);
  useHexapodStore.getState().applyPose(s.steps[stepIdx].pose);
  const { transitionSpeed, stepDelay, playbackSpeed } = useSequencerStore.getState();
  const speed = playbackSpeed > 0 ? playbackSpeed : 1;
  _timer = setTimeout(() => _scheduleStep(stepIdx + 1), ((transitionSpeed + stepDelay) * 1000) / speed);
}

interface SequencerState {
  steps: SequencerStep[];
  servoOrder: number[];
  transitionSpeed: number;
  stepDelay: number;
  playbackSpeed: number;
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

  addStep: (pose: Pose, name?: string) => void;
  duplicateStep: (id: string) => void;
  removeStep: (id: string) => void;
  moveStep: (fromIdx: number, toIdx: number) => void;
  reorderServos: (order: number[]) => void;
  setTransitionSpeed: (v: number) => void;
  setStepDelay: (v: number) => void;
  setPlaybackSpeed: (v: number) => void;
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
  updateStepName: (id: string, name: string) => void;
  updateStepPose: (id: string, pose: Pose) => void;
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

// Reconstruit la liste complète (définies + interpolées avec bouclage) à partir des seules étapes définies.
function buildInterpolated(defined: SequencerStep[], stepDelay: number): SequencerStep[] {
  if (defined.length < 2) return defined.slice();
  const insertCount = Math.max(0, Math.round(stepDelay * MAX_FPS) - 1);
  const result: SequencerStep[] = [];
  const stamp = Date.now();
  for (let i = 0; i < defined.length - 1; i++) {
    result.push(defined[i]);
    const from = defined[i].pose;
    const to = defined[i + 1].pose;
    for (let f = 1; f <= insertCount; f++) {
      const t = f / (insertCount + 1);
      result.push({
        id: `interp-${stamp}-${i}-${f}-${Math.random().toString(36).slice(2, 5)}`,
        name: `↔ ${i + 1}.${f}`,
        type: 'interpolated',
        pose: from.map((angle, k) => angle + (to[k] - angle) * t),
      });
    }
  }
  result.push(defined[defined.length - 1]);
  // Bouclage : interpolation entre la dernière et la première (la lecture revient à 0 via modulo)
  const fromLast = defined[defined.length - 1].pose;
  const toFirst = defined[0].pose;
  for (let f = 1; f <= insertCount; f++) {
    const t = f / (insertCount + 1);
    result.push({
      id: `interp-${stamp}-loop-${f}-${Math.random().toString(36).slice(2, 5)}`,
      name: `↔ ${defined.length}.${f}`,
      type: 'interpolated',
      pose: fromLast.map((angle, k) => angle + (toFirst[k] - angle) * t),
    });
  }
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

      addStep: (pose, name) =>
        set((s) => {
          const defined = onlyDefined(s.steps);
          const newStep: SequencerStep = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: name ?? `Étape ${defined.length + 1}`,
            pose: pose.slice(),
            type: 'defined',
          };
          const newDefined = [...defined, newStep];
          const newSteps = buildInterpolated(newDefined, s.stepDelay);
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
          };
          const newDefined = defined.slice();
          newDefined.splice(idx + 1, 0, copy);
          const newSteps = buildInterpolated(newDefined, s.stepDelay);
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
            steps: buildInterpolated(newDefined, s.stepDelay),
            history: pushHistory(s.history, s.steps),
            future: [],
            selectedStepIndex: -1,
          };
        }),

      moveStep: (fromIdx, toIdx) =>
        set((s) => {
          if (fromIdx === toIdx) return s;
          const moved = s.steps[fromIdx];
          if (!moved || moved.type === 'interpolated') return s;
          const defined = onlyDefined(s.steps);
          const fromDef = defined.findIndex((st) => st.id === moved.id);
          if (fromDef === -1) return s;
          // Position cible dans les défined : compter les défined avant toIdx (en excluant le step déplacé).
          let toDef = 0;
          for (let i = 0; i < toIdx && i < s.steps.length; i++) {
            const st = s.steps[i];
            if ((!st.type || st.type === 'defined') && st.id !== moved.id) toDef++;
          }
          if (toDef > defined.length - 1) toDef = defined.length - 1;
          const newDefined = defined.slice();
          newDefined.splice(fromDef, 1);
          newDefined.splice(toDef, 0, moved);
          return {
            steps: buildInterpolated(newDefined, s.stepDelay),
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      reorderServos: (order) => set({ servoOrder: order }),

      setTransitionSpeed: (v) => set({ transitionSpeed: v }),
      setStepDelay: (v) =>
        set((s) => ({
          stepDelay: v,
          steps: buildInterpolated(onlyDefined(s.steps), v),
        })),
      setPlaybackSpeed: (v) => set({ playbackSpeed: v }),
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
            steps: buildInterpolated(newDefined, s.stepDelay),
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      generateInterpolations: () =>
        set((s) => ({
          steps: buildInterpolated(onlyDefined(s.steps), s.stepDelay),
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
            steps: buildInterpolated(onlyDefined(converted), s.stepDelay),
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
            steps: buildInterpolated(onlyDefined(normalized), s.stepDelay),
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
        panelHeight: s.panelHeight,
        sequenceName: s.sequenceName,
        showInterpolated: s.showInterpolated,
      }),
    }
  )
);
