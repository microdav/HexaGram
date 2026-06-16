import { create } from "zustand";
import { api } from "../api/client";
import type { ServoSpec } from "../model/servoTypes";
import {
  defaultElectronics,
  normalizeElectronics,
  type ProjectElectronics,
} from "../model/electronics";
import { defaultPower, normalizePower, type ProjectPower } from "../model/power";
import { normalizePeripherals, type ProjectPeripheral } from "../model/peripherals";

/** Groupe de pattes : nom + indices de pattes liées (0-5). Sert à orienter
 *  plusieurs pattes ensemble et, plus tard, à piloter la carte par groupe. */
/** Sens du déplacement groupé d'un groupe de pattes. */
export type LegGroupSens = "axis" | "inverse";

export interface LegGroup {
  id: string;
  name: string;
  legs: number[];
  /** "axis" = mouvement cohérent selon l'axe robot (défaut) ; "inverse" = même
   *  angle servo copié (pattes opposées partent à l'inverse). */
  sens?: LegGroupSens;
}

export interface ProjectHardware {
  servoTypeId: string | null;
  servoControllerId: string | null;
  commandElectronicsId: string | null;
  customServoTypes: ServoSpec[];
  /** Liaison servo↔canal + calibration du 0 + protocole — pilotage physique. */
  electronics: ProjectElectronics;
  /** Alimentation : sources de puissance vers le contrôleur et la carte de commande. */
  power: ProjectPower;
  /** Carte de commande active dans l'architecture (sinon : USB direct sur le contrôleur). */
  commandEnabled: boolean;
  /** Capteurs & périphériques reliés à la carte de commande. */
  peripherals: ProjectPeripheral[];
  /** Groupes de pattes (nom + pattes liées) pour orientation groupée et pilotage par groupe. */
  legGroups: LegGroup[];
}

export const DEFAULT_HARDWARE: ProjectHardware = {
  servoTypeId: null,
  servoControllerId: null,
  commandElectronicsId: null,
  customServoTypes: [],
  electronics: defaultElectronics(),
  power: defaultPower(),
  commandEnabled: true,
  peripherals: [],
  legGroups: [],
};

export interface ProjectPreferences {
  /** Direction caméra (vecteur regard→caméra normalisé) pour les vignettes du séquenceur. */
  photoSpaceViewDirection?: [number, number, number];
  /** Position de départ du robot dans la salle d'exécution (au sol, X/Z en mètres). */
  roomStartPos?: { x: number; z: number };
  /** Pose de base (18 angles servo) appliquée à l'ouverture du projet, sans sélection de pose. */
  basePose?: number[];
  /** Mode « écran lié » : appareils auto-autorisés à prendre le contrôle sans demande. */
  linkedScreen?: { autoGrant?: LinkedDeviceRef[] };
}

/** Référence d'un appareil (PC) connu du mode « écran lié ». */
export interface LinkedDeviceRef {
  id: string;
  name: string;
}

export interface ProjectCounts {
  profiles: number;
  sequences: number;
  programs: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  counts: ProjectCounts;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  hardware: ProjectHardware;
  preferences: ProjectPreferences;
  createdAt: number;
  updatedAt: number;
  counts?: ProjectCounts;
}

interface ProjectsState {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  activeProject: Project | null;
  loading: boolean;

  list: () => Promise<ProjectSummary[]>;
  create: (name: string, description?: string, hardware?: Partial<ProjectHardware>) => Promise<Project>;
  load: (id: string) => Promise<Project>;
  update: (id: string, patch: { name?: string; description?: string; hardware?: ProjectHardware; preferences?: ProjectPreferences }) => Promise<Project>;
  updateHardware: (patch: Partial<ProjectHardware>) => Promise<void>;
  updateElectronics: (patch: Partial<ProjectElectronics>) => Promise<void>;
  updatePreferences: (patch: Partial<ProjectPreferences>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  importFrom: (
    sourceProjectId: string,
    items: { profileIds?: string[]; sequenceIds?: string[]; programIds?: string[] }
  ) => Promise<{ profilesImported: number; sequencesImported: number; programsImported: number }>;
  clear: () => void;
  setActiveProjectId: (id: string | null) => void;
}

function normalizeHardware(raw: Partial<ProjectHardware> | undefined): ProjectHardware {
  return {
    servoTypeId: raw?.servoTypeId ?? null,
    servoControllerId: raw?.servoControllerId ?? null,
    commandElectronicsId: raw?.commandElectronicsId ?? null,
    customServoTypes: raw?.customServoTypes ?? [],
    electronics: normalizeElectronics(raw?.electronics),
    power: normalizePower(raw?.power),
    commandEnabled: raw?.commandEnabled !== false,
    peripherals: normalizePeripherals(raw?.peripherals),
    legGroups: normalizeLegGroups(raw?.legGroups),
  };
}

/** Normalise les groupes de pattes : ids/noms valides, indices de pattes 0-5 uniques. */
function normalizeLegGroups(raw: LegGroup[] | undefined): LegGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((g, i) => ({
    id: typeof g?.id === "string" && g.id ? g.id : `group-${i}`,
    name: typeof g?.name === "string" ? g.name : `Groupe ${i + 1}`,
    legs: Array.isArray(g?.legs)
      ? [...new Set(g.legs.filter((n) => Number.isInteger(n) && n >= 0 && n <= 5))]
      : [],
    sens: g?.sens === "inverse" ? "inverse" : "axis",
  }));
}

