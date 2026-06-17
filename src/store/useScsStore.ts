import { create } from "zustand";
import {
  feasibleTimeMs,
  effectiveRowTimeMs,
  rowToCommand,
  servoSecPer60,
  programToScsRows,
  makeBlankRow,
  type ScsRow,
  type ScsHardware,
} from "../model/scs";
import { resolveProgramKeyframes } from "../model/programPlayback";
import type { Program } from "../model/program";
import type { SavedSequence } from "./useSavedSequencesStore";
import { useSerialStore } from "./useSerialStore";
import { useToastStore } from "./useToastStore";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Drapeau d'annulation de la lecture, au niveau module (le Stop coupe la boucle).
let _abort = false;
// Compteur d'ids pour les lignes ajoutées manuellement (unique, sans Math.random).
let _newRowSeq = 0;

// Dock bas (ouverture + hauteur) persisté localement comme le séquenceur.
export const SCS_PANEL_MIN_H = 120;
export const SCS_PANEL_MAX_H = 700;
const OPEN_KEY = "hexagram.scs.open";
const HEIGHT_KEY = "hexagram.scs.height";
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
function readHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(v) && v >= SCS_PANEL_MIN_H ? Math.min(SCS_PANEL_MAX_H, v) : 320;
  } catch {
    return 320;
  }
}

interface ScsState {
  /** Lignes = trames envoyées à la carte, dans l'ordre. */
  rows: ScsRow[];
  /** Lecture en cours ? */
  playing: boolean;
  /** Index de la ligne en cours d'envoi (-1 hors lecture). */
  currentRow: number;
  /** Nom du programme source de la dernière conversion (info affichée). */
  sourceName: string | null;
  /** Dock bas : ouvert ? + hauteur (px), persistés localement. */
  panelOpen: boolean;
  panelHeight: number;
  setPanelOpen: (v: boolean) => void;
  setPanelHeight: (h: number) => void;

  /** Convertit un programme (graphique) en lignes SCS (sens unique). */
  loadFromProgram: (
    program: Pick<Program, "initPose" | "steps">,
    name: string,
    getSequence: (id: string) => Promise<SavedSequence>,
    hw: ScsHardware
  ) => Promise<void>;
  clear: () => void;

  toggleSend: (rowId: string, servoId: number) => void;
  setDeg: (rowId: string, servoId: number, deg: number) => void;
  setRowName: (rowId: string, name: string) => void;
  setRowTime: (rowId: string, ms: number | null) => void;
  addRowAfter: (index: number) => void;
  removeRow: (rowId: string) => void;
  moveRow: (rowId: string, dir: -1 | 1) => void;

  /** Joue les lignes l'une après l'autre, en respectant le temps faisable. */
  play: (hw: ScsHardware) => Promise<void>;
  /** Arrête la lecture (les servos gardent leur dernière position). */
  stop: () => void;
}

export const useScsStore = create<ScsState>((set, get) => ({
  rows: [],
  playing: false,
  currentRow: -1,
  sourceName: null,
  panelOpen: readOpen(),
  panelHeight: readHeight(),

  setPanelOpen: (v) => {
    try {
      localStorage.setItem(OPEN_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ panelOpen: v });
  },

  setPanelHeight: (h) => {
    const clamped = Math.max(SCS_PANEL_MIN_H, Math.min(SCS_PANEL_MAX_H, Math.round(h)));
    try {
      localStorage.setItem(HEIGHT_KEY, String(clamped));
    } catch {
      /* ignore */
    }
    set({ panelHeight: clamped });
  },

  loadFromProgram: async (program, name, getSequence, hw) => {
    const keyframes = await resolveProgramKeyframes(program, getSequence);
    set({ rows: programToScsRows(keyframes, hw), currentRow: -1, sourceName: name });
  },

  clear: () => set({ rows: [], currentRow: -1, sourceName: null }),

  toggleSend: (rowId, servoId) =>
    set((s) => ({
      rows: s.rows.map((r) =>
        r.id === rowId
          ? { ...r, send: r.send.map((v, i) => (i === servoId ? !v : v)) }
          : r
      ),
    })),

  setDeg: (rowId, servoId, deg) =>
    set((s) => ({
      rows: s.rows.map((r) =>
        r.id === rowId
          ? { ...r, deg: r.deg.map((v, i) => (i === servoId ? deg : v)) }
          : r
      ),
    })),

  setRowName: (rowId, name) =>
    set((s) => ({ rows: s.rows.map((r) => (r.id === rowId ? { ...r, name } : r)) })),

  setRowTime: (rowId, ms) =>
    set((s) => ({ rows: s.rows.map((r) => (r.id === rowId ? { ...r, timeMs: ms } : r)) })),

  addRowAfter: (index) =>
    set((s) => {
      const rows = s.rows.slice();
      const base = rows[index]?.deg;
      rows.splice(index + 1, 0, makeBlankRow(`scs-new-${_newRowSeq++}`, base));
      return { rows };
    }),

  removeRow: (rowId) => set((s) => ({ rows: s.rows.filter((r) => r.id !== rowId) })),

  moveRow: (rowId, dir) =>
    set((s) => {
      const i = s.rows.findIndex((r) => r.id === rowId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.rows.length) return s;
      const rows = s.rows.slice();
      [rows[i], rows[j]] = [rows[j], rows[i]];
      return { rows };
    }),

  play: async (hw) => {
    const serial = useSerialStore.getState();
    if (serial.status !== "connected") {
      useToastStore.getState().show("Connectez la carte (USB) pour jouer la séquence");
      return;
    }
    const rows = get().rows;
    if (rows.length === 0) return;

    _abort = false;
    set({ playing: true, currentRow: -1 });
    const secPer60 = servoSecPer60(hw.servo);
    const canSync = !!hw.protocol.queryMove;
    // Pose commandée précédente (pose complète) pour le calcul du temps faisable.
    let prev = rows[0].deg.slice();
    try {
      for (let i = 0; i < rows.length; i++) {
        if (_abort) break;
        const row = rows[i];
        set({ currentRow: i });
        const feasible = i === 0 ? 0 : feasibleTimeMs(prev, row, secPer60);
        const t = effectiveRowTimeMs(row, feasible);
        const cmd = rowToCommand(row, hw, t);
        if (cmd) {
          await serial.sendRaw(cmd);
          // Respecter la fin du mouvement avant la ligne suivante : synchro `Q` si
          // la carte la gère (plafonnée), sinon attente du temps `T`.
          if (canSync) await serial.waitUntilIdle(t + 800);
          else if (t > 0) await sleep(t);
        }
        prev = row.deg.slice();
      }
      if (!_abort) useToastStore.getState().show("Séquence SCS jouée");
    } finally {
      set({ playing: false, currentRow: -1 });
    }
  },

  stop: () => {
    _abort = true;
    set({ playing: false, currentRow: -1 });
  },
}));
