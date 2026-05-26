import type { AppTab } from "../store/useToolboxStore";

export interface ParsedUrl {
  user?: string;
  project?: string;
  tab?: AppTab;
  profile?: string;
  program?: string;
}

export interface UrlInputs {
  userLogin?: string | null;
  projectName?: string | null;
  tab?: AppTab;
  profileName?: string | null;
  programName?: string | null;
}

const VALID_TABS: AppTab[] = ["projet", "conception", "programmation"];

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
  if (segments.length >= 2) out.project = segments[1];
  if (segments.length >= 3) {
    const t = segments[2];
    if ((VALID_TABS as string[]).includes(t)) out.tab = t as AppTab;
  }
  if (segments.length >= 4) out.profile = segments[3];
  if (segments.length >= 5) out.program = segments[4];
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
 */
export function buildPath(state: UrlInputs): string {
  if (!state.userLogin) return "/";
  const segments: string[] = [slugify(state.userLogin)];
  if (!state.projectName) return "/" + segments.join("/");
  segments.push(slugify(state.projectName));
  if (!state.tab) return "/" + segments.join("/");
  segments.push(state.tab);
  if (state.tab === "projet") return "/" + segments.join("/");
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