function normalizePreferences(raw: ProjectPreferences | undefined): ProjectPreferences {
  return { ...(raw ?? {}) };
}

export const useProjectStore = create<ProjectsState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  activeProject: null,
  loading: false,

  list: async () => {
    set({ loading: true });
    try {
      const projects = await api.get<ProjectSummary[]>("/projects");
      set({ projects, loading: false });
      return projects;
    } catch {
      set({ loading: false });
      return [];
    }
  },

  create: async (name, description, hardware) => {
    const body: Record<string, unknown> = { name };
    if (description !== undefined) body.description = description;
    if (hardware) body.hardware = normalizeHardware(hardware);
    const project = await api.post<Project>("/projects", body);
    project.hardware = normalizeHardware(project.hardware);
    project.preferences = normalizePreferences(project.preferences);
    set((s) => ({
      projects: [
        {
          id: project.id,
          name: project.name,
          description: project.description,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          counts: { profiles: 0, sequences: 0, programs: 0 },
        },
        ...s.projects,
      ],
      activeProjectId: project.id,
      activeProject: project,
    }));
    return project;
  },

  load: async (id) => {
    const project = await api.get<Project>(`/projects/${id}`);
    project.hardware = normalizeHardware(project.hardware);
    project.preferences = normalizePreferences(project.preferences);
    set({ activeProjectId: id, activeProject: project });
    return project;
  },

  update: async (id, patch) => {
    const project = await api.put<Project>(`/projects/${id}`, patch);
    project.hardware = normalizeHardware(project.hardware);
    project.preferences = normalizePreferences(project.preferences);
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id
          ? {
              ...p,
              name: project.name,
              description: project.description,
              updatedAt: project.updatedAt,
            }
          : p
      ),
      activeProject:
        s.activeProjectId === id ? { ...project, counts: s.activeProject?.counts } : s.activeProject,
    }));
    return project;
  },

  updateHardware: async (patch) => {
    const current = get().activeProject;
    if (!current) return;
    const newHardware = { ...current.hardware, ...patch };
    await get().update(current.id, { hardware: newHardware });
  },

  updateElectronics: async (patch) => {
    const current = get().activeProject;
    if (!current) return;
    const newElectronics = normalizeElectronics({ ...current.hardware.electronics, ...patch });
    const newHardware = { ...current.hardware, electronics: newElectronics };
    await get().update(current.id, { hardware: newHardware });
  },

  updatePreferences: async (patch) => {
    const current = get().activeProject;
    if (!current) return;
    // Le backend fusionne ; on n'envoie que le patch.
    await get().update(current.id, { preferences: patch });
  },

  remove: async (id) => {
    await api.delete(`/projects/${id}`);
    set((s) => {
      const isActive = s.activeProjectId === id;
      return {
        projects: s.projects.filter((p) => p.id !== id),
        activeProjectId: isActive ? null : s.activeProjectId,
        activeProject: isActive ? null : s.activeProject,
      };
    });
  },

  importFrom: async (sourceProjectId, items) => {
    const target = get().activeProjectId;
    if (!target) throw new Error("Aucun projet actif");
    const result = await api.post<{
      profilesImported: number;
      sequencesImported: number;
      programsImported: number;
    }>(`/projects/${target}/import`, { sourceProjectId, ...items });
    // Recharge projet et listes
    await get().load(target);
    await get().list();
    return result;
  },

  clear: () => set({ projects: [], activeProjectId: null, activeProject: null }),

  setActiveProjectId: (id) => set({ activeProjectId: id }),
}));
