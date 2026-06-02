import { create } from "zustand";
import type { HexapodGeometry } from "../model/hexapod";
import { useHexapodStore } from "./useHexapodStore";

export interface HistoryEntry {
  label: string;
  geometry: HexapodGeometry;
}

const MAX_ENTRIES = 120;

function clone(g: HexapodGeometry): HexapodGeometry {
  return JSON.parse(JSON.stringify(g));
}

/**
 * Historique d'édition de la maquette Robot 2D : pile linéaire d'instantanés de
 * `geometry` avec curseur. La géométrie réelle vit dans useHexapodStore ;
 * undo/redo/jumpTo réappliquent l'instantané via `replaceGeometry`.
 */
interface HistoryState {
  entries: HistoryEntry[];
  index: number;
  /** Réinitialise l'historique sur un état de base (ouverture de l'onglet/profil). */
  reset: (geometry: HexapodGeometry, label?: string) => void;
  /** Enregistre un nouvel état (tronque le futur). No-op si identique au courant. */
  commit: (label: string, geometry: HexapodGeometry) => void;
  undo: () => void;
  redo: () => void;
  jumpTo: (i: number) => void;
}

function apply(g: HexapodGeometry) {
  useHexapodStore.getState().replaceGeometry(clone(g));
}

export const useRobot2DHistory = create<HistoryState>((set, get) => ({
  entries: [],
  index: -1,

  reset: (geometry, label = "État initial") =>
    set({ entries: [{ label, geometry: clone(geometry) }], index: 0 }),

  commit: (label, geometry) => {
    const { entries, index } = get();
    const cur = entries[index];
    if (cur && JSON.stringify(cur.geometry) === JSON.stringify(geometry)) return;
    const trimmed = entries.slice(0, index + 1);
    const next = [...trimmed, { label, geometry: clone(geometry) }].slice(-MAX_ENTRIES);
    set({ entries: next, index: next.length - 1 });
  },

  undo: () => {
    const { entries, index } = get();
    if (index <= 0) return;
    const i = index - 1;
    apply(entries[i].geometry);
    set({ index: i });
  },

  redo: () => {
    const { entries, index } = get();
    if (index >= entries.length - 1) return;
    const i = index + 1;
    apply(entries[i].geometry);
    set({ index: i });
  },

  jumpTo: (i) => {
    const { entries, index } = get();
    if (i < 0 || i >= entries.length || i === index) return;
    apply(entries[i].geometry);
    set({ index: i });
  },
}));

/** Raccourci : enregistre l'état courant de la géométrie dans l'historique. */
export function commitHistory(label: string) {
  useRobot2DHistory.getState().commit(label, useHexapodStore.getState().geometry);
}
