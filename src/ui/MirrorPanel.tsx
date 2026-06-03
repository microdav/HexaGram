import { useHexapodStore } from "../store/useHexapodStore";

export function MirrorPanel() {
  const mirrorEnabled = useHexapodStore((s) => s.mirrorEnabled);
  const setMirrorEnabled = useHexapodStore((s) => s.setMirrorEnabled);
  const bodyTransparent = useHexapodStore((s) => s.bodyTransparent);
  const setBodyTransparent = useHexapodStore((s) => s.setBodyTransparent);

  return (
    <div className="panel">
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={mirrorEnabled}
          onChange={(e) => setMirrorEnabled(e.target.checked)}
        />
        <span>Miroir gauche/droite</span>
        <span className="hint">
          {mirrorEnabled
            ? "Les servos symétriques sont liés"
            : "Réglage indépendant de chaque patte"}
        </span>
      </label>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={bodyTransparent}
          onChange={(e) => setBodyTransparent(e.target.checked)}
        />
        <span>Corps transparent</span>
        <span className="hint">
          {bodyTransparent
            ? "On voit le CoG à travers le châssis"
            : "Châssis opaque"}
        </span>
      </label>
    </div>
  );
}
