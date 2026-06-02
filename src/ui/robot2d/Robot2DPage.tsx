import { useEffect } from "react";
import { useToolboxStore } from "../../store/useToolboxStore";
import { useHexapodStore } from "../../store/useHexapodStore";
import { useProfilesStore } from "../../store/useProfilesStore";
import { isProfileDirty } from "../../store/profileEditGuard";
import { useRobot2DHistory } from "../../store/useRobot2DHistory";
import { Robot2DLeftPanel } from "./Robot2DLeftPanel";
import { Robot2DToolsPanel } from "./Robot2DToolsPanel";
import { Robot2DToolbar } from "./Robot2DToolbar";
import { Robot2DCanvas } from "./Robot2DCanvas";

export function Robot2DPage() {
  const leftOpen = useToolboxStore((s) => s.uiPrefs.leftOpen);
  const rightOpen = useToolboxStore((s) => s.uiPrefs.rightOpen);
  const setLeftOpen = useToolboxStore((s) => s.setLeftOpen);
  const setRightOpen = useToolboxStore((s) => s.setRightOpen);
  const layoutClass = `layout${leftOpen ? "" : " left-collapsed"}${rightOpen ? "" : " right-collapsed"}`;

  // Base de l'historique à l'ouverture de l'onglet (instantané de la géométrie courante).
  useEffect(() => {
    useRobot2DHistory.getState().reset(useHexapodStore.getState().geometry);
  }, []);

  // Enregistrement automatique de la base mécanique : toute modif du tracé est
  // persistée après 1 s de stabilité, pour ne rien perdre au rafraîchissement.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsub = useHexapodStore.subscribe(() => {
      const { activeProfileId } = useProfilesStore.getState();
      if (!activeProfileId || !isProfileDirty()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        useProfilesStore.getState().update(activeProfileId).catch(() => {});
      }, 1000);
    });
    return () => { unsub(); clearTimeout(timer); };
  }, []);

  // Raccourcis annuler / rétablir, actifs tant que l'onglet Robot 2D est monté.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (k === "z" && !e.shiftKey) { e.preventDefault(); useRobot2DHistory.getState().undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); useRobot2DHistory.getState().redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className={layoutClass}>
      <aside className={`sidebar sidebar-left${leftOpen ? "" : " collapsed"}`}>
        <Robot2DLeftPanel />
      </aside>
      <button
        type="button"
        className={`sidebar-handle handle-left${leftOpen ? "" : " collapsed"}`}
        onClick={() => setLeftOpen(!leftOpen)}
        aria-label={leftOpen ? "Fermer le panneau gauche" : "Ouvrir le panneau gauche"}
        title={leftOpen ? "Fermer le panneau gauche" : "Ouvrir le panneau gauche"}
      >
        {leftOpen ? "‹" : "›"}
      </button>

      <section className="viewer">
        <Robot2DToolbar />
        <Robot2DCanvas />
      </section>

      <button
        type="button"
        className={`sidebar-handle handle-right${rightOpen ? "" : " collapsed"}`}
        onClick={() => setRightOpen(!rightOpen)}
        aria-label={rightOpen ? "Fermer le panneau droit" : "Ouvrir le panneau droit"}
        title={rightOpen ? "Fermer le panneau droit" : "Ouvrir le panneau droit"}
      >
        {rightOpen ? "›" : "‹"}
      </button>
      <aside className={`sidebar sidebar-right${rightOpen ? "" : " collapsed"}`}>
        <Robot2DToolsPanel />
      </aside>
    </main>
  );
}
