import { useMemo, useState } from "react";
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
  const connect = useSerialStore((s) => s.connect);
  const disconnect = useSerialStore((s) => s.disconnect);
  const releaseAll = useSerialStore((s) => s.releaseAll);
  const sendPose = useSerialStore((s) => s.sendPose);

  const pose = useHexapodStore((s) => s.pose);

  const [durationMs, setDurationMs] = useState(500);

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
      {errorMsg && <div className="robotlink-note warn">{errorMsg}</div>}

      {connected ? (
        <button type="button" className="btn robotlink-btn" onClick={() => void disconnect()}>
          Déconnecter
        </button>
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
              value={durationMs}
              onChange={(e) => setDurationMs(Number(e.target.value))}
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
            onClick={() => void sendPose(pose, durationMs)}
            title="Envoie les angles de la pose 3D courante au robot"
          >
            ⇪ Envoyer la position actuelle
          </button>

          <button
            type="button"
            className="btn robotlink-btn"
            disabled={boundCount === 0}
            onClick={() => void sendPose(referencePose(), durationMs)}
            title="Pose de référence atteignable : coxa dans l'axe, fémur horizontal, tibia perpendiculaire — pour comparer au modèle"
          >
            ⊹ Pose de référence
          </button>

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
