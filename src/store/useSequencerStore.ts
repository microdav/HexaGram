import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Pose } from '../model/pose';

export type StepType = 'defined' | 'interpolated';

export interface SequencerStep {
  id: string;
  name: string;
  pose: Pose;
  type: StepType;
}

export const MAX_FPS = 40;

const MAX_HISTORY = 20;

interface SequencerState {
  steps: SequencerStep[];
  servoOrder: number[];
  transitionSpeed: number;
  stepDelay: number;
  currentStepIndex: number;
  selectedStepIndex: number;
  isPlaying: boolean;
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
  setCurrentStepIndex: (i: number) => void;
  setSelectedStepIndex: (i: number) => void;
  setIsPlaying: (v: boolean) => void;
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

export const useSequencerStore = create<SequencerState>()(
  persist(
    (set, get) => ({
      steps: [],
      servoOrder: DEFAULT_SERVO_ORDER,
      transitionSpeed: 0.5,
      stepDelay: 0.3,
      currentStepIndex: -1,
      selectedStepIndex: -1,
      isPlaying: false,
      history: [],
      future: [],
      panelHeight: 258,
      sequenceName: 'Séquence',
      showInterpolated: false,

      addStep: (pose, name) =>
        set((s) => ({
          steps: [
            ...s.steps,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: name ?? `Étape ${s.steps.length + 1}`,
              pose: pose.slice(),
              type: 'defined',
            },
          ],
          selectedStepIndex: s.steps.length,
          history: pushHistory(s.history, s.steps),
          future: [],
        })),

      duplicateStep: (id) =>
        set((s) => {
          const idx = s.steps.findIndex((st) => st.id === id);
          if (idx === -1) return s;
          const src = s.steps[idx];
          const copy: SequencerStep = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: `${src.name} (copie)`,
            pose: src.pose.slice(),
            type: 'defined',
          };
          const next = s.steps.slice();
          next.splice(idx + 1, 0, copy);
          return {
            steps: next,
            selectedStepIndex: idx + 1,
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      removeStep: (id) =>
        set((s) => ({
          steps: s.steps.filter((st) => st.id !== id),
          history: pushHistory(s.history, s.steps),
          future: [],
          selectedStepIndex: -1,
        })),

      moveStep: (fromIdx, toIdx) =>
        set((s) => {
          if (fromIdx === toIdx) return s;
          const next = s.steps.slice();
          const [item] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, item);
          return {
            steps: next,
            history: pushHistory(s.history, s.steps),
            future: [],
          };
        }),

      reorderServos: (order) => set({ servoOrder: order }),

      setTransitionSpeed: (v) => set({ transitionSpeed: v }),
      setStepDelay: (v) => set({ stepDelay: v }),
      setCurrentStepIndex: (i) => set({ currentStepIndex: i }),
      setSelectedStepIndex: (i) => set({ selectedStepIndex: i }),
      setIsPlaying: (v) => set({ isPlaying: v }),
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
        set((s) => ({
          steps: s.steps.map((st) => (st.id === id ? { ...st, pose: pose.slice() } : st)),
          history: pushHistory(s.history, s.steps),
          future: [],
        })),

      generateInterpolations: () =>
        set((s) => {
          const defined = s.steps.filter((st) => !st.type || st.type === 'defined');
          if (defined.length < 2) {
            return {
              steps: defined,
              history: pushHistory(s.history, s.steps),
              future: [],
              selectedStepIndex: -1,
            };
          }
          const insertCount = Math.max(0, Math.round(s.stepDelay * MAX_FPS) - 1);
          const result: SequencerStep[] = [];
          for (let i = 0; i < defined.length - 1; i++) {
            result.push(defined[i]);
            const from = defined[i].pose;
            const to = defined[i + 1].pose;
            for (let f = 1; f <= insertCount; f++) {
              const t = f / (insertCount + 1);
              result.push({
                id: `interp-${Date.now()}-${i}-${f}-${Math.random().toString(36).slice(2, 5)}`,
                name: `↔ ${i + 1}.${f}`,
                type: 'interpolated',
                pose: from.map((angle, k) => angle + (to[k] - angle) * t),
              });
            }
          }
          result.push(defined[defined.length - 1]);
          return {
            steps: result,
            history: pushHistory(s.history, s.steps),
            future: [],
            selectedStepIndex: -1,
          };
        }),

      convertToDefined: (id) =>
        set((s) => ({
          steps: s.steps.map((st) => (st.id === id ? { ...st, type: 'defined' } : st)),
          history: pushHistory(s.history, s.steps),
          future: [],
        })),

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

      loadSteps: (steps, name) =>
        set((s) => ({
          steps: steps.map((st) => ({ ...st, type: st.type ?? 'defined' })),
          sequenceName: name ?? s.sequenceName,
          history: pushHistory(s.history, s.steps),
          future: [],
          selectedStepIndex: -1,
          currentStepIndex: -1,
          isPlaying: false,
        })),

      exportJson: () => JSON.stringify({ steps: get().steps }, null, 2),
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
        panelHeight: s.panelHeight,
        sequenceName: s.sequenceName,
        showInterpolated: s.showInterpolated,
      }),
    }
  )
);
