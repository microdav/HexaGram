import { useEffect, useMemo, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { useSerialStore } from "../store/useSerialStore";
import { useHexapodStore } from "../store/useHexapodStore";
import { SERVOS, LEG_NAMES, computeLegMounts } from "../model/hexapod";
import { computeFootTip } from "../model/kinematics";
import { defaultPose, servoIndex } from "../model/pose";
import { defaultBinding, type ServoBinding } from "../model/electronics";
import type { HexapodGeometry } from "../model/hexapod";

const JOINTS = ["coxa", "femur", "tibia"] as const;
type Joint = (typeof JOINTS)[number];

const JOINT_LABEL: Record<Joint, string> = {
  coxa: "Coxa (hanche)",
  femur: "Fémur (cuisse)",
  tibia: "Tibia (jambe)",
};

/** Angle de test envoyé pour la vérification du sens (course confortable, sûre). */
const SENS_DEG = 45;
/** Petit incrément pour sonder la direction du mouvement dans le modèle 3D. */
const PROBE_DEG = 30;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Direction (repère châssis) dans laquelle le bout de patte se déplace, dans le
 * MODÈLE 3D, quand on augmente l'angle logique du servo donné. Sert à formuler
 * une consigne (« vers l'avant », « monte ») qui correspond exactement à la 3D :
 * le but de la calibration est justement de faire coller le robot réel au modèle.
 * Repère : +X = avant, +Z = droite, +Y = haut.
 */
function jointMotion(
  geometry: HexapodGeometry,
  legIndex: number,
  joint: Joint
): { x: number; y: number; z: number } {
  const mount = computeLegMounts(geometry).find((m) => m.index === legIndex);
  if (!mount) return { x: 0, y: 0, z: 0 };
  const idx = servoIndex(legIndex, joint);
  const p0 = defaultPose();
  p0[idx] = 0;
  const p1 = defaultPose();
  p1[idx] = PROBE_DEG;
  const t0 = computeFootTip(mount, p0, geometry);
  const t1 = computeFootTip(mount, p1, geometry);
  return { x: t1.x - t0.x, y: t1.y - t0.y, z: t1.z - t0.z };
}

/** Consigne lisible (+ flèche) attendue dans la 3D pour un mouvement positif. */
function describeExpected(joint: Joint, d: { x: number; y: number; z: number }) {
  if (joint === "coxa") {
    // Coxa = pivot horizontal : on décrit avant/arrière en priorité (cadrage demandé),
    // sinon gauche/droite si le balancement est surtout latéral.
    if (Math.abs(d.x) >= Math.abs(d.z)) {
      return d.x >= 0
        ? { label: "vers l'AVANT du robot", arrow: "↑" }
        : { label: "vers l'ARRIÈRE du robot", arrow: "↓" };
    }
    return d.z >= 0
      ? { label: "vers la DROITE du robot", arrow: "→" }
      : { label: "vers la GAUCHE du robot", arrow: "←" };
  }
  // Fémur / tibia = pivot vertical : le bout de patte monte ou descend.
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
  const [phase, setPhase] = useState<"sens" | "butees">("sens");
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

  const motion = useMemo(
    () => jointMotion(geometry, legIndex, joint),
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
    setPhase("butees");
    setLiveDeg(0);
    if (canMove) void sendServoAngle(servoId, 0);
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

        {/* ── Phase 2 : butées min / max ─────────────────────────────────── */}
        {phase === "butees" && (
          <div className="calib-wiz-body">
            <div className="calib-phase-tag">Étape 2 — Butées min / max</div>
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
              <button type="button" className="btn" onClick={() => setPhase("sens")}>
                ← Revenir au sens
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
