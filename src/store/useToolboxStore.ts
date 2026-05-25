import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PanelSide = 'left' | 'right' | 'sequencer';

export interface ToolboxConfig {
  panel: PanelSide | null;
  order: number;
  minimized: boolean;
  floatPos: { x: number; y: number };
}

export interface UiPrefs {
  leftOpen: boolean;
  rightOpen: boolean;
  sequencerOpen: boolean;
  programsOpen: boolean;
}

const LEFT_PANEL_W = 260;
const RIGHT_PANEL_W = 300;
const TOOLBOX_W = 290;
const MARGIN = 8;
const FOLLOW_THRESHOLD = 100;

function shiftFloating(
  configs: Record<string, ToolboxConfig>,
  side: 'left' | 'right',
  opening: boolean
): Record<string, ToolboxConfig> {
  const W = window.innerWidth;
  const result = { ...configs };
  let changed = false;
  for (const [id, cfg] of Object.entries(result)) {
    if (cfg.panel !== null) continue;
    let { x, y } = cfg.floatPos;
    if (side === 'left') {
      if (opening) {
        if (x < LEFT_PANEL_W + MARGIN) x = LEFT_PANEL_W + MARGIN;
      } else {
        if (x < LEFT_PANEL_W + FOLLOW_THRESHOLD) x = Math.max(MARGIN, x - LEFT_PANEL_W);
      }
    } else {
      if (opening) {
        if (x + TOOLBOX_W > W - RIGHT_PANEL_W) x = W - RIGHT_PANEL_W - TOOLBOX_W - MARGIN;
      } else {
        if (x + TOOLBOX_W > W - RIGHT_PANEL_W - FOLLOW_THRESHOLD) x = Math.min(W - TOOLBOX_W - MARGIN, x + RIGHT_PANEL_W);
      }
    }
    x = Math.max(MARGIN, Math.min(W - TOOLBOX_W - MARGIN, x));
    if (x !== cfg.floatPos.x) {
      result[id] = { ...cfg, floatPos: { x, y } };
      changed = true;
    }
  }
  return changed ? result : configs;
}

const DEFAULTS: Record<string, ToolboxConfig> = {
  geometry:       { panel: 'left',  order: 0, minimized: false, floatPos: { x: 280, y: 120 } },
  cog:            { panel: 'left',  order: 1, minimized: false, floatPos: { x: 280, y: 300 } },
  simulation:     { panel: 'left',  order: 2, minimized: false, floatPos: { x: 280, y: 480 } },
  'servos-left':  { panel: 'right', order: 0, minimized: false, floatPos: { x: 900, y: 120 } },
  'servos-right': { panel: 'right', order: 1, minimized: false, floatPos: { x: 900, y: 320 } },
  'seq-ctrl':     { panel: null,    order: 0, minimized: false, floatPos: { x: Math.round(window.innerWidth / 2 - 100), y: 60 } },
};

const DEFAULT_UI_PREFS: UiPrefs = {
  leftOpen: true,
  rightOpen: true,
  sequencerOpen: false,
  programsOpen: false,
};

interface ToolboxStore {
  configs: Record<string, ToolboxConfig>;
  uiPrefs: UiPrefs;
  draggingId: string | null;
  hoveredPanel: PanelSide | null;
  hoveredInsertIndex: number;
  setMinimized: (id: string, v: boolean) => void;
  dock: (id: string, panel: PanelSide, insertIndex?: number) => void;
  undock: (id: string, pos: { x: number; y: number }) => void;
  setDragging: (id: string | null) => void;
  setHoverState: (panel: PanelSide | null, insertIndex: number) => void;
  setHoveredPanel: (panel: PanelSide | null) => void;
  setFloatPos: (id: string, pos: { x: number; y: number }) => void;
  applyLayout: (layout: Record<string, ToolboxConfig>) => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  setSequencerOpen: (v: boolean) => void;
  setProgramsOpen: (v: boolean) => void;
  applyUiPrefs: (prefs: Partial<UiPrefs>) => void;
}

export const useToolboxStore = create<ToolboxStore>()(
  persist(
    (set) => ({
      configs: DEFAULTS,
      uiPrefs: DEFAULT_UI_PREFS,
      draggingId: null,
      hoveredPanel: null,
      hoveredInsertIndex: 0,

      setMinimized: (id, v) =>
        set((s) => ({ configs: { ...s.configs, [id]: { ...s.configs[id], minimized: v } } })),

      dock: (id, panel, insertIndex?) =>
        set((s) => {
          const others = Object.entries(s.configs)
            .filter(([k, c]) => k !== id && c.panel === panel)
            .sort(([, a], [, b]) => a.order - b.order)
            .map(([k]) => k);
          const pos = insertIndex !== undefined ? Math.min(insertIndex, others.length) : others.length;
          const ordered = [...others.slice(0, pos), id, ...others.slice(pos)];
          const newConfigs = { ...s.configs };
          ordered.forEach((k, i) => {
            newConfigs[k] = { ...newConfigs[k], panel, order: i };
          });
          return { configs: newConfigs, hoveredPanel: null, hoveredInsertIndex: 0, draggingId: null };
        }),

      undock: (id, pos) =>
        set((s) => ({
          configs: { ...s.configs, [id]: { ...s.configs[id], panel: null, floatPos: pos } },
        })),

      setDragging: (id) => set({ draggingId: id }),

      setHoverState: (panel, insertIndex) => set({ hoveredPanel: panel, hoveredInsertIndex: insertIndex }),

      setHoveredPanel: (panel) => set({ hoveredPanel: panel, hoveredInsertIndex: 0 }),

      setFloatPos: (id, pos) =>
        set((s) => ({
          configs: { ...s.configs, [id]: { ...s.configs[id], floatPos: pos } },
        })),

      applyLayout: (layout) =>
        set((s) => ({ configs: { ...s.configs, ...layout } })),

      setLeftOpen: (v) =>
        set((s) => ({
          configs: shiftFloating(s.configs, 'left', v),
          uiPrefs: { ...s.uiPrefs, leftOpen: v },
        })),
      setRightOpen: (v) =>
        set((s) => ({
          configs: shiftFloating(s.configs, 'right', v),
          uiPrefs: { ...s.uiPrefs, rightOpen: v },
        })),
      setSequencerOpen: (v) => set((s) => ({ uiPrefs: { ...s.uiPrefs, sequencerOpen: v } })),
      setProgramsOpen: (v) => set((s) => ({ uiPrefs: { ...s.uiPrefs, programsOpen: v } })),
      applyUiPrefs: (prefs) => set((s) => ({ uiPrefs: { ...s.uiPrefs, ...prefs } })),
    }),
    {
      name: 'hexagram-toolboxes',
      partialize: (s) => ({ configs: s.configs, uiPrefs: s.uiPrefs }),
      merge: (persisted: unknown, current) => {
        const p = persisted as { configs?: Record<string, ToolboxConfig>; uiPrefs?: Partial<UiPrefs> };
        return {
          ...current,
          configs: { ...DEFAULTS, ...(p.configs ?? {}) },
          uiPrefs: { ...DEFAULT_UI_PREFS, ...(p.uiPrefs ?? {}) },
        };
      },
    }
  )
);
