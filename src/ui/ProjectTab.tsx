import { useProjectStore } from "../store/useProjectStore";
import { useToolboxStore } from "../store/useToolboxStore";

interface ProjectTabProps {
  /**
   * Garde exécuté avant de quitter l'onglet courant. S'il résout `false`, le
   * changement d'onglet est annulé (ex. modification de pose non enregistrée).
   */
  onBeforeSwitch?: () => Promise<boolean>;
}

export function ProjectTab({ onBeforeSwitch }: ProjectTabProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeTab = useToolboxStore((s) => s.uiPrefs.activeTab ?? 'conception');
  const setActiveTab = useToolboxStore((s) => s.setActiveTab);
  const list = useProjectStore((s) => s.list);

  const isActive = activeTab === 'projet';

  const handleClick = async () => {
    if (activeTab !== 'projet' && onBeforeSwitch && !(await onBeforeSwitch())) return;
    list();
    setActiveTab('projet');
  };

  return (
    <button
      type="button"
      className={`app-tab project-tab${isActive ? ' active' : ''}`}
      onClick={handleClick}
      title="Gestion du projet"
    >
      <span className="project-tab-label">Projet</span>
      <span className="project-tab-name">
        {activeProject?.name ?? <em>— aucun —</em>}
      </span>
    </button>
  );
}
