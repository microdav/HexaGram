import { create } from 'zustand';
import { api } from '../api/client';
import { useProjectStore } from './useProjectStore';
import type { Program, ProgramSummary } from '../model/program';

type ProgramCreateData = Omit<Program, 'id' | 'createdAt' | 'updatedAt'>;
type ProgramUpdateData = Partial<ProgramCreateData>;

interface ProgramsState {
  programs: ProgramSummary[];
  loading: boolean;

  list: () => Promise<void>;
  create: (data: ProgramCreateData) => Promise<Program>;
  load: (id: string) => Promise<Program>;
  update: (id: string, data: ProgramUpdateData) => Promise<Program>;
  remove: (id: string) => Promise<void>;
  clear: () => void;
}

function activeProjectId(): string | null {
  return useProjectStore.getState().activeProjectId;
}

export const useProgramsStore = create<ProgramsState>((set) => ({
  programs: [],
  loading: false,

  list: async () => {
    const projectId = activeProjectId();
    if (!projectId) {
      set({ programs: [], loading: false });
      return;
    }
    set({ loading: true });
    try {
      const programs = await api.get<ProgramSummary[]>(
        `/programs?projectId=${encodeURIComponent(projectId)}`
      );
      set({ programs, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  create: async (data) => {
    const projectId = activeProjectId();
    if (!projectId) throw new Error("Aucun projet actif");
    const program = await api.post<Program>('/programs', { ...data, projectId });
    set((s) => ({ programs: [program, ...s.programs] }));
    return program;
  },

  load: async (id) => api.get<Program>(`/programs/${id}`),

  update: async (id, data) => {
    const program = await api.put<Program>(`/programs/${id}`, data);
    set((s) => ({
      programs: s.programs.map((p) => (p.id === id ? { ...p, ...program } : p)),
    }));
    return program;
  },

  remove: async (id) => {
    await api.delete(`/programs/${id}`);
    set((s) => ({ programs: s.programs.filter((p) => p.id !== id) }));
  },

  clear: () => set({ programs: [] }),
}));
