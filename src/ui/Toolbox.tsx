import { useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useToolboxStore } from '../store/useToolboxStore';
import type { PanelSide } from '../store/useToolboxStore';

interface Props {
  id: string;
  title: string;
  children: ReactNode;
  compact?: boolean;
}

/** Pas de déplacement (px) pour le repositionnement d'une boîte flottante au doigt. */
const NUDGE = 48;

/**
 * Panneau de placement tactile (mode tablette) : remplace le glisser-déposer
 * souris par des boutons explicites — réordonner, changer de panneau, détacher,
 * ou repositionner une boîte flottante par paliers.
 */
function ToolboxMover({ id, onClose }: { id: string; onClose: () => void }) {
  const configs = useToolboxStore((s) => s.configs);
  const dock = useToolboxStore((s) => s.dock);
  const undock = useToolboxStore((s) => s.undock);
  const setFloatPos = useToolboxStore((s) => s.setFloatPos);

  const config = configs[id];
  if (!config) return null;

  const panel = config.panel;
  const isFloating = panel === null;

  const siblings = panel
    ? Object.entries(configs)
        .filter(([, c]) => c.panel === panel)
        .sort(([, a], [, b]) => a.order - b.order)
        .map(([k]) => k)
    : [];
  const idx = siblings.indexOf(id);
  const isFirst = idx <= 0;
  const isLast = idx === siblings.length - 1;

  const nudge = (dx: number, dy: number) => {
    const cur = config.floatPos ?? { x: 300, y: 120 };
    setFloatPos(id, { x: Math.max(0, cur.x + dx), y: Math.max(0, cur.y + dy) });
  };

  return (
    <>
      <div className="toolbox-mover-backdrop" onClick={onClose} />
      <div className="toolbox-mover" role="dialog" aria-label="Déplacer la boîte">
        <button type="button" className="toolbox-mover-close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>

        {isFloating ? (
          <>
            <div className="toolbox-mover-pad">
              <button type="button" className="tb-move tb-move-up" onClick={() => nudge(0, -NUDGE)} aria-label="Monter">↑</button>
              <button type="button" className="tb-move tb-move-left" onClick={() => nudge(-NUDGE, 0)} aria-label="Gauche">←</button>
              <button type="button" className="tb-move tb-move-right" onClick={() => nudge(NUDGE, 0)} aria-label="Droite">→</button>
              <button type="button" className="tb-move tb-move-down" onClick={() => nudge(0, NUDGE)} aria-label="Descendre">↓</button>
            </div>
            <div className="toolbox-mover-actions">
              <button type="button" className="tb-act" onClick={() => { dock(id, 'left'); onClose(); }}>◧ Ancrer à gauche</button>
              <button type="button" className="tb-act" onClick={() => { dock(id, 'right'); onClose(); }}>Ancrer à droite ◨</button>
            </div>
          </>
        ) : (
          <>
            <div className="toolbox-mover-actions">
              <button type="button" className="tb-act" disabled={isFirst} onClick={() => dock(id, panel, idx - 1)}>↑ Monter</button>
              <button type="button" className="tb-act" disabled={isLast} onClick={() => dock(id, panel, idx + 1)}>↓ Descendre</button>
            </div>
            <div className="toolbox-mover-actions">
              {panel === 'left' ? (
                <button type="button" className="tb-act" onClick={() => { dock(id, 'right'); onClose(); }}>Envoyer à droite →</button>
              ) : panel === 'right' ? (
                <button type="button" className="tb-act" onClick={() => { dock(id, 'left'); onClose(); }}>← Envoyer à gauche</button>
              ) : (
                <>
                  <button type="button" className="tb-act" onClick={() => { dock(id, 'left'); onClose(); }}>◧ Gauche</button>
                  <button type="button" className="tb-act" onClick={() => { dock(id, 'right'); onClose(); }}>Droite ◨</button>
                </>
              )}
            </div>
            <div className="toolbox-mover-actions">
              <button
                type="button"
                className="tb-act"
                onClick={() => { undock(id, config.floatPos ?? { x: 300, y: 120 }); onClose(); }}
              >
                ⊞ Détacher
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function Toolbox({ id, title, children, compact = false }: Props) {
  const config = useToolboxStore((s) => s.configs[id]);
  const draggingId = useToolboxStore((s) => s.draggingId);
  const tabletMode = useToolboxStore((s) => s.tabletMode);

  const [moverOpen, setMoverOpen] = useState(false);

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

          // Detect panel under cursor (querySelectorAll to cover multiple elements per panel)
          let hovered: PanelSide | null = null;
          for (const side of ['left', 'right', 'sequencer'] as const) {
            const els = document.querySelectorAll(`[data-dock-panel="${side}"]`);
            for (const el of els) {
              const r = el.getBoundingClientRect();
              if (ev.clientX >= r.left && ev.clientX <= r.right &&
                  ev.clientY >= r.top  && ev.clientY <= r.bottom) {
                hovered = side;
                break;
              }
            }
            if (hovered) break;
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

  if (compact) {
    return (
      <div className="toolbox-inline" data-toolbox-id={id}>
        {tabletMode ? (
          <button
            type="button"
            className="toolbox-drag-handle toolbox-drag-handle--sm toolbox-move-btn"
            onClick={() => setMoverOpen((v) => !v)}
            title="Déplacer"
            aria-label="Déplacer la boîte"
          >
            ⠿
          </button>
        ) : (
          <span className="toolbox-drag-handle toolbox-drag-handle--sm" onMouseDown={handleMouseDown} title="Déplacer">
            ⠿
          </span>
        )}
        {children}
        {tabletMode && moverOpen && <ToolboxMover id={id} onClose={() => setMoverOpen(false)} />}
      </div>
    );
  }

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
      <div
        className="toolbox-header"
        onMouseDown={tabletMode ? undefined : handleMouseDown}
      >
        {tabletMode ? (
          <button
            type="button"
            className="toolbox-drag-handle toolbox-move-btn"
            onClick={() => setMoverOpen((v) => !v)}
            title="Déplacer"
            aria-label="Déplacer la boîte"
          >
            ⠿
          </button>
        ) : (
          <span className="toolbox-drag-handle">⠿</span>
        )}
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
      {tabletMode && moverOpen && <ToolboxMover id={id} onClose={() => setMoverOpen(false)} />}
    </div>
  );
}
