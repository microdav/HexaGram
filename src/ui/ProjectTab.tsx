import { useProjectStore } from "../store/useProjectStore";
import { useToolboxStore } from "../store/useToolboxStore";

export function ProjectTab() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const activeTab = useToolboxStore((s) => s.uiPrefs.activeTab ?? 'conception');
  const setActiveTab = useToolboxStore((s) => s.setActiveTab);
  const list = useProjectStore((s) => s.list);

  const isActive = activeTab === 'projet';

  return (
    <button
      type="button"
      className={`app-tab project-tab${isActive ? ' active' : ''}`}
      onClick={() => {
        list();
        setActiveTab('projet');
      }}
      title="Gestion du projet"
    >
      <span className="project-tab-label">Projet</span>
      <span className="project-tab-name">
        {activeProject?.name ?? <em>— aucun —</em>}
      </span>
    </button>
  );
}
