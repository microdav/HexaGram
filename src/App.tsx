import { useEffect } from "react";
import { Scene } from "./three/Scene";
import { MirrorPanel } from "./ui/MirrorPanel";
import { UserButton } from "./ui/UserButton";
import { AuthModal } from "./ui/AuthModal";
import { ProfilePanel } from "./ui/ProfilePanel";
import { Toast } from "./ui/Toast";
import { HexaLogo } from "./ui/HexaLogo";
import { InstallBanner } from "./ui/InstallBanner";
import { ToolboxSlot, FloatingToolboxes } from "./ui/ToolboxSlot";
import { SequencerPanel } from "./ui/SequencerPanel";
import { ProgramPage } from "./ui/ProgramPage";
import { ProjectTab } from "./ui/ProjectTab";
import { ProjectPage } from "./ui/ProjectPage";
import { useAuthStore } from "./store/useAuthStore";
import { useProfilesStore } from "./store/useProfilesStore";
import { useToolboxStore } from "./store/useToolboxStore";
import { useSequencerStore } from "./store/useSequencerStore";
import { useHexapodStore } from "./store/useHexapodStore";
import { useProjectStore } from "./store/useProjectStore";
import { useSavedSequencesStore } from "./store/useSavedSequencesStore";
import { useProgramsStore } from "./store/useProgramsStore";
import { usePhotoSpaceStore } from "./store/usePhotoSpaceStore";
import { DEMO_STEPS, DEMO_SEQUENCE_NAME } from "./model/demoSequence";

