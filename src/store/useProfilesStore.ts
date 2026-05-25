import { create } from "zustand";
import { api } from "../api/client";
import { useHexapodStore } from "./useHexapodStore";
import { useProjectStore } from "./useProjectStore";

export interface ProfileSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

interface ProfilesState {
  profiles: ProfileSummary[];
  activeProfileId: string | null;
  loading: boolean;
  list: () => Promise<void>;
  save: (name: string) => Promise<void>;
  update: (id: string) => Promise<void>;
  load: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => void;
}

function activeProjectId(): string | null {
  return useProjectStore.getState().activeProjectId;
}

export const useProfilesStore = create<ProfilesState>((set) => ({
  profiles: [],
  activeProfileId: null,
  loading: false,

  list: async () => {
    const projectId = activeProjectId();
    if (!projectId) {
      set({ profiles: [], loading: false });
      return;
    }
    set({ loading: true });
    try {
      const profiles = await api.get<ProfileSummary[]>(
        `/profiles?projectId=${encodeURIComponent(projectId)}`
      );
      set({ profiles, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  save: async (name: string) => {
    const projectId = activeProjectId();
    if (!projectId) throw new Error("Aucun projet actif");
    const data = useHexapodStore.getState().serializeProfile();
    const profile = await api.post<ProfileSummary>("/profiles", { name, data, projectId });
    set((s) => ({
      profiles: [profile, ...s.profiles],
      activeProfileId: profile.id,
    }));
  },

  update: async (id: string) => {
    const data = useHexapodStore.getState().serializeProfile();
    await api.put(`/profiles/${id}`, { data });
    const now = Date.now();
    set((s) => ({
      profiles: s.profiles.map((p) => (p.id === id ? { ...p, updatedAt: now } : p)),
    }));
  },

  load: async (id: string) => {
    const full = await api.get<{ id: string; name: string; data: unknown }>(`/profiles/${id}`);
    useHexapodStore.getState().applyProfile(full.data);
    set({ activeProfileId: id });
  },

  rename: async (id: string, name: string) => {
    await api.put(`/profiles/${id}`, { name });
    set((s) => ({
      profiles: s.profiles.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
  },

  remove: async (id: string) => {
    await api.delete(`/profiles/${id}`);
    set((s) => ({
      profiles: s.profiles.filter((p) => p.id !== id),
      activeProfileId: s.activeProfileId === id ? null : s.activeProfileId,
    }));
  },

  clear: () => set({ profiles: [], activeProfileId: null }),
}));
