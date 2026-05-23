import { useHexapodStore } from "../store/useHexapodStore";

export function PoseList() {
  const keyframes = useHexapodStore((s) => s.keyframes);
  const capture = useHexapodStore((s) => s.captureKeyframe);
  const apply = useHexapodStore((s) => s.applyKeyframe);
  const remove = useHexapodStore((s) => s.deleteKeyframe);
  const exportJson = useHexapodStore((s) => s.exportKeyframesJson);

  const onExport = () => {
    const json = exportJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hexagram-sequence-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Poses capturées</h2>
        <button className="btn btn-primary" onClick={() => capture()}>
          + Capturer
        </button>
      </div>

      {keyframes.length === 0 && (
        <div className="empty">Aucune pose. Bouge les servos puis clique sur "Capturer".</div>
      )}

      <ul className="pose-list">
        {keyframes.map((k) => (
          <li key={k.id} className="pose-item">
            <button className="pose-name" onClick={() => apply(k.id)} title="Appliquer cette pose">
              {k.name}
            </button>
            <button className="btn btn-icon" onClick={() => remove(k.id)} title="Supprimer">
              ×
            </button>
          </li>
        ))}
      </ul>

      {keyframes.length > 0 && (
        <button className="btn" onClick={onExport} style={{ marginTop: 8 }}>
          Exporter JSON
        </button>
      )}
    </div>
  );
}
