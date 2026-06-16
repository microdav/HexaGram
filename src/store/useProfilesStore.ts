import { create } from "zustand";
import { api } from "../api/client";
import { useHexapodStore } from "./useHexapodStore";
import { useProjectStore } from "./useProjectStore";
import { useToastStore } from "./useToastStore";

/** Mesure de « richesse » du tracé 2D : sert au garde-fou anti-perte (ne pas
 *  écraser un châssis non vide par un body2D vide lors d'un autosave). */
function body2DStrength(): number {
  const b = useHexapodStore.getState().geometry.body2D;
  if (!b) return 0;
  return (b.shapes?.length ?? 0) + (b.pieces?.length ?? 0) + (b.anchors?.length ?? 0) + (b.points?.length ?? 0);
}

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
  /**
   * Signature de la config robot au dernier chargement/enregistrement. Comparée
   * à la signature live pour détecter les modifications non enregistrées du
   * profil. `null` tant qu'aucun profil n'est actif.
   */
  savedSignature: string | null;
  /** Richesse du tracé 2D au dernier chargement/enregistrement (garde-fou anti-perte). */
  savedBody2DStrength: number;
  list: () => Promise<void>;
  /**
   * Garantit qu'une « base mécanique » unique est chargée pour le projet actif :
   * crée une base par défaut si aucune n'existe, sinon charge la plus récente
   * (les autres profils éventuels restent en base mais ne sont jamais exposés).
   */
  ensureBase: () => Promise<void>;
  save: (name: string) => Promise<void>;
  /** Enregistre le profil. `opts.guardEmptyBody2D` (autosave) refuse d'écraser un
   *  tracé non vide par un body2D vide — protège contre une perte silencieuse. */
  update: (id: string, opts?: { guardEmptyBody2D?: boolean }) => Promise<void>;
  load: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => void;
}

function activeProjectId(): string | null {
  return useProjectStore.getState().activeProjectId;
}

export const useProfilesStore = create<ProfilesState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  loading: false,
  savedSignature: null,
  savedBody2DStrength: 0,

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

  ensureBase: async () => {
    const projectId = activeProjectId();
    if (!projectId) return;
    await useProfilesStore.getState().list();
    const { profiles } = useProfilesStore.getState();
    if (profiles.length === 0) {
      // Projet sans base : on en crée une par défaut à partir de l'état courant
      // du robot (DEFAULT_GEOMETRY sur un projet neuf).
      await useProfilesStore.getState().save("Base mécanique");
    } else {
      // profiles[0] = le plus récemment modifié (tri serveur ORDER BY updated_at DESC).
      await useProfilesStore.getState().load(profiles[0].id);
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
      savedSignature: useHexapodStore.getState().profileCoreSignature(),
      savedBody2DStrength: body2DStrength(),
    }));
  },

  update: async (id: string, opts) => {
    const strength = body2DStrength();
    // Garde-fou anti-perte : un autosave ne doit jamais remplacer un châssis non
    // vide déjà enregistré par un tracé vide (cause d'une perte silencieuse).
    if (opts?.guardEmptyBody2D && strength === 0 && get().savedBody2DStrength > 0) {
      console.warn("[autosave] body2D vide ignoré pour préserver le châssis enregistré.");
      useToastStore.getState().show(
        "Enregistrement auto ignoré : tracé du châssis vide (protection anti-perte). Rechargez la page si l'affichage est anormal."
      );
      return;
    }
    const data = useHexapodStore.getState().serializeProfile();
    await api.put(`/profiles/${id}`, { data });
    const now = Date.now();
    set((s) => ({
      profiles: s.profiles.map((p) => (p.id === id ? { ...p, updatedAt: now } : p)),
      savedSignature: useHexapodStore.getState().profileCoreSignature(),
      savedBody2DStrength: strength,
    }));
  },

  load: async (id: string) => {
    const full = await api.get<{ id: string; name: string; data: unknown }>(`/profiles/${id}`);
    useHexapodStore.getState().applyProfile(full.data);
    set({
      activeProfileId: id,
      savedSignature: useHexapodStore.getState().profileCoreSignature(),
      savedBody2DStrength: body2DStrength(),
    });
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
      savedSignature: s.activeProfileId === id ? null : s.savedSignature,
    }));
  },

  clear: () => set({ profiles: [], activeProfileId: null, savedSignature: null, savedBody2DStrength: 0 }),
}));
