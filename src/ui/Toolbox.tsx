import { useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useToolboxStore } from '../store/useToolboxStore';

interface Props {
  id: string;
  title: string;
  children: ReactNode;
}

export function Toolbox({ id, title, children }: Props) {
  const config = useToolboxStore((s) => s.configs[id]);
  const draggingId = useToolboxStore((s) => s.draggingId);

  const draggingRef = useRef(false);
  const dragRef = useRef<{
    startMX: number; startMY: number;
    startFX: number; startFY: number;
    wasDockedBefore: boolean;
  } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();

      const cfg = useToolboxStore.getState().configs[id];
      dragRef.current = {
        startMX: e.clientX,
        startMY: e.clientY,
        startFX: cfg.panel === null ? (cfg.floatPos?.x ?? 300) : e.clientX - 140,
        startFY: cfg.panel === null ? (cfg.floatPos?.y ?? 120) : e.clientY - 12,
        wasDockedBefore: cfg.panel !== null,
      };
      draggingRef.current = false;

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startMX;
        const dy = ev.clientY - dragRef.current.startMY;

        if (!draggingRef.current && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
          draggingRef.current = true;
          const s = useToolboxStore.getState();
          const nx = dragRef.current.startFX + dx;
          const ny = dragRef.current.startFY + dy;
          if (dragRef.current.wasDockedBefore) s.undock(id, { x: nx, y: ny });
          s.setDragging(id);
        }

        if (draggingRef.current) {
          const nx = dragRef.current.startFX + dx;
          const ny = dragRef.current.startFY + dy;
          useToolboxStore.getState().setFloatPos(id, { x: nx, y: ny });

          // Detect sidebar under cursor
          let hovered: 'left' | 'right' | null = null;
          for (const side of ['left', 'right'] as const) {
            const el = document.querySelector(`[data-dock-panel="${side}"]`);
            if (el) {
              const r = el.getBoundingClientRect();
              if (ev.clientX >= r.left && ev.clientX <= r.right &&
                  ev.clientY >= r.top  && ev.clientY <= r.bottom) {
                hovered = side;
                break;
              }
            }
          }

          // Compute insert index from Y position relative to docked toolboxes
          let insertIndex = 0;
          if (hovered) {
            const panelEl = document.querySelector(`[data-dock-panel="${hovered}"]`);
            if (panelEl) {
              const toolboxEls = panelEl.querySelectorAll('[data-toolbox-id]');
              insertIndex = toolboxEls.length;
              for (let i = 0; i < toolboxEls.length; i++) {
                const r = toolboxEls[i].getBoundingClientRect();
                if (ev.clientY < r.top + r.height / 2) {
                  insertIndex = i;
                  break;
                }
              }
            }
          }

          useToolboxStore.getState().setHoverState(hovered, insertIndex);
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (draggingRef.current) {
          const s = useToolboxStore.getState();
          if (s.hoveredPanel) {
            s.dock(id, s.hoveredPanel, s.hoveredInsertIndex);
          } else {
            s.setDragging(null);
            s.setHoveredPanel(null);
          }
        }
        draggingRef.current = false;
        dragRef.current = null;
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [id]
  );

  if (!config) return null;

  const isFloating = config.panel === null;
  const isBeingDragged = draggingId === id;

  const cssVars = isFloating
    ? ({
        '--tx': `${config.floatPos?.x ?? 300}px`,
        '--ty': `${config.floatPos?.y ?? 120}px`,
        '--tz': String(isBeingDragged ? 200 : 100),
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={`toolbox${isFloating ? ' toolbox-floating' : ''}${isBeingDragged ? ' toolbox-dragging' : ''}`}
      style={cssVars}
      data-toolbox-id={id}
    >
      <div className="toolbox-header" onMouseDown={handleMouseDown}>
        <span className="toolbox-drag-handle">⠿</span>
        <span className="toolbox-title">{title}</span>
        <button
          type="button"
          className="toolbox-pin"
          title={config.minimized ? 'Déplier' : 'Réduire'}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => useToolboxStore.getState().setMinimized(id, !config.minimized)}
        >
          {config.minimized ? '+' : '−'}
        </button>
      </div>
      {!config.minimized && <div className="toolbox-body">{children}</div>}
    </div>
  );
}
