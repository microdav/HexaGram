import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/client';
import { useAuthStore } from './useAuthStore';
import { useProjectStore } from './useProjectStore';
import { useProfilesStore } from './useProfilesStore';
import type { Pose, SavedPose } from '../model/pose';

interface SavedPosesState {
  poses: SavedPose[];
  loading: boolean;
  list: () => Promise<void>;
  add: (name: string, angles: Pose) => Promise<SavedPose>;
  rename: (id: string, name: string) => Promise<void>;
  updateAngles: (id: string, angles: Pose) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reorder: (orderedIds: string[]) => Promise<void>;
  getById: (id: string) => SavedPose | undefined;
  clear: () => void;
}

function isBackend(): boolean {
  return !!useAuthStore.getState().user && !!useProjectStore.getState().activeProjectId;
}

function newId(): string {
  return `pose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueName(base: string, existing: SavedPose[]): string {
  const names = new Set(existing.map((p) => p.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} (${i})`)) i++;
  return `${base} (${i})`;
}

export const useSavedPosesStore = create<SavedPosesState>()(
  persist(
    (set, get) => ({
      poses: [],
      loading: false,

      list: async () => {
        if (!isBackend()) return;
        const projectId = useProjectStore.getState().activeProjectId!;
        set({ loading: true });
        try {
          const poses = await api.get<SavedPose[]>(
            `/poses?projectId=${encodeURIComponent(projectId)}`
          );
          set({
            poses: poses.slice().sort((a, b) => a.position - b.position),
            loading: false,
          });
        } catch {
          set({ loading: false });
        }
      },

      add: async (name, angles) => {
        const trimmed = name.trim() || 'Pose';
        const finalName = uniqueName(trimmed, get().poses);
        const profileId = useProfilesStore.getState().activeProfileId ?? null;
        const position = get().poses.length;
        const now = Date.now();
        if (isBackend()) {
          const projectId = useProjectStore.getState().activeProjectId!;
          const created = await api.post<SavedPose>('/poses', {
            name: finalName,
            angles,
            profileId,
            position,
            projectId,
          });
          set((s) => ({ poses: [...s.poses, created] }));
          return created;
        }
        const local: SavedPose = {
          id: newId(),
          projectId: null,
          profileId,
          name: finalName,
          angles: angles.slice(),
          position,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ poses: [...s.poses, local] }));
        return local;
      },

      rename: async (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (isBackend()) {
          try {
            await api.put(`/poses/${id}`, { name: trimmed });
          } catch { /* keep local change */ }
        }
        const now = Date.now();
        set((s) => ({
          poses: s.poses.map((p) =>
            p.id === id ? { ...p, name: trimmed, updatedAt: now } : p
          ),
        }));
      },

      updateAngles: async (id, angles) => {
        if (isBackend()) {
          try {
            await api.put(`/poses/${id}`, { angles });
          } catch { /* keep local change */ }
        }
        const now = Date.now();
        set((s) => ({
          poses: s.poses.map((p) =>
            p.id === id ? { ...p, angles: angles.slice(), updatedAt: now } : p
          ),
        }));
      },

      remove: async (id) => {
        if (isBackend()) {
          try {
            await api.delete(`/poses/${id}`);
          } catch { /* still remove locally */ }
        }
        set((s) => ({
          poses: s.poses
            .filter((p) => p.id !== id)
            .map((p, i) => ({ ...p, position: i })),
        }));
      },

      reorder: async (orderedIds) => {
        const map = new Map(get().poses.map((p) => [p.id, p]));
        const reordered: SavedPose[] = [];
        orderedIds.forEach((id, i) => {
          const p = map.get(id);
          if (p) reordered.push({ ...p, position: i });
        });
        for (const p of get().poses) {
          if (!orderedIds.includes(p.id)) {
            reordered.push({ ...p, position: reordered.length });
          }
        }
        set({ poses: reordered });
        if (isBackend()) {
          const projectId = useProjectStore.getState().activeProjectId!;
          try {
            await api.post(
              `/poses/reorder?projectId=${encodeURIComponent(projectId)}`,
              { order: reordered.map((p) => p.id) }
            );
          } catch { /* keep local order */ }
        }
      },

      getById: (id) => get().poses.find((p) => p.id === id),

      clear: () => set({ poses: [] }),
    }),
    {
      name: 'hexagram-saved-poses',
      partialize: (s) => ({ poses: s.poses }),
    }
  )
);
