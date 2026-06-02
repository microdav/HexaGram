import { LEG_NAMES } from "../../model/hexapod";
import { useRobot2DStore } from "../../store/useRobot2DStore";
import { useRobot2DHistory } from "../../store/useRobot2DHistory";

export function Robot2DLeftPanel() {
  const selected = useRobot2DStore((s) => s.selected);
  const select = useRobot2DStore((s) => s.select);

  const entries = useRobot2DHistory((s) => s.entries);
  const index = useRobot2DHistory((s) => s.index);
  const jumpTo = useRobot2DHistory((s) => s.jumpTo);

  const chassisActive = selected?.type === "chassis";

  return (
    <div className="panel r2d-left-panel">
      <div className="r2d-panel-title">Éléments</div>

      <button
        type="button"
        className={`r2d-elem-btn${chassisActive ? " active" : ""}`}
        onClick={() => select({ type: "chassis" })}
      >
        <span className="r2d-elem-icon" aria-hidden="true">▭</span>
        Châssis
      </button>

      <div className="r2d-panel-subtitle">Pattes</div>
      <ul className="r2d-leg-list">
        {LEG_NAMES.map((name, index) => {
          const active = selected?.type === "leg" && selected.index === index;
          return (
            <li key={index}>
              <button
                type="button"
                className={`r2d-elem-btn${active ? " active" : ""}`}
                onClick={() => select({ type: "leg", index })}
              >
                <span className="r2d-leg-badge">{index}</span>
                {name}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="r2d-panel-subtitle">Historique</div>
      <ul className="r2d-history-list">
        {entries.length === 0 && <li className="r2d-history-empty">—</li>}
        {entries.map((e, i) => (
          <li key={i}>
            <button
              type="button"
              className={`r2d-history-item${i === index ? " current" : ""}${i > index ? " future" : ""}`}
              onClick={() => jumpTo(i)}
              title={i === index ? "État courant" : "Revenir à cet état"}
            >
              <span className="r2d-history-dot" aria-hidden="true" />
              {e.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
