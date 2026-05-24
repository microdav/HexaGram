import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Pose } from '../model/pose';

export interface SequencerStep {
  id: string;
  name: string;
  pose: Pose;
}

const MAX_HISTORY = 20;

interface SequencerState {
  steps: SequencerStep[];
  servoOrder: number[];
  transitionSpeed: number;
  stepDelay: number;
  currentStepIndex: number;
  isPlaying: boolean;
  history: SequencerStep[][];
  panelHeight: number;

  addStep: (pose: Pose, name?: string) => void;
  removeStep: (id: string) => void;
  moveStep: (fromIdx: number, toIdx: number) => void;
  reorderServos: (order: number[]) => void;
  setTransitionSpeed: (v: number) => void;
  setStepDelay: (v: number) => void;
  setCurrentStepIndex: (i: number) => void;
  setIsPlaying: (v: boolean) => void;
  setPanelHeight: (h: number) => void;
  undo: () => void;
  exportJson: () => string;
}

const DEFAULT_SERVO_ORDER = Array.from({ length: 18 }, (_, i) => i);

export const useSequencerStore = create<SequencerState>()(
  persist(
    (set, get) => ({
      steps: [],
      servoOrder: DEFAULT_SERVO_ORDER,
      transitionSpeed: 0.5,
      stepDelay: 0.3,
      currentStepIndex: -1,
      isPlaying: false,
      history: [],
      panelHeight: 258,

      addStep: (pose, name) =>
        set((s) => ({
          steps: [
            ...s.steps,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: name ?? `Étape ${s.steps.length + 1}`,
              pose: pose.slice(),
            },
          ],
          history: [...s.history.slice(-MAX_HISTORY + 1), s.steps],
        })),

      removeStep: (id) =>
        set((s) => ({
          steps: s.steps.filter((st) => st.id !== id),
          history: [...s.history.slice(-MAX_HISTORY + 1), s.steps],
        })),

      moveStep: (fromIdx, toIdx) =>
        set((s) => {
          if (fromIdx === toIdx) return s;
          const next = s.steps.slice();
          const [item] = next.splice(fromIdx, 1);
          next.splice(toIdx, 0, item);
          return {
            steps: next,
            history: [...s.history.slice(-MAX_HISTORY + 1), s.steps],
          };
        }),

      reorderServos: (order) => set({ servoOrder: order }),

      setTransitionSpeed: (v) => set({ transitionSpeed: v }),
      setStepDelay: (v) => set({ stepDelay: v }),
      setCurrentStepIndex: (i) => set({ currentStepIndex: i }),
      setIsPlaying: (v) => set({ isPlaying: v }),
      setPanelHeight: (h) => set({ panelHeight: h }),

      undo: () =>
        set((s) => {
          if (s.history.length === 0) return s;
          return {
            steps: s.history[s.history.length - 1],
            history: s.history.slice(0, -1),
          };
        }),

      exportJson: () => JSON.stringify({ steps: get().steps }, null, 2),
    }),
    {
      name: 'hexagram-sequencer',
      partialize: (s) => ({
        steps: s.steps,
        servoOrder: s.servoOrder,
        transitionSpeed: s.transitionSpeed,
        stepDelay: s.stepDelay,
        panelHeight: s.panelHeight,
      }),
    }
  )
);
