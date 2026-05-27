import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/client';
import { useProjectStore } from './useProjectStore';
import { useHexapodStore } from './useHexapodStore';
import { usePhotoSpaceStore } from './usePhotoSpaceStore';
import { usePoseThumbnailStore, computeThumbnailContext } from './usePoseThumbnailStore';
import { useSequencerStore, type SequencerStep } from './useSequencerStore';

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

/** Empreinte du contexte de rendu courant. */
function currentRenderContext(): string {
  const hex = useHexapodStore.getState();
  return computeThumbnailContext(
    hex.geometry,
    hex.gravityEnabled,
    hex.bodyTransparent,
    usePhotoSpaceStore.getState().viewDirection,
  );
}

/**
 * Enrichit les steps avec leur vignette persistable : pour chaque step ayant
 * une vignette à jour dans le cache, on attache `thumbnail` + `thumbnailContext`
 * au payload envoyé au backend. Steps sans vignette en cache : envoyés tels quels.
 */
function attachThumbnails(steps: SequencerStep[]): SequencerStep[] {
  const cache = usePoseThumbnailStore.getState();
  return steps.map((step) => {
    const entry = cache.thumbnails[step.id];
    if (!entry || entry.version !== cache.version) return step;
    return { ...step, thumbnail: entry.dataUrl, thumbnailContext: entry.context };
  });
}

/** Réinjecte les vignettes persistées de la séquence chargée dans le cache. */
function hydrateSequenceThumbnails(steps: SequencerStep[]): void {
  const ctx = currentRenderContext();
  const seed = usePoseThumbnailStore.getState().seed;
  for (const step of steps) {
    if (!step.thumbnail || !step.thumbnailContext) continue;
    if (step.thumbnailContext !== ctx) continue;
    seed(step.id, step.pose, step.thumbnail, step.thumbnailContext);
  }
}

export const useSavedSequencesStore = create<SavedSequencesState>()(
  persist(
    (set, get) => ({
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
      // Réconcilie l'id actif avec la liste et le séquenceur, pour garder grille
      // et select cohérents au hard refresh :
      //  1) l'id persisté est gardé s'il existe dans le projet ;
      //  2) sinon on le retrouve via le nom de séquence persisté du séquenceur
      //     (la phase non authentifiée du démarrage déclenche un clear() qui
      //     efface l'id avant que list() ne tourne) ;
      //  3) si aucune séquence ne correspond, le séquenceur ne doit afficher
      //     aucune étape (sinon grille pleine alors que le select est sur « — »).
      const seqStore = useSequencerStore.getState();
      let activeId = sequences.some((sq) => sq.id === get().activeSequenceId)
        ? get().activeSequenceId
        : null;
      if (!activeId) {
        const name = seqStore.sequenceName;
        activeId = (name && sequences.find((sq) => sq.name === name)?.id) || null;
      }
      if (!activeId && seqStore.steps.length > 0) {
        seqStore.loadSteps([], 'Séquence');
      }
      set({ sequences, loading: false, activeSequenceId: activeId });
    } catch {
      set({ loading: false });
    }
  },

  save: async (name, steps) => {
    const projectId = activeProjectId();
    if (!projectId) throw new Error("Aucun projet actif");
    const seq = await api.post<SavedSequence>('/sequences', {
      name,
      steps: attachThumbnails(steps),
      projectId,
    });
    set((s) => ({
      sequences: [seq, ...s.sequences],
      activeSequenceId: seq.id,
    }));
    return seq;
  },

  updateSteps: async (id, steps) => {
    await api.put(`/sequences/${id}`, { steps: attachThumbnails(steps) });
    set((s) => ({
      sequences: s.sequences.map((sq) =>
        sq.id === id ? { ...sq, updatedAt: Date.now() } : sq
      ),
    }));
  },

  load: async (id) => {
    const seq = await api.get<SavedSequence>(`/sequences/${id}`);
    hydrateSequenceThumbnails(seq.steps);
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
    }),
    {
      name: 'hexagram-saved-sequences',
      // On ne persiste que l'id actif : la liste est rechargée du backend à
      // chaque session (et revalidée dans list()).
      partialize: (s) => ({ activeSequenceId: s.activeSequenceId }),
    }
  )
);
