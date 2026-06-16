import { useMemo } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { useSerialStore } from "../store/useSerialStore";
import { useHexapodStore } from "../store/useHexapodStore";
import { SERVOS } from "../model/hexapod";
import { referencePose } from "../model/pose";
import { protocolForController, GENERIC_ASCII_PROTOCOL } from "../model/electronics";
import { findServoController } from "../model/servoControllers";

const STATUS_LABEL: Record<string, string> = {
  unsupported: "Web Serial non supporté",
  disconnected: "Déconnecté",
  connecting: "Connexion…",
  connected: "Connecté",
  error: "Erreur",
};

/** Durées de transition proposées pour l'envoi d'une pose (ms ; 0 = instantané). */
const DURATIONS = [
  { ms: 0, label: "Instantané" },
  { ms: 250, label: "0,25 s" },
  { ms: 500, label: "0,5 s" },
  { ms: 1000, label: "1 s" },
  { ms: 2000, label: "2 s" },
];

/**
 * Boîte d'outils « Liaison robot » de l'espace Conception 3D : connecte/déconnecte
 * la carte par USB (Web Serial) et envoie la pose 3D courante au robot réel. La
 * connexion est partagée avec l'onglet Électronique (même liaison série).
 */
export function RobotLinkContent() {
  const activeProject = useProjectStore((s) => s.activeProject);

  const status = useSerialStore((s) => s.status);
  const portLabel = useSerialStore((s) => s.portLabel);
  const target = useSerialStore((s) => s.target);
  const errorMsg = useSerialStore((s) => s.errorMsg);
  const errorKind = useSerialStore((s) => s.errorKind);
  const connect = useSerialStore((s) => s.connect);
  const reconnect = useSerialStore((s) => s.reconnect);
  const disconnect = useSerialStore((s) => s.disconnect);
  const releaseAll = useSerialStore((s) => s.releaseAll);
  const sendPose = useSerialStore((s) => s.sendPose);
  const importPoseFromRobot = useSerialStore((s) => s.importPoseFromRobot);
  const transitionMs = useSerialStore((s) => s.transitionMs);
  const setTransitionMs = useSerialStore((s) => s.setTransitionMs);
  const liveMirror = useSerialStore((s) => s.liveMirror);
  const setLiveMirror = useSerialStore((s) => s.setLiveMirror);
  const mirrorOnRelease = useSerialStore((s) => s.mirrorOnRelease);
  const setMirrorOnRelease = useSerialStore((s) => s.setMirrorOnRelease);
  const watchdogEnabled = useSerialStore((s) => s.watchdogEnabled);
  const setWatchdogEnabled = useSerialStore((s) => s.setWatchdogEnabled);

  const pose = useHexapodStore((s) => s.pose);

  const hardware = activeProject?.hardware;
  const electronics = hardware?.electronics ?? null;

  const protocol = useMemo(
    () =>
      target === "command"
        ? GENERIC_ASCII_PROTOCOL
        : protocolForController(hardware?.servoControllerId ?? null),
    [target, hardware?.servoControllerId]
  );

  const controllerLabel = useMemo(() => {
    if (!hardware?.servoControllerId) return null;
    const c = findServoController(hardware.servoControllerId);
    return c ? `${c.brand} ${c.model}` : null;
  }, [hardware?.servoControllerId]);

  const boundCount = useMemo(() => {
    if (!electronics) return 0;
    let n = 0;
    for (let id = 0; id < SERVOS.length; id++) {
      if (electronics.bindings[id]?.channel != null) n++;
    }
    return n;
  }, [electronics]);

  const connected = status === "connected";
  const busy = status === "connecting";
  const unsupported = status === "unsupported";

  return (
    <div className="robotlink">
      <div className="robotlink-status">
        <span className={`robotlink-dot robotlink-dot--${status}`} />
        <div className="robotlink-status-text">
          <div className="robotlink-status-label">{STATUS_LABEL[status] ?? status}</div>
          <div className="robotlink-status-detail">
            {connected
              ? `${controllerLabel ?? (target === "command" ? "Carte de commande" : "Contrôleur")}${
                  portLabel ? ` · ${portLabel}` : ""
                }`
              : controllerLabel ?? "Aucun contrôleur défini"}
          </div>
        </div>
      </div>

      {unsupported && (
        <div className="robotlink-note warn">
          Navigateur sans Web Serial. Utilisez Chrome ou Edge sur ordinateur.
        </div>
      )}
      {errorMsg && (
        <div className="robotlink-note warn">
          {errorKind === "port-lost"
            ? "Port USB perdu — la carte a été débranchée ou réinitialisée. "
            : errorKind === "write-failed"
              ? "Échec d'écriture sur le port. "
              : ""}
          {errorMsg}
        </div>
      )}

      {connected ? (
        <button type="button" className="btn robotlink-btn" onClick={() => void disconnect()}>
          Déconnecter
        </button>
      ) : status === "error" ? (
        <>
          <button
            type="button"
            className="btn btn-primary robotlink-btn"
            disabled={unsupported || busy}
            onClick={() => void reconnect()}
          >
            {busy ? "Reconnexion…" : "↻ Reconnecter"}
          </button>
          <button
            type="button"
            className="btn robotlink-btn"
            disabled={unsupported || busy}
            onClick={() => void connect()}
            title="Choisir un autre port que le précédent"
          >
            Choisir un autre port…
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-primary robotlink-btn"
          disabled={unsupported || busy}
          onClick={() => void connect()}
        >
          {busy ? "Connexion…" : "Connecter le robot (USB)"}
        </button>
      )}

      {connected && (
        <>
          <div className="robotlink-sep" />

          <label className="robotlink-row">
            <span>Transition</span>
            <select
              value={transitionMs}
              onChange={(e) => setTransitionMs(Number(e.target.value))}
            >
              {DURATIONS.map((d) => (
                <option key={d.ms} value={d.ms}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="btn btn-primary robotlink-btn"
            disabled={boundCount === 0}
            onClick={() => void sendPose(pose)}
            title="Envoie les angles de la pose 3D courante au robot"
          >
            ⇪ Envoyer la position actuelle
          </button>

          <button
            type="button"
            className="btn robotlink-btn"
            disabled={boundCount === 0}
            onClick={() => void sendPose(referencePose())}
            title="Pose de référence atteignable : coxa dans l'axe, fémur horizontal, tibia perpendiculaire — pour comparer au modèle"
          >
            ⊹ Pose de référence
          </button>

          <button
            type="button"
            className="btn robotlink-btn"
            disabled={boundCount === 0}
            onClick={() => void importPoseFromRobot()}
            title="Lit la position commandée de chaque servo (QP) et l'applique à la pose 3D — pour vérifier la calibration"
          >
            ⤓ Importer la pose du robot
          </button>

          <div className="robotlink-sep" />

          <label className="robotlink-live">
            <input
              type="checkbox"
              checked={liveMirror}
              disabled={boundCount === 0}
              onChange={(e) => setLiveMirror(e.target.checked)}
            />
            <span>Mode Live (miroir 3D → robot)</span>
            {liveMirror && <span className="robotlink-live-dot" title="Miroir actif" />}
          </label>

          {liveMirror && (
            <label className="robotlink-live robotlink-live-sub">
              <input
                type="checkbox"
                checked={mirrorOnRelease}
                onChange={(e) => setMirrorOnRelease(e.target.checked)}
              />
              <span>Envoyer en fin de mouvement (au relâchement)</span>
            </label>
          )}

          {liveMirror && (
            <label className="robotlink-live robotlink-live-sub">
              <input
                type="checkbox"
                checked={watchdogEnabled}
                onChange={(e) => setWatchdogEnabled(e.target.checked)}
              />
              <span>Watchdog couple-off (coupe après 90 s d'inactivité)</span>
            </label>
          )}

          <div className="robotlink-note">
            {liveMirror && mirrorOnRelease
              ? "La position finale est envoyée au relâchement de la souris (moins de saccades)."
              : "La pose 3D est streamée en continu au robot (~25 Hz, envoi groupé) — peut saccader."}{" "}
            Décochez « Mode Live » ou « Arrêt » pour stopper.
          </div>

          <div className="robotlink-meta">
            {boundCount} / {SERVOS.length} servos câblés · {protocol.label}
          </div>

          <button
            type="button"
            className="btn btn-danger robotlink-btn"
            onClick={() => void releaseAll()}
            title="Coupe le couple de tous les servos"
          >
            ⏻ Arrêt (couple off)
          </button>
        </>
      )}

      {connected && boundCount === 0 && (
        <div className="robotlink-note warn">
          Aucun servo câblé. Affectez les canaux dans Électronique → Liaison &amp; calibration.
        </div>
      )}
    </div>
  );
}
