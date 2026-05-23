import { useHexapodStore } from "../store/useHexapodStore";

export function SimulationPanel() {
  const gravityEnabled = useHexapodStore((s) => s.gravityEnabled);
  const setGravityEnabled = useHexapodStore((s) => s.setGravityEnabled);

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Simulation</h2>
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={gravityEnabled}
          onChange={(e) => setGravityEnabled(e.target.checked)}
        />
        <span>Gravité</span>
        <span className="hint">
          {gravityEnabled
            ? "Le corps s'incline selon les appuis"
            : "Translation simple (pas d'inclinaison)"}
        </span>
      </label>
    </div>
  );
}
