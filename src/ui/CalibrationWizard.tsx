import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { useSerialStore } from "../store/useSerialStore";
import { useHexapodStore } from "../store/useHexapodStore";
import { SERVOS, LEG_NAMES } from "../model/hexapod";
import { servoIndex, JOINT_REFERENCE_DEG } from "../model/pose";
import { defaultBinding, type ServoBinding } from "../model/electronics";
import { jointFootMotion } from "../model/servoDirection";

const JOINTS = ["coxa", "femur", "tibia"] as const;
type Joint = (typeof JOINTS)[number];

const JOINT_LABEL: Record<Joint, string> = {
  coxa: "Coxa (hanche)",
  femur: "Fémur (cuisse)",
  tibia: "Tibia (jambe)",
};

/** Position physique de référence attendue, par articulation (cf. JOINT_REFERENCE_DEG). */
const ZERO_HINT: Record<Joint, string> = {
  coxa: "La patte doit pointer droit dans son axe (coxa alignée avec l'ancrage du châssis).",
  femur: "Le fémur doit être horizontal, dans le prolongement de la coxa.",
  tibia: "Le tibia doit être perpendiculaire au fémur (pied droit sous le genou) — en général le centre du servo.",
};

/** Angle de test envoyé pour la vérification du sens (course confortable, sûre). */
const SENS_DEG = 45;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Consigne lisible (+ flèche) attendue dans la 3D pour un mouvement positif. */
function describeExpected(joint: Joint, d: { x: number; y: number; z: number }) {
  // Coxa = pivot vertical : balancement avant/arrière de la patte (+X = avant).
  if (joint === "coxa") {
    return d.x >= 0
      ? { label: "vers l'AVANT du robot", arrow: "↑" }
      : { label: "vers l'ARRIÈRE du robot", arrow: "↓" };
  }
  // Fémur / tibia = pivot horizontal : le bout de patte monte ou descend.
  return d.y >= 0
    ? { label: "le bout de patte MONTE (se lève)", arrow: "↑" }
    : { label: "le bout de patte DESCEND (se baisse)", arrow: "↓" };
}

