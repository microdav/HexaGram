import { useEffect, useState } from "react";
import { Scene } from "./three/Scene";
import { MirrorPanel } from "./ui/MirrorPanel";
import { UserButton } from "./ui/UserButton";
import { AuthModal } from "./ui/AuthModal";
import { ProfilePanel } from "./ui/ProfilePanel";
import { Toast } from "./ui/Toast";
import { HexaLogo } from "./ui/HexaLogo";
import { InstallBanner } from "./ui/InstallBanner";
import { ToolboxSlot, FloatingToolboxes } from "./ui/ToolboxSlot";
import { TabletServoEditor } from "./ui/TabletServoEditor";
import { SequencerPanel } from "./ui/SequencerPanel";
import { PoseConflictModal } from "./ui/PoseConflictModal";
import { ToolsMenu } from "./ui/ToolsMenu";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { PoseThumbnailRenderer } from "./three/PoseThumbnailRenderer";
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
import { useProgramRunStore } from "./store/useProgramRunStore";
import { DEMO_STEPS, DEMO_SEQUENCE_NAME } from "./model/demoSequence";
import { getInitialUrlState, slugify, writeUrlState } from "./hooks/useUrlState";
import { guardStepEdit, getPendingStepEdit } from "./store/stepEditGuard";
import { guardPoseEdit, getPendingPoseEdit } from "./store/poseEditGuard";
import { guardProfileEdit, isProfileDirty } from "./store/profileEditGuard";
import { guardProgramEdit } from "./store/programEditGuard";

