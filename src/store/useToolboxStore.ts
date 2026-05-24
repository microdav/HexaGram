import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PanelSide = 'left' | 'right';

export interface ToolboxConfig {
  panel: PanelSide | null;
  order: number;
  minimized: boolean;
  floatPos: { x: number; y: number };
}

const DEFAULTS: Record<string, ToolboxConfig> = {
  geometry:       { panel: 'left',  order: 0, minimized: false, floatPos: { x: 280, y: 120 } },
  cog:            { panel: 'left',  order: 1, minimized: false, floatPos: { x: 280, y: 300 } },
  'servos-left':  { panel: 'right', order: 0, minimized: false, floatPos: { x: 900, y: 120 } },
  'servos-right': { panel: 'right', order: 1, minimized: false, floatPos: { x: 900, y: 320 } },
};

interface ToolboxStore {
  configs: Record<string, ToolboxConfig>;
  draggingId: string | null;
  hoveredPanel: PanelSide | null;
  setMinimized: (id: string, v: boolean) => void;
  dock: (id: string, panel: PanelSide) => void;
  undock: (id: string, pos: { x: number; y: number }) => void;
  setDragging: (id: string | null) => void;
  setHoveredPanel: (panel: PanelSide | null) => void;
  setFloatPos: (id: string, pos: { x: number; y: number }) => void;
  applyLayout: (layout: Record<string, ToolboxConfig>) => void;
}

export const useToolboxStore = create<ToolboxStore>()(
  persist(
    (set) => ({
      configs: DEFAULTS,
      draggingId: null,
      hoveredPanel: null,

      setMinimized: (id, v) =>
        set((s) => ({ configs: { ...s.configs, [id]: { ...s.configs[id], minimized: v } } })),

      dock: (id, panel) =>
        set((s) => {
          const others = Object.values(s.configs).filter((c) => c.panel === panel);
          const maxOrder = others.length ? Math.max(...others.map((c) => c.order)) : -1;
          return {
            configs: { ...s.configs, [id]: { ...s.configs[id], panel, order: maxOrder + 1 } },
            hoveredPanel: null,
            draggingId: null,
          };
        }),

      undock: (id, pos) =>
        set((s) => ({
          configs: { ...s.configs, [id]: { ...s.configs[id], panel: null, floatPos: pos } },
        })),

      setDragging: (id) => set({ draggingId: id }),
      setHoveredPanel: (panel) => set({ hoveredPanel: panel }),

      setFloatPos: (id, pos) =>
        set((s) => ({
          configs: { ...s.configs, [id]: { ...s.configs[id], floatPos: pos } },
        })),

      applyLayout: (layout) =>
        set((s) => ({ configs: { ...s.configs, ...layout } })),
    }),
    {
      name: 'hexagram-toolboxes',
      partialize: (s) => ({ configs: s.configs }),
      merge: (persisted: unknown, current) => ({
        ...current,
        configs: { ...DEFAULTS, ...((persisted as { configs?: Record<string, ToolboxConfig> }).configs ?? {}) },
      }),
    }
  )
);
