import type { AppTab, ElectroSubTab, AdminSubTab } from "../store/useToolboxStore";

export interface ParsedUrl {
  user?: string;
  project?: string;
  tab?: AppTab;
  profile?: string;
  program?: string;
  /** Sous-onglet de la page Électronique (4e segment quand tab === 'electronique'). */
  electroSub?: ElectroSubTab;
  /** Sous-onglet de la page Administration (route globale /{user}/admin/{sub}). */
  adminSub?: AdminSubTab;
}

export interface UrlInputs {
  userLogin?: string | null;
  projectName?: string | null;
  tab?: AppTab;
  profileName?: string | null;
  programName?: string | null;
  electroSubTab?: ElectroSubTab | null;
  adminSubTab?: AdminSubTab | null;
}

const VALID_TABS: AppTab[] = ["projet", "conception", "programmation", "electronique", "admin"];
const VALID_ELECTRO_SUBS: ElectroSubTab[] = ["architecture", "calibration"];
const VALID_ADMIN_SUBS: AdminSubTab[] = ["users", "referentiels"];
// Segment réservé : l'Administration n'est pas liée à un projet — route globale
// /{userSlug}/admin/{subTab}. Le segment projet ne peut donc valoir "admin".
const ADMIN_SEGMENT = "admin";

const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function readUrlState(): ParsedUrl {
  if (typeof window === "undefined") return {};
  const segments = window.location.pathname.split("/").filter(Boolean);
  const out: ParsedUrl = {};
  if (segments.length === 0) return out;
  out.user = segments[0];
  // Route globale Administration : /{userSlug}/admin/{subTab}
  if (segments[1] === ADMIN_SEGMENT) {
    out.tab = "admin";
    const sub = segments[2];
    if ((VALID_ADMIN_SUBS as string[]).includes(sub)) out.adminSub = sub as AdminSubTab;
    return out;
  }
  if (segments.length >= 2) out.project = segments[1];
  if (segments.length >= 3) {
    const t = segments[2];
    if ((VALID_TABS as string[]).includes(t)) out.tab = t as AppTab;
  }
  if (segments.length >= 4) {
    // En Électronique, le 4e segment est le sous-onglet ; ailleurs c'est le profil.
    if (out.tab === "electronique") {
      const sub = segments[3];
      if ((VALID_ELECTRO_SUBS as string[]).includes(sub)) out.electroSub = sub as ElectroSubTab;
    } else {
      out.profile = segments[3];
    }
  }
  if (segments.length >= 5 && out.tab !== "electronique") out.program = segments[4];
  return out;
}

let initial: ParsedUrl | null = null;

export function getInitialUrlState(): ParsedUrl {
  if (initial === null) initial = readUrlState();
  return initial;
}

/**
 * Construit le chemin URL à partir de l'état. Les noms sont slugifiés.
 *
 * Formes :
 *  - `/`                                                      → mode démo
 *  - `/{userSlug}`                                            → connecté, aucun projet (onglet Projet)
 *  - `/{userSlug}/{projectSlug}/{tab}`                        → projet + onglet
 *  - `/{userSlug}/{projectSlug}/{tab}/{profileSlug}`          → + profil (conception/programmation)
 *  - `/{userSlug}/{projectSlug}/programmation/{profile}/{program}` → + programme
 *  - `/{userSlug}/{projectSlug}/electronique/{subTab}`        → + sous-onglet électronique
 */
export function buildPath(state: UrlInputs): string {
  if (!state.userLogin) return "/";
  const segments: string[] = [slugify(state.userLogin)];
  // Administration : route globale indépendante du projet.
  if (state.tab === "admin") {
    segments.push(ADMIN_SEGMENT);
    if (state.adminSubTab) segments.push(state.adminSubTab);
    return "/" + segments.join("/");
  }
  if (!state.projectName) return "/" + segments.join("/");
  segments.push(slugify(state.projectName));
  if (!state.tab) return "/" + segments.join("/");
  segments.push(state.tab);
  if (state.tab === "projet") return "/" + segments.join("/");
  if (state.tab === "electronique") {
    if (state.electroSubTab) segments.push(state.electroSubTab);
    return "/" + segments.join("/");
  }
  if (state.profileName) {
    segments.push(slugify(state.profileName));
    if (state.tab === "programmation" && state.programName) {
      segments.push(slugify(state.programName));
    }
  }
  return "/" + segments.join("/");
}

export function writeUrlState(state: UrlInputs): void {
  if (typeof window === "undefined") return;
  const path = buildPath(state);
  if (path !== window.location.pathname) {
    window.history.replaceState(null, "", path + window.location.search + window.location.hash);
  }
}
