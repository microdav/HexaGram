import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { usePoseThumbnailStore } from './usePoseThumbnailStore';
import { useProjectStore } from './useProjectStore';

/** Vecteur (regard → caméra) normalisé. Valeur par défaut : vue plongée légèrement vers l'arrière. */
const DEFAULT_VIEW_DIRECTION: [number, number, number] = [-0.35, 0.94, 0];

function normalize(v: [number, number, number]): [number, number, number] {
  const m = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

interface PhotoSpaceState {
  /** Direction caméra utilisée pour générer toutes les vignettes du séquenceur. */
  viewDirection: [number, number, number];
  /**
   * Fige l'angle, invalide le cache des vignettes, persiste localement (localStorage)
   * ET sauvegarde dans le projet actif s'il y en a un.
   */
  setViewDirection: (dir: [number, number, number]) => void;
  /** Applique la direction d'un projet (overrides la valeur locale, sans push au backend). */
  applyFromProject: (dir: [number, number, number] | undefined | null) => void;
  /** Réinitialise à la valeur par défaut (et persiste dans le projet actif si présent). */
  reset: () => void;
}

export const usePhotoSpaceStore = create<PhotoSpaceState>()(
  persist(
    (set) => ({
      viewDirection: normalize(DEFAULT_VIEW_DIRECTION),

      setViewDirection: (dir) => {
        const normalized = normalize(dir);
        set({ viewDirection: normalized });
        usePoseThumbnailStore.getState().invalidateAll();
        const project = useProjectStore.getState().activeProject;
        if (project) {
          void useProjectStore.getState().updatePreferences({ photoSpaceViewDirection: normalized });
        }
      },

      applyFromProject: (dir) => {
        const target = dir && dir.length === 3 ? normalize(dir) : normalize(DEFAULT_VIEW_DIRECTION);
        set({ viewDirection: target });
        usePoseThumbnailStore.getState().invalidateAll();
      },

      reset: () => {
        const normalized = normalize(DEFAULT_VIEW_DIRECTION);
        set({ viewDirection: normalized });
        usePoseThumbnailStore.getState().invalidateAll();
        const project = useProjectStore.getState().activeProject;
        if (project) {
          void useProjectStore.getState().updatePreferences({ photoSpaceViewDirection: normalized });
        }
      },
    }),
    {
      name: 'hexagram-photo-space',
      partialize: (s) => ({ viewDirection: s.viewDirection }),
    }
  )
);
