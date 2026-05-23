import { useHexapodStore } from "../store/useHexapodStore";

export function MirrorPanel() {
  const mirrorEnabled = useHexapodStore((s) => s.mirrorEnabled);
  const setMirrorEnabled = useHexapodStore((s) => s.setMirrorEnabled);

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
    </div>
  );
}