export default function App() {
  const leftOpen = useToolboxStore((s) => s.uiPrefs.leftOpen);
  const rightOpen = useToolboxStore((s) => s.uiPrefs.rightOpen);
  const activeTab = useToolboxStore((s) => s.uiPrefs.activeTab ?? 'conception');
  const tabletMode = useToolboxStore((s) => s.tabletMode);
  const setTabletMode = useToolboxStore((s) => s.setTabletMode);
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
  const activeProfileId = useProfilesStore((s) => s.activeProfileId);
  const profiles = useProfilesStore((s) => s.profiles);
  const programs = useProgramsStore((s) => s.programs);
  const selectedProgramId = useProgramsStore((s) => s.selectedProgramId);
  const listPrograms = useProgramsStore((s) => s.list);
  const setSelectedProgramId = useProgramsStore((s) => s.setSelectedProgramId);
  // True une fois la résolution initiale projet/profil terminée — sert à
  // éviter qu'un effet réactif bascule sur l'onglet Projet pendant la phase
  // de chargement (où activeProjectId est encore null).
  const [projectsResolved, setProjectsResolved] = useState(false);

  useEffect(() => {
    // L'URL est source de vérité au démarrage pour l'onglet actif :
    // permet à un hard refresh de rester sur la même vue.
    const initial = getInitialUrlState();
    if (initial.tab && initial.tab !== useToolboxStore.getState().uiPrefs.activeTab) {
      useToolboxStore.getState().setActiveTab(initial.tab);
    }
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

  // Garde-fou : si le login de l'URL ne correspond pas à l'utilisateur connecté,
  // l'URL sera réécrite par l'effet de sync. Pas de redirection forcée.

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

  // Avertit avant un hard refresh / fermeture d'onglet si une pose d'étape a
  // été modifiée sans être appliquée (prompt natif — pas de modale custom
  // possible sur beforeunload).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (getPendingStepEdit() || getPendingPoseEdit() || isProfileDirty()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Enregistrement automatique du profil : quand l'option est active, toute
  // modification de la config robot est persistée après stabilisation (1,5 s).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const unsub = useHexapodStore.subscribe(() => {
      const { autoSave, activeProfileId } = useProfilesStore.getState();
      if (!autoSave || !activeProfileId || !isProfileDirty()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        useProfilesStore.getState().update(activeProfileId);
      }, 1500);
    });
    return () => { unsub(); clearTimeout(timer); };
  }, []);

  // Garde combiné avant de quitter la page Conception : étape éditée puis profil.
  const guardDesignLeave = async (): Promise<boolean> =>
    (await guardStepEdit()) && (await guardPoseEdit()) && (await guardProfileEdit());

  // Garde de l'onglet courant : Conception (pose/étape/profil) ou Programmation
  // (brouillon de programme non enregistré). Les autres onglets ne gardent rien.
  const guardLeaveCurrentTab = async (): Promise<boolean> => {
    if (activeTab === 'conception') return guardDesignLeave();
    if (activeTab === 'programmation') return guardProgramEdit();
    return true;
  };

  // Changement d'onglet protégé : on propose d'enregistrer les modifications en
  // cours avant de quitter l'onglet (pose/profil en Conception, programme en
  // Programmation).
  const guardedSetActiveTab = async (tab: Parameters<typeof setActiveTab>[0]) => {
    if (tab !== activeTab) {
      if (!(await guardLeaveCurrentTab())) return;
    }
    setActiveTab(tab);
  };

  // À la connexion : charger les projets et activer celui de l'URL (slug)
  // si trouvé, sinon le dernier mis à jour
  useEffect(() => {
    if (!user) {
      clearProjects();
      clearProfiles();
      clearSequences();
      clearPrograms();
      setProjectsResolved(false);
      return;
    }
    (async () => {
      try {
        const list = await listProjects();
        if (list.length === 0) {
          // Aucun projet → bascule sur l'onglet Projet pour création
          setActiveTab('projet');
          return;
        }
        const desiredSlug = getInitialUrlState().project;
        const target = (desiredSlug && list.find((p) => slugify(p.name) === desiredSlug))
          || [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        await loadProject(target.id);
      } finally {
        setProjectsResolved(true);
      }
    })();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Au changement de projet : charger profils + activer le profil de l'URL
  // (slug) si trouvé, sinon le dernier mis à jour. Liste aussi les programmes
  // pour que le slug programme de l'URL puisse être résolu côté ProgramPage.
  useEffect(() => {
    if (!user || !activeProjectId) return;
    (async () => {
      await listProfiles();
      const { profiles } = useProfilesStore.getState();
      if (profiles.length > 0) {
        const desiredSlug = getInitialUrlState().profile;
        const target = (desiredSlug && profiles.find((p) => slugify(p.name) === desiredSlug))
          || [...profiles].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        await loadProfile(target.id);
      }
      // Liste des programmes côté projet (et résolution du slug URL → ID)
      await listPrograms();
      const { programs: progs } = useProgramsStore.getState();
      const desiredProgSlug = getInitialUrlState().program;
      if (desiredProgSlug) {
        const match = progs.find((p) => slugify(p.name) === desiredProgSlug);
        if (match) setSelectedProgramId(match.id);
      }
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
    // Position de départ du robot dans la salle d'exécution (préférence projet).
    const rsp = activeProject.preferences.roomStartPos;
    if (rsp) useProgramRunStore.getState().setStartPos(rsp.x, rsp.z);
  }, [activeProject]);

  // Si l'utilisateur perd l'accès au projet alors qu'il était sur Conception/Programmation,
  // on bascule sur l'onglet Projet pour qu'il puisse en choisir un.
  // On attend que la résolution initiale soit terminée pour ne pas réagir
  // au moment où activeProjectId est encore null pendant le chargement.
  useEffect(() => {
    if (projectsResolved && user && !activeProjectId && activeTab !== 'projet') {
      setActiveTab('projet');
    }
  }, [projectsResolved, user, activeProjectId, activeTab, setActiveTab]);

  // Mode démo : si l'utilisateur se déconnecte alors qu'il était sur l'onglet Projet,
  // on bascule sur Conception (l'onglet Projet n'est plus visible).
  useEffect(() => {
    if (!user && activeTab === 'projet') {
      setActiveTab('conception');
    }
  }, [user, activeTab, setActiveTab]);

  // Sync de l'état → URL (replaceState : pas d'entrées d'historique).
  // URL : /{userLogin}/{projectSlug}/{tab}/{profileSlug?}/{programSlug?}
  // En mode démo l'URL est juste "/".
  useEffect(() => {
    const profile = profiles.find((p) => p.id === activeProfileId);
    const program = programs.find((p) => p.id === selectedProgramId);
    writeUrlState({
      userLogin: user?.login ?? null,
      projectName: user ? activeProject?.name ?? null : null,
      tab: activeTab,
      profileName: profile?.name ?? null,
      programName: program?.name ?? null,
    });
  }, [user, activeProject, activeTab, activeProfileId, profiles, selectedProgramId, programs]);

  return (
    <div className={`app${tabletMode ? " tablet" : ""}`}>
      <header className="topbar">
        <HexaLogo size={30} />
        <h1>HexaGram</h1>
        <span className="subtitle">hexapode 18 DOF</span>
        <div className="topbar-right">
          {!user && <span className="demo-badge">Mode démo</span>}
          <ToolsMenu />
          <button
            type="button"
            className={`tablet-toggle${tabletMode ? " active" : ""}`}
            onClick={() => setTabletMode(!tabletMode)}
            aria-pressed={tabletMode ? "true" : "false"}
            title={tabletMode ? "Mode tablette activé — cliquer pour repasser en mode souris" : "Activer le mode tablette (commandes tactiles)"}
          >
            <span className="tablet-toggle-icon" aria-hidden="true">▭</span>
            <span className="tablet-toggle-label">Tablette</span>
          </button>
          <UserButton />
        </div>
      </header>

      <nav className="app-tabs">
        {user && <ProjectTab onBeforeSwitch={guardLeaveCurrentTab} />}
        <button
          type="button"
          className={`app-tab${activeTab === 'conception' ? ' active' : ''}`}
          onClick={() => guardedSetActiveTab('conception')}
          disabled={!!user && !activeProjectId}
          title={!!user && !activeProjectId ? "Sélectionnez ou créez un projet d'abord" : ""}
        >
          Conception 3D
        </button>
        <button
          type="button"
          className={`app-tab${activeTab === 'programmation' ? ' active' : ''}`}
          onClick={() => guardedSetActiveTab('programmation')}
          disabled={!!user && !activeProjectId}
          title={!!user && !activeProjectId ? "Sélectionnez ou créez un projet d'abord" : ""}
        >
          Programmation graphique
        </button>
      </nav>

      <AuthModal open={openModal} onClose={() => setOpenModal(false)} />
      <InstallBanner />
      <Toast />
      <ConfirmDialog />
      <PoseConflictModal />

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
          <TabletServoEditor />
        </>
      )}

      {activeTab === 'programmation' && <ProgramPage />}

      {/* Renderer offscreen partagé : vignettes du séquenceur, de la toolbox Poses,
          et du bloc Init en Programmation graphique. Doit rester monté quel que
          soit l'onglet actif pour pouvoir générer des vignettes à la volée. */}
      <PoseThumbnailRenderer />
    </div>
  );
}