export default function App() {
  const leftOpen = useToolboxStore((s) => s.uiPrefs.leftOpen);
  const rightOpen = useToolboxStore((s) => s.uiPrefs.rightOpen);
  const activeTab = useToolboxStore((s) => s.uiPrefs.activeTab ?? 'conception');
  const setLeftOpen = useToolboxStore((s) => s.setLeftOpen);
  const setRightOpen = useToolboxStore((s) => s.setRightOpen);
  const setActiveTab = useToolboxStore((s) => s.setActiveTab);
  const layoutClass = `layout${leftOpen ? "" : " left-collapsed"}${rightOpen ? "" : " right-collapsed"}`;
  const { openModal, setOpenModal, bootstrap } = useAuthStore();
  const user = useAuthStore((s) => s.user);
  const listProfiles = useProfilesStore((s) => s.list);
  const loadProfile = useProfilesStore((s) => s.load);
  const clearProfiles = useProfilesStore((s) => s.clear);
  const clearSequences = useSavedSequencesStore((s) => s.clear);
  const clearPrograms = useProgramsStore((s) => s.clear);
  const listProjects = useProjectStore((s) => s.list);
  const loadProject = useProjectStore((s) => s.load);
  const clearProjects = useProjectStore((s) => s.clear);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const activeProject = useProjectStore((s) => s.activeProject);

  useEffect(() => {
    bootstrap().then(() => {
      if (!useAuthStore.getState().user) {
        useSequencerStore.getState().setTransitionSpeed(0.1);
        useSequencerStore.getState().setStepDelay(0.1);
        useSequencerStore.getState().loadSteps(DEMO_STEPS, DEMO_SEQUENCE_NAME);
        useHexapodStore.getState().setGravityEnabled(true);
        useHexapodStore.getState().setGeometry({ legLayout: "linear" });
      }
    });
  }, []);

  // Auto-save toolbox layout to the active profile after any move/minimize
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsub = useToolboxStore.subscribe((state, prev) => {
      if (state.configs === prev.configs && state.uiPrefs === prev.uiPrefs) return;
      const { activeProfileId } = useProfilesStore.getState();
      if (!activeProfileId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        useProfilesStore.getState().update(activeProfileId);
      }, 1500);
    });
    return () => { unsub(); clearTimeout(timer); };
  }, []);

  // À la connexion : charger les projets et activer le dernier mis à jour
  useEffect(() => {
    if (!user) {
      clearProjects();
      clearProfiles();
      clearSequences();
      clearPrograms();
      return;
    }
    (async () => {
      const list = await listProjects();
      if (list.length === 0) {
        // Aucun projet → bascule sur l'onglet Projet pour création
        setActiveTab('projet');
        return;
      }
      const latest = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      await loadProject(latest.id);
    })();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Au changement de projet : charger profils/séquences/programmes + activer le dernier profil
  useEffect(() => {
    if (!user || !activeProjectId) return;
    (async () => {
      await listProfiles();
      const { profiles } = useProfilesStore.getState();
      if (profiles.length === 0) return;
      const latest = [...profiles].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      await loadProfile(latest.id);
    })();
  }, [user, activeProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Au chargement d'un projet : applique sa direction caméra "Espace photo".
  // Pas de projet (ex. mode démo) → on garde la valeur persistée localement
  // (localStorage) au lieu de la remettre au défaut.
  useEffect(() => {
    if (!activeProject) return;
    usePhotoSpaceStore.getState().applyFromProject(
      activeProject.preferences.photoSpaceViewDirection ?? null
    );
  }, [activeProject]);

  // Si l'utilisateur perd l'accès au projet alors qu'il était sur Conception/Programmation,
  // on bascule sur l'onglet Projet pour qu'il puisse en choisir un.
  useEffect(() => {
    if (user && !activeProjectId && activeTab !== 'projet') {
      setActiveTab('projet');
    }
  }, [user, activeProjectId, activeTab, setActiveTab]);

  // Mode démo : si l'utilisateur se déconnecte alors qu'il était sur l'onglet Projet,
  // on bascule sur Conception (l'onglet Projet n'est plus visible).
  useEffect(() => {
    if (!user && activeTab === 'projet') {
      setActiveTab('conception');
    }
  }, [user, activeTab, setActiveTab]);

  return (
    <div className="app">
      <header className="topbar">
        <HexaLogo size={30} />
        <h1>HexaGram</h1>
        <span className="subtitle">hexapode 18 DOF</span>
        <div className="topbar-right">
          {!user && <span className="demo-badge">Mode démo</span>}
          <UserButton />
        </div>
      </header>

      <nav className="app-tabs">
        {user && <ProjectTab />}
        <button
          type="button"
          className={`app-tab${activeTab === 'conception' ? ' active' : ''}`}
          onClick={() => setActiveTab('conception')}
          disabled={!!user && !activeProjectId}
          title={!!user && !activeProjectId ? "Sélectionnez ou créez un projet d'abord" : ""}
        >
          Conception 3D
        </button>
        <button
          type="button"
          className={`app-tab${activeTab === 'programmation' ? ' active' : ''}`}
          onClick={() => setActiveTab('programmation')}
          disabled={!!user && !activeProjectId}
          title={!!user && !activeProjectId ? "Sélectionnez ou créez un projet d'abord" : ""}
        >
          Programmation graphique
        </button>
      </nav>

      <AuthModal open={openModal} onClose={() => setOpenModal(false)} />
      <InstallBanner />
      <Toast />

      {activeTab === 'projet' && user && <ProjectPage />}

      {activeTab === 'conception' && (
        <>
          <main className={layoutClass}>
            <aside
              className={`sidebar sidebar-left${leftOpen ? "" : " collapsed"}`}
              data-dock-panel="left"
            >
              <ProfilePanel />
              <ToolboxSlot panel="left" />
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
              <Scene />
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
            <aside
              className={`sidebar sidebar-right${rightOpen ? "" : " collapsed"}`}
              data-dock-panel="right"
            >
              <MirrorPanel />
              <ToolboxSlot panel="right" />
            </aside>
          </main>

          <SequencerPanel />
          <FloatingToolboxes />
        </>
      )}

      {activeTab === 'programmation' && <ProgramPage />}
    </div>
  );
}
