import { create } from 'zustand';
import { api } from '../api/client';
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
}

export const useProgramsStore = create<ProgramsState>((set) => ({
  programs: [],
  loading: false,

  list: async () => {
    set({ loading: true });
    try {
      const programs = await api.get<ProgramSummary[]>('/programs');
      set({ programs, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  create: async (data) => {
    const program = await api.post<Program>('/programs', data);
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
}));
