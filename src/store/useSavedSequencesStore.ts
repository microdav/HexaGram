import { create } from 'zustand';
import { api } from '../api/client';
import { useProjectStore } from './useProjectStore';
import type { SequencerStep } from './useSequencerStore';

export interface SequenceSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface SavedSequence extends SequenceSummary {
  steps: SequencerStep[];
}

interface SavedSequencesState {
  sequences: SequenceSummary[];
  activeSequenceId: string | null;
  loading: boolean;

  list: () => Promise<void>;
  save: (name: string, steps: SequencerStep[]) => Promise<SavedSequence>;
  updateSteps: (id: string, steps: SequencerStep[]) => Promise<void>;
  load: (id: string) => Promise<SavedSequence>;
  rename: (id: string, name: string) => Promise<void>;
  duplicate: (id: string, newName: string) => Promise<SavedSequence>;
  remove: (id: string) => Promise<void>;
  setActiveSequenceId: (id: string | null) => void;
  clear: () => void;
}

function activeProjectId(): string | null {
  return useProjectStore.getState().activeProjectId;
}

export const useSavedSequencesStore = create<SavedSequencesState>((set) => ({
  sequences: [],
  activeSequenceId: null,
  loading: false,

  list: async () => {
    const projectId = activeProjectId();
    if (!projectId) {
      set({ sequences: [], loading: false });
      return;
    }
    set({ loading: true });
    try {
      const sequences = await api.get<SequenceSummary[]>(
        `/sequences?projectId=${encodeURIComponent(projectId)}`
      );
      set({ sequences, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  save: async (name, steps) => {
    const projectId = activeProjectId();
    if (!projectId) throw new Error("Aucun projet actif");
    const seq = await api.post<SavedSequence>('/sequences', { name, steps, projectId });
    set((s) => ({
      sequences: [seq, ...s.sequences],
      activeSequenceId: seq.id,
    }));
    return seq;
  },

  updateSteps: async (id, steps) => {
    await api.put(`/sequences/${id}`, { steps });
    set((s) => ({
      sequences: s.sequences.map((sq) =>
        sq.id === id ? { ...sq, updatedAt: Date.now() } : sq
      ),
    }));
  },

  load: async (id) => {
    const seq = await api.get<SavedSequence>(`/sequences/${id}`);
    set({ activeSequenceId: id });
    return seq;
  },

  rename: async (id, name) => {
    await api.put(`/sequences/${id}`, { name });
    set((s) => ({
      sequences: s.sequences.map((sq) => (sq.id === id ? { ...sq, name } : sq)),
    }));
  },

  duplicate: async (id, newName) => {
    const projectId = activeProjectId();
    if (!projectId) throw new Error("Aucun projet actif");
    const original = await api.get<SavedSequence>(`/sequences/${id}`);
    const copy = await api.post<SavedSequence>('/sequences', {
      name: newName,
      steps: original.steps,
      projectId,
    });
    set((s) => ({
      sequences: [copy, ...s.sequences],
      activeSequenceId: copy.id,
    }));
    return copy;
  },

  remove: async (id) => {
    await api.delete(`/sequences/${id}`);
    set((s) => ({
      sequences: s.sequences.filter((sq) => sq.id !== id),
      activeSequenceId: s.activeSequenceId === id ? null : s.activeSequenceId,
    }));
  },

  setActiveSequenceId: (id) => set({ activeSequenceId: id }),

  clear: () => set({ sequences: [], activeSequenceId: null }),
}));
