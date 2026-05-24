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

  // Refs survive across renders within the same component instance.
  // When a docked toolbox undocks mid-drag, the new floating instance
  // mounts but the document event handlers still close over the old refs —
  // that's intentional: drag continues via the old handlers.
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

          // Detect sidebar under cursor using bounding-box check
          // (more reliable than elementFromPoint for pointer-events:none elements)
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
          useToolboxStore.getState().setHoveredPanel(hovered);
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (draggingRef.current) {
          const s = useToolboxStore.getState();
          if (s.hoveredPanel) {
            s.dock(id, s.hoveredPanel);
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

  const style = isFloating
    ? ({
        position: 'fixed',
        left: config.floatPos?.x ?? 300,
        top: config.floatPos?.y ?? 120,
        width: 290,
        zIndex: isBeingDragged ? 200 : 100,
        pointerEvents: isBeingDragged ? 'none' : 'auto',
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={`toolbox${isFloating ? ' toolbox-floating' : ''}${isBeingDragged ? ' toolbox-dragging' : ''}`}
      style={style}
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