export function CalibrationWizard({ onClose }: { onClose: () => void }) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const updateElectronics = useProjectStore((s) => s.updateElectronics);
  const geometry = useHexapodStore((s) => s.geometry);

  const status = useSerialStore((s) => s.status);
  const sendServoAngle = useSerialStore((s) => s.sendServoAngle);
  const releaseAll = useSerialStore((s) => s.releaseAll);

  const [legIndex, setLegIndex] = useState(0);
  const [jointIdx, setJointIdx] = useState(0);
  const [phase, setPhase] = useState<"sens" | "zero" | "butees">("sens");
  const [played, setPlayed] = useState(false);
  const [verdict, setVerdict] = useState<"pending" | "ok" | "fixed">("pending");
  const [liveDeg, setLiveDeg] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const electronics = activeProject?.hardware.electronics ?? null;
  const connected = status === "connected";

  const joint = JOINTS[jointIdx];
  const servoId = servoIndex(legIndex, joint);
  const servoDef = SERVOS[servoId];
  const binding = electronics?.bindings[servoId] ?? defaultBinding(servoId);
  const channel = binding.channel;
  const wired = channel != null;
  const stepNo = legIndex * 3 + jointIdx + 1;
  // Angle modèle où le repère physique est identifiable (tibia = −90° perpendiculaire).
  const refDeg = JOINT_REFERENCE_DEG[joint];

  const motion = useMemo(
    () => jointFootMotion(geometry, legIndex, joint),
    [geometry, legIndex, joint]
  );
  const expected = describeExpected(joint, motion);

  const canMove = connected && wired && !busy;

  // Met à jour une seule liaison en conservant toutes les autres.
  async function patch(partial: Partial<ServoBinding>) {
    const next: Record<number, ServoBinding> = {};
    for (let id = 0; id < SERVOS.length; id++) {
      const cur = electronics?.bindings[id] ?? defaultBinding(id);
      next[id] = id === servoId ? { ...cur, ...partial } : { ...cur };
    }
    await updateElectronics({ bindings: next });
  }

  // Passe à un servo donné : remet l'assistant en phase « sens », au repos.
  function goToServo(newLeg: number, newJoint: number) {
    setLegIndex(Math.max(0, Math.min(5, newLeg)));
    setJointIdx(Math.max(0, Math.min(2, newJoint)));
    setPhase("sens");
    setPlayed(false);
    setVerdict("pending");
    setLiveDeg(0);
    setBusy(false);
  }

  function next() {
    const cur = legIndex * 3 + jointIdx;
    if (cur >= 17) {
      setDone(true);
      return;
    }
    goToServo(Math.floor((cur + 1) / 3), (cur + 1) % 3);
  }

  function prev() {
    const cur = legIndex * 3 + jointIdx;
    if (cur <= 0) return;
    goToServo(Math.floor((cur - 1) / 3), (cur - 1) % 3);
  }

  // Envoie 0° puis +45° pour observer le sens réel du servo.
  async function playSens() {
    if (!connected || !wired) return;
    setBusy(true);
    try {
      await sendServoAngle(servoId, 0);
      await sleep(550);
      await sendServoAngle(servoId, SENS_DEG);
      setPlayed(true);
    } finally {
      setBusy(false);
    }
  }

  // « Non, il a tourné dans l'autre sens » : inverse puis rejoue pour vérifier.
  async function flipAndReplay() {
    setBusy(true);
    try {
      await patch({ invert: !binding.invert });
      await sendServoAngle(servoId, 0);
      await sleep(550);
      await sendServoAngle(servoId, SENS_DEG);
      setVerdict("fixed");
      setPlayed(true);
    } finally {
      setBusy(false);
    }
  }

  function acceptSens() {
    setVerdict(verdict === "fixed" ? "fixed" : "ok");
    setPhase("zero");
    if (canMove) void sendServoAngle(servoId, refDeg);
  }

  // Phase zéro : ajuste l'offset (le servo reste sur son angle de référence pour
  // voir l'effet en direct — perpendiculaire pour le tibia, etc.).
  async function adjustOffset(delta: number) {
    await patch({ centerOffsetDeg: +(binding.centerOffsetDeg + delta).toFixed(1) });
    if (connected && wired) await sendServoAngle(servoId, refDeg);
  }

  // Phase butées : amène le servo à un angle puis capture min/max.
  async function jog(v: number) {
    const clamped = Math.max(-90, Math.min(90, Math.round(v)));
    setLiveDeg(clamped);
    if (connected && wired) await sendServoAngle(servoId, clamped);
  }

  // Sécurité : couple coupé quand on ferme l'assistant (servos relâchés).
  useEffect(() => {
    return () => {
      if (useSerialStore.getState().status === "connected") void releaseAll();
    };
  }, [releaseAll]);

  if (!activeProject) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal calib-wiz" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} title="Fermer">
          ✕
        </button>

        <h2 className="calib-wiz-title">
          🧭 Assistant de calibration
          <span className="calib-wiz-step">Servo {stepNo} / 18</span>
        </h2>

        {/* ── Sélecteur de patte ─────────────────────────────────────────── */}
        <div className="calib-wiz-legs">
          {LEG_NAMES.map((name, i) => (
            <button
              type="button"
              key={i}
              className={`calib-leg-chip${i === legIndex ? " active" : ""}`}
              onClick={() => goToServo(i, 0)}
            >
              {name}
            </button>
          ))}
        </div>

        {/* ── En-tête du servo courant ───────────────────────────────────── */}
        <div className="calib-wiz-servo">
          <div className="calib-wiz-servo-id">
            <strong>{LEG_NAMES[legIndex]}</strong> · {JOINT_LABEL[joint]}
          </div>
          <div className="calib-wiz-servo-meta">
            {wired ? (
              <>Canal {channel}</>
            ) : (
              <span className="calib-warn">⚠ Non câblé</span>
            )}
            {" · "}Sens {binding.invert ? "inversé" : "normal"}
          </div>
        </div>

        {!connected && (
          <div className="calib-wiz-banner warn">
            Carte non connectée — connectez-la dans l'onglet Électronique pour piloter les servos.
          </div>
        )}
        {connected && !wired && (
          <div className="calib-wiz-banner warn">
            Ce servo n'a pas de canal assigné. Affectez-le dans « Liaison &amp; calibration », ou
            passez au suivant.
          </div>
        )}

        {/* ── Phase 1 : sens de rotation ─────────────────────────────────── */}
        {phase === "sens" && (
          <div className="calib-wiz-body">
            <div className="calib-phase-tag">Étape 1 — Sens de rotation</div>
            <p className="calib-wiz-expect">
              Le servo va passer de <strong>0°</strong> à <strong>+{SENS_DEG}°</strong>. Dans le
              modèle, le mouvement attendu est&nbsp;:
              <span className="calib-expect-dir">
                <span className="calib-expect-arrow">{expected.arrow}</span> {expected.label}
              </span>
            </p>

            <div className="calib-wiz-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canMove}
                onClick={() => void playSens()}
              >
                {busy ? "…" : played ? "↻ Rejouer le mouvement" : "▶ Lancer le mouvement"}
              </button>
            </div>

            {played && (
              <>
                <p className="calib-wiz-question">
                  Sur le robot réel, le bout de patte est-il bien allé <em>{expected.label}</em>&nbsp;?
                </p>
                <div className="calib-wiz-actions">
                  <button
                    type="button"
                    className="btn btn-ok"
                    disabled={busy}
                    onClick={acceptSens}
                  >
                    ✓ Oui, c'est ce sens
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!canMove}
                    onClick={() => void flipAndReplay()}
                  >
                    ✗ Non, l'inverse → inverser
                  </button>
                </div>
                {verdict === "fixed" && (
                  <div className="calib-wiz-banner ok">
                    Sens inversé ✓ — le mouvement vient d'être rejoué. Vérifiez qu'il va maintenant{" "}
                    {expected.label}, puis confirmez « Oui ».
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Phase 2 : zéro mécanique (offset) ──────────────────────────── */}
        {phase === "zero" && (
          <div className="calib-wiz-body">
            <div className="calib-phase-tag">Étape 2 — Zéro mécanique</div>
            <p className="calib-wiz-hint">
              Repère ({refDeg}°). {ZERO_HINT[joint]} Ajustez l'offset jusqu'à ce que le segment
              atteigne ce repère sur le robot. Tenez la patte en l'air, sans charge.
              <br />
              💡 Si le palonnier est monté à un quart de tour (cas du tibia perpendiculaire),
              utilisez <strong>±90°</strong> pour le ramener au repère, puis affinez.
            </p>

            <div className="calib-wiz-actions">
              <button
                type="button"
                className="btn"
                disabled={!canMove}
                onClick={() => void sendServoAngle(servoId, refDeg)}
              >
                Aller au repère ({refDeg}°)
              </button>
            </div>

            {/* Offset grossier : rattrape un montage à un quart de tour. */}
            <div className="calib-jog">
              <button type="button" className="btn btn-sm" onClick={() => void adjustOffset(-90)}>
                −90° ¼t
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void adjustOffset(90)}>
                +90° ¼t
              </button>
              <span className="calib-jog-val">{binding.centerOffsetDeg.toFixed(1)}°</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void patch({ centerOffsetDeg: 0 })}
                title="Remettre l'offset à 0"
              >
                RAZ
              </button>
            </div>

            {/* Offset fin : affine l'alignement. */}
            <div className="calib-jog">
              <button type="button" className="btn btn-sm" onClick={() => void adjustOffset(-5)}>
                −5°
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void adjustOffset(-0.5)}>
                −0,5°
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void adjustOffset(0.5)}>
                +0,5°
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void adjustOffset(5)}>
                +5°
              </button>
            </div>

            <div className="calib-wiz-actions calib-wiz-nav-inline">
              <button type="button" className="btn" onClick={() => setPhase("sens")}>
                ← Revenir au sens
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setPhase("butees");
                  setLiveDeg(refDeg);
                  if (canMove) void sendServoAngle(servoId, refDeg);
                }}
              >
                Butées →
              </button>
            </div>
          </div>
        )}

        {/* ── Phase 3 : butées min / max ─────────────────────────────────── */}
        {phase === "butees" && (
          <div className="calib-wiz-body">
            <div className="calib-phase-tag">Étape 3 — Butées min / max</div>
            <p className="calib-wiz-hint">
              Amenez doucement le servo jusqu'à sa limite mécanique <strong>sûre</strong> (sans
              forcer ni toucher le sol/châssis), puis enregistrez-la comme min ou max.
            </p>

            <div className="calib-jog">
              <button
                type="button"
                className="btn btn-sm"
                disabled={!canMove}
                onClick={() => void jog(liveDeg - 5)}
              >
                −5°
              </button>
              <input
                type="range"
                min={servoDef.minDeg}
                max={servoDef.maxDeg}
                step={1}
                value={liveDeg}
                disabled={!canMove}
                onChange={(e) => void jog(Number(e.target.value))}
                aria-label="Position de test"
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={!canMove}
                onClick={() => void jog(liveDeg + 5)}
              >
                +5°
              </button>
              <span className="calib-jog-val">{liveDeg}°</span>
            </div>

            <div className="calib-wiz-actions">
              <button
                type="button"
                className="btn"
                disabled={!connected}
                onClick={() => void jog(0)}
              >
                Centrer (0°)
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void patch({ minDeg: Math.min(liveDeg, binding.maxDeg ?? 90) })}
              >
                ⤓ Définir min ici
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void patch({ maxDeg: Math.max(liveDeg, binding.minDeg ?? -90) })}
              >
                ⤒ Définir max ici
              </button>
            </div>

            <div className="calib-limits">
              <span>
                Min&nbsp;:{" "}
                <strong>{binding.minDeg != null ? `${binding.minDeg}°` : "—"}</strong>
              </span>
              <span>
                Max&nbsp;:{" "}
                <strong>{binding.maxDeg != null ? `${binding.maxDeg}°` : "—"}</strong>
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void patch({ minDeg: null, maxDeg: null })}
                title="Effacer les butées (revenir à la plage du modèle)"
              >
                Effacer
              </button>
            </div>

            <div className="calib-wiz-actions calib-wiz-nav-inline">
              <button type="button" className="btn" onClick={() => setPhase("zero")}>
                ← Revenir au zéro
              </button>
            </div>
          </div>
        )}

        {/* ── Pied : navigation + sécurité ───────────────────────────────── */}
        <div className="calib-wiz-footer">
          <div className="calib-wiz-nav">
            <button type="button" className="btn" disabled={stepNo <= 1} onClick={prev}>
              ‹ Précédent
            </button>
            {wired ? (
              <button type="button" className="btn btn-primary" onClick={next}>
                {stepNo >= 18 ? "Terminer" : "Servo suivant ›"}
              </button>
            ) : (
              <button type="button" className="btn" onClick={next}>
                Passer ›
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!connected}
            onClick={() => void releaseAll()}
            title="Coupe le couple de tous les servos"
          >
            ⏻ Couple OFF
          </button>
        </div>

        {done && (
          <div className="calib-wiz-done">
            <div className="calib-wiz-banner ok">
              Calibration parcourue pour les 18 servos. Les réglages sont enregistrés
              automatiquement.
            </div>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Fermer l'assistant
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
