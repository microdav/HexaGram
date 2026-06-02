import { create } from 'zustand';
import type { Pose } from '../model/pose';
import type { HexapodGeometry } from '../model/hexapod';

interface ThumbnailEntry {
  version: number;
  /** Hash compact de la pose au moment de la capture. Sert à détecter les éditions de step. */
  poseHash: string;
  /** Empreinte du contexte de rendu (geometry/gravité/transparence/caméra) au moment de la capture. */
  context: string;
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

/**
 * Empreinte stable du contexte de rendu : tout ce qui influe sur le visuel
 * d'une vignette en dehors de la pose elle-même.
 *   - géométrie (châssis, segments, COG, legLayout)
 *   - gravityEnabled / bodyTransparent
 *   - viewDirection (caméra figée des vignettes)
 * Sert à valider les vignettes persistées au backend lors de l'hydratation.
 */
export function computeThumbnailContext(
  geometry: HexapodGeometry,
  gravityEnabled: boolean,
  bodyTransparent: boolean,
  viewDirection: readonly [number, number, number],
): string {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return JSON.stringify({
    cl: r(geometry.chassis.length),
    cw: r(geometry.chassis.width),
    ch: r(geometry.chassis.height),
    sc: r(geometry.segments.coxa),
    sf: r(geometry.segments.femur),
    st: r(geometry.segments.tibia),
    cx: r(geometry.cog.x),
    cy: r(geometry.cog.y),
    cz: r(geometry.cog.z),
    ll: geometry.legLayout ?? 'star',
    // Ancrages 2D : font autorité sur les positions de pattes → doivent
    // invalider les vignettes quand la maquette change.
    b2: geometry.body2D?.anchors
      ? geometry.body2D.anchors
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((a) => [r(a.x), r(a.z), Math.round(a.yawDeg)])
      : 0,
    // Morceaux bakés du châssis : changent la forme extrudée 3D → invalident aussi.
    bpc: geometry.body2D?.pieces
      ? geometry.body2D.pieces.map((pc) => [
          pc.outer.map((p) => [r(p.x), r(p.z)]),
          pc.holes.map((h) => h.map((p) => [r(p.x), r(p.z)])),
        ])
      : geometry.body2D?.points
        ? geometry.body2D.points.map((p) => [r(p.x), r(p.z)])
        : 0,
    g: gravityEnabled ? 1 : 0,
    t: bodyTransparent ? 1 : 0,
    v: [r(viewDirection[0]), r(viewDirection[1]), r(viewDirection[2])],
  });
}

interface PoseThumbnailState {
  /** Bumpé à chaque invalidation globale (geometry/cameraDirection stable). */
  version: number;
  /**
   * Empreinte du contexte de rendu courant (publié par PoseThumbnailRenderer).
   * `null` tant que le renderer n'a pas démarré.
   */
  currentContext: string | null;
  /** Cache stepId → entrée. Si version ne correspond plus à `version`, le cache est périmé. */
  thumbnails: Record<string, ThumbnailEntry>;
  /** File d'attente : étapes à rendre. La tête (index 0) est le job actif. */
  queue: ThumbnailJob[];

  /** Met à jour l'empreinte courante (PoseThumbnailRenderer). */
  setCurrentContext: (context: string) => void;
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
  /**
   * Injecte une vignette persistée (provenance backend) dans le cache.
   * No-op si l'empreinte de contexte ne matche pas le contexte courant.
   * Retourne `true` si la vignette a été injectée.
   */
  seed: (stepId: string, pose: Pose, dataUrl: string, context: string) => boolean;
}

export const usePoseThumbnailStore = create<PoseThumbnailState>((set, get) => ({
  version: 0,
  currentContext: null,
  thumbnails: {},
  queue: [],

  setCurrentContext: (context) => {
    if (get().currentContext === context) return;
    set({ currentContext: context });
  },

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
      const context = s.currentContext ?? '';
      return {
        queue: nextQueue,
        thumbnails: { ...s.thumbnails, [stepId]: { version, poseHash: job.poseHash, context, dataUrl } },
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

  seed: (stepId, pose, dataUrl, context) => {
    const s = get();
    if (!s.currentContext || s.currentContext !== context) return false;
    const poseHash = hashPose(pose);
    const existing = s.thumbnails[stepId];
    // Si on a déjà une entrée à jour pour ce step + pose, on ne touche pas.
    if (existing && existing.version === s.version && existing.poseHash === poseHash) return true;
    set({
      thumbnails: {
        ...s.thumbnails,
        [stepId]: { version: s.version, poseHash, context, dataUrl },
      },
    });
    return true;
  },
}));
