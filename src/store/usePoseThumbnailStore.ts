import { create } from 'zustand';
import type { Pose } from '../model/pose';

interface ThumbnailEntry {
  version: number;
  /** Hash compact de la pose au moment de la capture. Sert à détecter les éditions de step. */
  poseHash: string;
  dataUrl: string;
}

interface ThumbnailJob {
  stepId: string;
  pose: Pose;
  poseHash: string;
  /** Version courante au moment où le job a été créé ; permet de jeter les résultats périmés. */
  version: number;
}

/** Hash compact d'une pose : angles arrondis au 1/10 de degré, joints par "_". */
export function hashPose(pose: Pose): string {
  return pose.map((a) => Math.round(a * 10)).join('_');
}

interface PoseThumbnailState {
  /** Bumpé à chaque invalidation globale (geometry/cameraDirection stable). */
  version: number;
  /** Cache stepId → entrée. Si version ne correspond plus à `version`, le cache est périmé. */
  thumbnails: Record<string, ThumbnailEntry>;
  /** File d'attente : étapes à rendre. La tête (index 0) est le job actif. */
  queue: ThumbnailJob[];

  /** Demande la génération d'un thumbnail pour le step (no-op si déjà à jour ou en file). */
  request: (stepId: string, pose: Pose) => void;
  /** Appelé par le renderer offscreen quand une vignette a été capturée. */
  finishJob: (stepId: string, version: number, dataUrl: string) => void;
  /** Invalide globalement le cache (changement de géométrie ou de caméra stable). */
  invalidateAll: () => void;
  /** Retourne le dataURL si la vignette est valide pour la version courante (et la pose si fournie), sinon null. */
  getValid: (stepId: string, poseHash?: string) => string | null;
  /** Supprime une entrée précise (ex. lors d'une suppression de step). */
  remove: (stepId: string) => void;
}

export const usePoseThumbnailStore = create<PoseThumbnailState>((set, get) => ({
  version: 0,
  thumbnails: {},
  queue: [],

  request: (stepId, pose) => {
    const s = get();
    const poseHash = hashPose(pose);
    const entry = s.thumbnails[stepId];
    if (entry && entry.version === s.version && entry.poseHash === poseHash) return;
    if (s.queue.some((j) => j.stepId === stepId && j.version === s.version && j.poseHash === poseHash)) return;
    set({
      queue: [
        ...s.queue.filter((j) => j.stepId !== stepId),
        { stepId, pose: pose.slice(), poseHash, version: s.version },
      ],
    });
  },

  finishJob: (stepId, version, dataUrl) =>
    set((s) => {
      const job = s.queue.find((j) => j.stepId === stepId && j.version === version);
      const nextQueue = s.queue.filter((j) => !(j.stepId === stepId && j.version === version));
      // On ne range pas un résultat périmé dans le cache.
      if (!job || version !== s.version) return { queue: nextQueue };
      return {
        queue: nextQueue,
        thumbnails: { ...s.thumbnails, [stepId]: { version, poseHash: job.poseHash, dataUrl } },
      };
    }),

  invalidateAll: () =>
    set((s) => ({
      version: s.version + 1,
      // On garde les anciennes vignettes pour pouvoir afficher une version "stale"
      // pendant la régénération ; getValid() refuse celles qui ne sont plus à la
      // version courante.
      queue: [],
    })),

  getValid: (stepId, poseHash) => {
    const s = get();
    const entry = s.thumbnails[stepId];
    if (!entry) return null;
    if (entry.version !== s.version) return null;
    if (poseHash !== undefined && entry.poseHash !== poseHash) return null;
    return entry.dataUrl;
  },

  remove: (stepId) =>
    set((s) => {
      if (!s.thumbnails[stepId] && !s.queue.some((j) => j.stepId === stepId)) return s;
      const next = { ...s.thumbnails };
      delete next[stepId];
      return {
        thumbnails: next,
        queue: s.queue.filter((j) => j.stepId !== stepId),
      };
    }),
}));
