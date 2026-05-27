import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/client';
import { useAuthStore } from './useAuthStore';
import { useProjectStore } from './useProjectStore';
import { useProfilesStore } from './useProfilesStore';
import { useHexapodStore } from './useHexapodStore';
import { useSequencerStore } from './useSequencerStore';
import { usePhotoSpaceStore } from './usePhotoSpaceStore';
import { usePoseThumbnailStore, computeThumbnailContext, hashPose } from './usePoseThumbnailStore';
import type { Pose, SavedPose } from '../model/pose';

/** Une séquence référençant une pose (résultat de usage). */
export interface PoseUsageSequence {
  id: string;
  name: string;
  stepCount: number;
}

export interface PoseUsage {
  total: number;
  sequences: PoseUsageSequence[];
}

interface SavedPosesState {
  poses: SavedPose[];
  loading: boolean;
  /** Pose actuellement sélectionnée/éditée depuis la boîte « Poses » (transitoire). */
  selectedPoseId: string | null;
  list: () => Promise<void>;
  add: (name: string, angles: Pose) => Promise<SavedPose>;
  rename: (id: string, name: string) => Promise<void>;
  updateAngles: (id: string, angles: Pose) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reorder: (orderedIds: string[]) => Promise<void>;
  getById: (id: string) => SavedPose | undefined;
  setSelectedPoseId: (id: string | null) => void;
  /** Séquences du projet dont des steps réfèrent cette pose. */
  usage: (id: string) => Promise<PoseUsage>;
  /** Remplace les angles de la pose ET propage aux steps liés (toutes séquences). */
  propagateAngles: (id: string, angles: Pose) => Promise<void>;
  clear: () => void;
}

function isBackend(): boolean {
  return !!useAuthStore.getState().user && !!useProjectStore.getState().activeProjectId;
}

function newId(): string {
  return `pose-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Empreinte du contexte de rendu courant — utilisée pour valider / persister les vignettes. */
function currentRenderContext(): string {
  const hex = useHexapodStore.getState();
  return computeThumbnailContext(
    hex.geometry,
    hex.gravityEnabled,
    hex.bodyTransparent,
    usePhotoSpaceStore.getState().viewDirection,
  );
}

/** Hydrate le cache de vignettes avec les poses persistées dont le contexte matche. */
function hydrateThumbnails(poses: SavedPose[]): void {
  const ctx = currentRenderContext();
  const seed = usePoseThumbnailStore.getState().seed;
  for (const p of poses) {
    if (!p.thumbnail || !p.thumbnailContext) continue;
    if (p.thumbnailContext !== ctx) continue;
    seed(p.id, p.angles, p.thumbnail, p.thumbnailContext);
  }
}

/**
 * Souscription paresseuse : à la première initialisation backend, on observe les
 * vignettes générées et on PUT côté serveur celles qui concernent une pose
 * enregistrée. Debounce léger pour éviter d'envoyer une rafale.
 */
let _thumbSubscribed = false;
const _lastPersistedHash: Record<string, string> = {};
const _pendingPersist: Record<string, ReturnType<typeof setTimeout>> = {};

function ensureThumbnailPersistSubscription(): void {
  if (_thumbSubscribed) return;
  _thumbSubscribed = true;
  usePoseThumbnailStore.subscribe((state, prev) => {
    if (state.thumbnails === prev.thumbnails) return;
    if (!isBackend()) return;
    const poses = useSavedPosesStore.getState().poses;
    for (const p of poses) {
      const entry = state.thumbnails[p.id];
      if (!entry) continue;
      if (entry.version !== state.version) continue;
      if (entry.poseHash !== hashPose(p.angles)) continue;
      const dedupKey = `${entry.context}:${entry.poseHash}`;
      if (_lastPersistedHash[p.id] === dedupKey) continue;
      _lastPersistedHash[p.id] = dedupKey;
      clearTimeout(_pendingPersist[p.id]);
      _pendingPersist[p.id] = setTimeout(() => {
        delete _pendingPersist[p.id];
        api
          .put(`/poses/${p.id}`, { thumbnail: entry.dataUrl, thumbnailContext: entry.context })
          .then(() => {
            useSavedPosesStore.setState((s) => ({
              poses: s.poses.map((pp) =>
                pp.id === p.id
                  ? { ...pp, thumbnail: entry.dataUrl, thumbnailContext: entry.context }
                  : pp,
              ),
            }));
          })
          .catch(() => {
            delete _lastPersistedHash[p.id];
          });
      }, 600);
    }
  });
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
      selectedPoseId: null,

      list: async () => {
        if (!isBackend()) return;
        ensureThumbnailPersistSubscription();
        const projectId = useProjectStore.getState().activeProjectId!;
        set({ loading: true });
        try {
          const poses = await api.get<SavedPose[]>(
            `/poses?projectId=${encodeURIComponent(projectId)}`
          );
          const sorted = poses.slice().sort((a, b) => a.position - b.position);
          set({ poses: sorted, loading: false });
          // Marque ces poses comme déjà persistées pour éviter un PUT inutile.
          for (const p of sorted) {
            if (p.thumbnail && p.thumbnailContext) {
              _lastPersistedHash[p.id] = `${p.thumbnailContext}:${hashPose(p.angles)}`;
            }
          }
          hydrateThumbnails(sorted);
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
          ensureThumbnailPersistSubscription();
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
        // La vignette persistée correspond aux anciens angles → invalidée.
        delete _lastPersistedHash[id];
        set((s) => ({
          poses: s.poses.map((p) =>
            p.id === id
              ? { ...p, angles: angles.slice(), thumbnail: null, thumbnailContext: null, updatedAt: now }
              : p
          ),
        }));
      },

      remove: async (id) => {
        if (isBackend()) {
          try {
            await api.delete(`/poses/${id}`);
          } catch { /* still remove locally */ }
        }
        delete _lastPersistedHash[id];
        clearTimeout(_pendingPersist[id]);
        delete _pendingPersist[id];
        set((s) => ({
          poses: s.poses
            .filter((p) => p.id !== id)
            .map((p, i) => ({ ...p, position: i })),
          selectedPoseId: s.selectedPoseId === id ? null : s.selectedPoseId,
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

      setSelectedPoseId: (id) => set({ selectedPoseId: id }),

      usage: async (id) => {
        if (!isBackend()) return { total: 0, sequences: [] };
        try {
          return await api.get<PoseUsage>(`/poses/${id}/usage`);
        } catch {
          return { total: 0, sequences: [] };
        }
      },

      propagateAngles: async (id, angles) => {
        const now = Date.now();
        delete _lastPersistedHash[id];
        if (isBackend()) {
          try {
            await api.post(`/poses/${id}/propagate`, { angles });
          } catch { /* on met quand même à jour localement ci-dessous */ }
        }
        // Pose locale (vignette invalidée comme dans updateAngles).
        set((s) => ({
          poses: s.poses.map((p) =>
            p.id === id
              ? { ...p, angles: angles.slice(), thumbnail: null, thumbnailContext: null, updatedAt: now }
              : p
          ),
        }));
        // Steps liés de la séquence actuellement chargée.
        useSequencerStore.getState().propagatePoseChange(id, angles);
      },

      clear: () => set({ poses: [], selectedPoseId: null }),
    }),
    {
      name: 'hexagram-saved-poses',
      partialize: (s) => ({ poses: s.poses }),
    }
  )
);
