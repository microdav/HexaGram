import { useMemo, type CSSProperties } from "react";
import { SERVOS, LEG_NAMES } from "../model/hexapod";
import { useHexapodStore } from "../store/useHexapodStore";
import { useBodyTransform } from "../store/useBodyTransform";

const JOINT_LABEL: Record<string, string> = {
  coxa: "Coxa (Y)",
  femur: "Fémur (Z)",
  tibia: "Tibia (Z)",
};

export function ServoPanel() {
  const pose = useHexapodStore((s) => s.pose);
  const setServoAngle = useHexapodStore((s) => s.setServoAngle);
  const resetPose = useHexapodStore((s) => s.resetPose);
  const gravityEnabled = useHexapodStore((s) => s.gravityEnabled);
  const transform = useBodyTransform();

  const contactLegSet = useMemo(
    () => new Set(transform.contacts.map((c) => c.legIndex)),
    [transform.contacts]
  );

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Servos (18)</h2>
        <button type="button" className="btn" onClick={resetPose}>
          Réinitialiser
        </button>
      </div>

      {LEG_NAMES.map((name, legIdx) => (
        <div className="leg-group" key={legIdx}>
          <div className="leg-title">{name}</div>
          {SERVOS.filter((s) => s.legIndex === legIdx).map((s) => {
            const value = pose[s.id];
            const isFemurLocked =
              s.joint === "femur" && gravityEnabled && contactLegSet.has(s.legIndex);

            // Visual locked zone: grey track from minDeg up to (value − 5°),
            // so the thumb at `value` is shown 5° clear of the grey boundary.
            // The slider's min/max attributes stay constant — only the gradient
            // moves with the current value. onChange enforces the strict lock.
            const LOCK_TOL_DEG = 5;
            const lockedEndDeg = Math.max(s.minDeg, value - LOCK_TOL_DEG);
            const lockedPct = isFemurLocked
              ? ((lockedEndDeg - s.minDeg) / (s.maxDeg - s.minDeg)) * 100
              : 0;
            const trackStyle: CSSProperties | undefined = isFemurLocked
              ? ({
                  "--track-bg": `linear-gradient(to right, #3a3a3a 0%, #3a3a3a ${lockedPct}%, var(--bg) ${lockedPct}%, var(--bg) 100%)`,
                } as CSSProperties)
              : undefined;

            return (
              <div className="servo-row" key={s.id}>
                <label className="servo-label">
                  <span>
                    {JOINT_LABEL[s.joint]}
                    {isFemurLocked && (
                      <span
                        className="lock-badge"
                        title="Verrouillé par la gravité (patte en contact) — descente bloquée"
                      >
                        🔒
                      </span>
                    )}
                  </span>
                  <span className="servo-val">{value.toFixed(0)}°</span>
                </label>
                <input
                  type="range"
                  aria-label={`${LEG_NAMES[s.legIndex]} — ${JOINT_LABEL[s.joint]}`}
                  className={isFemurLocked ? "locked" : undefined}
                  style={trackStyle}
                  min={s.minDeg}
                  max={s.maxDeg}
                  step={1}
                  value={value}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (isFemurLocked && v < lockedEndDeg) return;
                    setServoAngle(s.id, v);
                  }}
                />
                <div className="servo-range">
                  <span>{s.minDeg}°</span>
                  <span>{s.maxDeg}°</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
