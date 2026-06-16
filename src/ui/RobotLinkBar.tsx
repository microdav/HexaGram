import { useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { useSerialStore, type ConnTarget } from "../store/useSerialStore";
import {
  COMMON_BAUD_RATES,
  protocolForController,
  GENERIC_ASCII_PROTOCOL,
} from "../model/electronics";
import { findServoController } from "../model/servoControllers";
import { findCommandElectronics } from "../model/commandElectronics";
import { ElectronicConsolePanel } from "./ElectronicConsolePanel";

const STATUS_LABEL: Record<string, string> = {
  unsupported: "Web Serial non supporté",
  disconnected: "Déconnecté",
  connecting: "Connexion…",
  connected: "Connecté",
  error: "Erreur",
};

/**
 * Widget « Liaison robot » du bandeau du haut. Point de connexion CENTRAL de
 * l'application (USB → contrôleur ou carte de commande) : pastille d'état,
 * options de connexion (cible USB + vitesse) dans un menu déroulant, et — quand
 * la carte est connectée — l'**Arrêt** (fige les servos) et l'**Arrêt d'urgence**
 * (couple off), toujours à portée de main. La console électronique s'ouvre aussi
 * d'ici (épinglée en déroulé sous le bandeau, ou flottante).
 *
 * Affiché partout sauf l'onglet Projet — mais réaffiché sur Projet dès que la
 * carte est connectée, pour que l'arrêt d'urgence reste accessible (cf. App.tsx).
 */
export function RobotLinkBar() {
  const activeProject = useProjectStore((s) => s.activeProject);

  const status = useSerialStore((s) => s.status);
  const portLabel = useSerialStore((s) => s.portLabel);
  const baudRate = useSerialStore((s) => s.baudRate);
  const setBaudRate = useSerialStore((s) => s.setBaudRate);
  const target = useSerialStore((s) => s.target);
  const setTarget = useSerialStore((s) => s.setTarget);
  const errorMsg = useSerialStore((s) => s.errorMsg);
  const errorKind = useSerialStore((s) => s.errorKind);
  const connect = useSerialStore((s) => s.connect);
  const reconnect = useSerialStore((s) => s.reconnect);
  const disconnect = useSerialStore((s) => s.disconnect);
  const releaseAll = useSerialStore((s) => s.releaseAll);
  const stopAll = useSerialStore((s) => s.stopAll);
  const globalConsoleOpen = useSerialStore((s) => s.globalConsoleOpen);
  const setGlobalConsoleOpen = useSerialStore((s) => s.setGlobalConsoleOpen);

  const hardware = activeProject?.hardware;

  const controller = useMemo(
    () => (hardware?.servoControllerId ? findServoController(hardware.servoControllerId) ?? null : null),
    [hardware?.servoControllerId]
  );
  const board = useMemo(
    () => (hardware?.commandElectronicsId ? findCommandElectronics(hardware.commandElectronicsId) ?? null : null),
    [hardware?.commandElectronicsId]
  );
  const protocol = useMemo(
    () =>
      target === "command"
        ? GENERIC_ASCII_PROTOCOL
        : protocolForController(hardware?.servoControllerId ?? null),
    [target, hardware?.servoControllerId]
  );

  const hasController = !!hardware?.servoControllerId;
  const hasCommand = !!hardware?.commandElectronicsId;
  const targetLabel =
    target === "command"
      ? board
        ? `${board.brand} ${board.model}`
        : "Carte de commande"
      : controller
        ? `${controller.brand} ${controller.model} (direct)`
        : "Contrôleur (direct)";

  const connected = status === "connected";
  const busy = status === "connecting";
  const unsupported = status === "unsupported";
  const isSsc = hardware?.servoControllerId === "lynxmotion-ssc-32u";

  // Menu déroulant des options de connexion (cible USB + vitesse + connecter).
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div className="robotlinkbar" ref={ref}>
      {/* Pastille d'état + accès aux options de connexion */}
      <button
        type="button"
        className={`rlb-status rlb-status--${status}${menuOpen ? " active" : ""}`}
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen ? "true" : "false"}
        title="Liaison robot — options de connexion"
      >
        <span className={`robotlink-dot robotlink-dot--${status}`} />
        <span className="rlb-status-label">
          {connected ? portLabel ?? "Connecté" : STATUS_LABEL[status] ?? status}
        </span>
        <span className="rlb-caret" aria-hidden="true">▾</span>
      </button>

      {/* Arrêt + Arrêt d'urgence — visibles dès que la carte est connectée */}
      {connected && (
        <>
          <button
            type="button"
            className="btn btn-sm rlb-stop"
            onClick={() => void stopAll()}
            title="Arrêt : fige les servos à leur position (coupe le Mode Live, couple maintenu)"
          >
            ⏹ Arrêt
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger rlb-estop"
            onClick={() => void releaseAll()}
            title="Arrêt d'urgence : coupe le couple de tous les servos"
          >
            ⏻ Urgence
          </button>
        </>
      )}

      {/* Console électronique (depuis le bandeau) */}
      <button
        type="button"
        className={`btn btn-sm rlb-console${globalConsoleOpen ? " active" : ""}`}
        onClick={() => {
          setMenuOpen(false);
          setGlobalConsoleOpen(!globalConsoleOpen);
        }}
        title="Console électronique (commandes émises / reçues)"
      >
        🔌 Console
      </button>

      {/* Menu déroulant : options de connexion */}
      {menuOpen && (
        <div className="rlb-popover">
          <div className="rlb-pop-status">
            <span className={`robotlink-dot robotlink-dot--${status}`} />
            <div>
              <div className="rlb-pop-status-label">{STATUS_LABEL[status] ?? status}</div>
              <div className="rlb-pop-status-detail">
                {connected
                  ? `${targetLabel}${portLabel ? ` · ${portLabel}` : ""} · ${protocol.label}`
                  : targetLabel}
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

          {!connected && (hasController || hasCommand) && (
            <label className="rlb-field">
              <span>Cible USB</span>
              <select
                value={hasCommand && !hasController ? "command" : target}
                disabled={busy}
                onChange={(e) => setTarget(e.target.value as ConnTarget)}
              >
                {hasController && (
                  <option value="controller">
                    {controller ? `${controller.model} (direct)` : "Contrôleur (direct)"}
                  </option>
                )}
                {hasCommand && (
                  <option value="command">{board ? board.model : "Carte de commande"}</option>
                )}
              </select>
            </label>
          )}

          <label className="rlb-field">
            <span>Vitesse</span>
            <select
              value={baudRate}
              disabled={connected || busy}
              onChange={(e) => setBaudRate(Number(e.target.value))}
            >
              {COMMON_BAUD_RATES.map((b) => (
                <option key={b} value={b}>
                  {b} bauds{isSsc && b === 9600 ? " (défaut SSC-32U)" : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="rlb-pop-actions">
            {connected ? (
              <button type="button" className="btn" onClick={() => void disconnect()}>
                Déconnecter
              </button>
            ) : status === "error" ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={unsupported || busy}
                  onClick={() => void reconnect()}
                >
                  {busy ? "Reconnexion…" : "↻ Reconnecter"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={unsupported || busy}
                  onClick={() => void connect()}
                  title="Choisir un autre port que le précédent"
                >
                  Autre port…
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={unsupported || busy}
                onClick={() => void connect()}
              >
                {busy ? "Connexion…" : "Connecter (USB)"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Console (épinglée en déroulé sous le bandeau, ou flottante) — pilotée par le store. */}
      <ElectronicConsolePanel />
    </div>
  );
}
