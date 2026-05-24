import { useState, useEffect } from "react";
import { Scene } from "./three/Scene";
import { PoseList } from "./ui/PoseList";
import { SimulationPanel } from "./ui/SimulationPanel";
import { MirrorPanel } from "./ui/MirrorPanel";
import { UserButton } from "./ui/UserButton";
import { AuthModal } from "./ui/AuthModal";
import { ProfilePanel } from "./ui/ProfilePanel";
import { Toast } from "./ui/Toast";
import { HexaLogo } from "./ui/HexaLogo";
import { InstallBanner } from "./ui/InstallBanner";
import { ToolboxSlot, FloatingToolboxes } from "./ui/ToolboxSlot";
import { useAuthStore } from "./store/useAuthStore";
import { useProfilesStore } from "./store/useProfilesStore";
import { useToolboxStore } from "./store/useToolboxStore";

export default function App() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const layoutClass = `layout${leftOpen ? "" : " left-collapsed"}${rightOpen ? "" : " right-collapsed"}`;
  const { openModal, setOpenModal, bootstrap } = useAuthStore();
  const user = useAuthStore((s) => s.user);
  const listProfiles = useProfilesStore((s) => s.list);
  const loadProfile = useProfilesStore((s) => s.load);
  const clearProfiles = useProfilesStore((s) => s.clear);

  useEffect(() => { bootstrap(); }, []);

  // Auto-save toolbox layout to the active profile after any move/minimize
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsub = useToolboxStore.subscribe((state, prev) => {
      if (state.configs === prev.configs) return;
      const { activeProfileId } = useProfilesStore.getState();
      if (!activeProfileId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        useProfilesStore.getState().update(activeProfileId);
      }, 1500);
    });
    return () => { unsub(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!user) {
      clearProfiles();
      return;
    }
    listProfiles().then(() => {
      const { profiles } = useProfilesStore.getState();
      if (profiles.length === 0) return;
      const latest = [...profiles].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      loadProfile(latest.id);
    });
  }, [user]);

  return (
    <div className="app">
      <header className="topbar">
        <HexaLogo size={30} />
        <h1>HexaGram</h1>
        <span className="subtitle">hexapode 18 DOF</span>
        <UserButton />
      </header>
      <AuthModal open={openModal} onClose={() => setOpenModal(false)} />
      <InstallBanner />
      <Toast />

      <main className={layoutClass}>
        <aside
          className={`sidebar sidebar-left${leftOpen ? "" : " collapsed"}`}
          data-dock-panel="left"
        >
          <ProfilePanel />
          <SimulationPanel />
          <ToolboxSlot panel="left" />
          <PoseList />
        </aside>
        <button
          type="button"
          className={`sidebar-handle handle-left${leftOpen ? "" : " collapsed"}`}
          onClick={() => setLeftOpen((v) => !v)}
          aria-label={leftOpen ? "Fermer le panneau gauche" : "Ouvrir le panneau gauche"}
          title={leftOpen ? "Fermer le panneau gauche" : "Ouvrir le panneau gauche"}
        >
          {leftOpen ? "‹" : "›"}
        </button>

        <section className="viewer">
          <Scene />
        </section>

        <button
          type="button"
          className={`sidebar-handle handle-right${rightOpen ? "" : " collapsed"}`}
          onClick={() => setRightOpen((v) => !v)}
          aria-label={rightOpen ? "Fermer le panneau droit" : "Ouvrir le panneau droit"}
          title={rightOpen ? "Fermer le panneau droit" : "Ouvrir le panneau droit"}
        >
          {rightOpen ? "›" : "‹"}
        </button>
        <aside
          className={`sidebar sidebar-right${rightOpen ? "" : " collapsed"}`}
          data-dock-panel="right"
        >
          <MirrorPanel />
          <ToolboxSlot panel="right" />
        </aside>
      </main>

      <FloatingToolboxes />
    </div>
  );
}
