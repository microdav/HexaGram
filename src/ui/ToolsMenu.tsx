import { useState, useRef, useEffect } from 'react';
import { ToolsModal } from './ToolsModal';
import { ElectronicConsolePanel } from './ElectronicConsolePanel';

/**
 * Bouton « Outils » de la topbar : ouvre un menu déroulant regroupant les
 * outils transverses (import/export JSON, console électronique). Accessible
 * depuis toutes les pages puisque la topbar est globale.
 */
export function ToolsMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div className="tools-menu-wrapper" ref={ref}>
      <button
        type="button"
        className={`tools-toggle${menuOpen ? ' active' : ''}`}
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen ? 'true' : 'false'}
        title="Outils"
      >
        <span className="tools-toggle-icon" aria-hidden="true">🛠</span>
        <span className="tools-toggle-label">Outils</span>
        <span className="tools-toggle-caret" aria-hidden="true">{menuOpen ? '▲' : '▼'}</span>
      </button>

      {menuOpen && (
        <div className="tools-menu" role="menu">
          <button
            type="button"
            className="tools-menu-item"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setEditorOpen(true);
            }}
          >
            Import/export
          </button>
          <button
            type="button"
            className="tools-menu-item"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setConsoleOpen(true);
            }}
          >
            Console électronique
          </button>
        </div>
      )}

      <ToolsModal open={editorOpen} onClose={() => setEditorOpen(false)} />
      <ElectronicConsolePanel open={consoleOpen} onClose={() => setConsoleOpen(false)} />
    </div>
  );
}
