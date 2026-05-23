import { useState, useEffect } from "react";
import { Scene } from "./three/Scene";
import { ServoPanel } from "./ui/ServoPanel";
import { GeometryPanel } from "./ui/GeometryPanel";
import { PoseList } from "./ui/PoseList";
import { SimulationPanel } from "./ui/SimulationPanel";
import { MirrorPanel } from "./ui/MirrorPanel";
import { UserButton } from "./ui/UserButton";
import { AuthModal } from "./ui/AuthModal";
import { ProfilePanel } from "./ui/ProfilePanel";
import { Toast } from "./ui/Toast";
import { useAuthStore } from "./store/useAuthStore";
import { useProfilesStore } from "./store/useProfilesStore";

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
        <h1>HexaGram</h1>
        <span className="subtitle">POC — hexapode 18 DOF</span>
        <UserButton />
      </header>
      <AuthModal open={openModal} onClose={() => setOpenModal(false)} />
      <Toast />

      <main className={layoutClass}>
        <aside className={`sidebar sidebar-left${leftOpen ? "" : " collapsed"}`}>
          <ProfilePanel />
          <SimulationPanel />
          <GeometryPanel />
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
        <aside className={`sidebar sidebar-right${rightOpen ? "" : " collapsed"}`}>
          <MirrorPanel />
          <ServoPanel />
        </aside>
      </main>
    </div>
  );
}
