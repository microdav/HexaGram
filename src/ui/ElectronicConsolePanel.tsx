import { useEffect, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { useSerialStore } from "../store/useSerialStore";
import { protocolForController, GENERIC_ASCII_PROTOCOL } from "../model/electronics";
import { findServoController } from "../model/servoControllers";
import { findCommandElectronics } from "../model/commandElectronics";

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  unsupported: "Web Serial non supporté",
  disconnected: "Déconnecté",
  connecting: "Connexion…",
  connected: "Connecté",
  error: "Erreur",
};

const fmtTime = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const PANEL_W = 640;

/** Position initiale : ancrée en haut à droite, sous la topbar. */
function initialPos() {
  const x = Math.max(16, window.innerWidth - PANEL_W - 24);
  return { x, y: 72 };
}

/**
 * Console électronique transverse — ouverte depuis le bouton « Outils » de la
 * topbar, donc disponible depuis toutes les pages (quitte à faire doublon avec
 * la console bas de l'onglet Électronique). Affiche la carte ciblée et l'état de
 * la liaison, permet de connecter/déconnecter et de couper le couple en urgence,
 * et déroule l'historique des commandes émises/reçues.
 *
 * Panneau **flottant non-modal** : pas de fond bloquant, on continue à piloter
 * l'app pendant qu'il est ouvert ; on le déplace par son en-tête et on le
 * redimensionne par le coin bas-droit.
 *
 * Le log et l'état vivent dans `useSerialStore` (singleton applicatif) : ils
 * persistent toute la session tant que l'onglet n'est pas rechargé, quelle que
 * soit la page affichée — on retrouve donc l'historique à chaque réouverture.
 */
export function ElectronicConsolePanel({ open, onClose }: Props) {
  const activeProject = useProjectStore((s) => s.activeProject);

  const status = useSerialStore((s) => s.status);
  const portLabel = useSerialStore((s) => s.portLabel);
  const target = useSerialStore((s) => s.target);
  const errorMsg = useSerialStore((s) => s.errorMsg);
  const log = useSerialStore((s) => s.log);
  const rxByteCount = useSerialStore((s) => s.rxByteCount);
  const connect = useSerialStore((s) => s.connect);
  const disconnect = useSerialStore((s) => s.disconnect);
  const releaseAll = useSerialStore((s) => s.releaseAll);
  const clearLog = useSerialStore((s) => s.clearLog);
  const queryMoving = useSerialStore((s) => s.queryMoving);
  const queryPulseChannel = useSerialStore((s) => s.queryPulseChannel);
  const sendStop = useSerialStore((s) => s.sendStop);
  const sendRaw = useSerialStore((s) => s.sendRaw);

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

  // Carte sur laquelle le câble USB est branché (cf. ConnTarget).
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

  // Terminateur de ligne selon le protocole (SSC-32U = \r, firmwares custom = \n).
  const term = protocol.id === "ssc32u" ? "\r" : "\n";

  // Barre debug : canal ciblé (Q/QP/STOP) + commande brute libre.
  const [dbgChannel, setDbgChannel] = useState(0);
  const [dbgCmd, setDbgCmd] = useState("");

  // Position du panneau (conservée entre ouvertures : le composant reste monté).
  const [pos, setPos] = useState(initialPos);

  // Déplacement par l'en-tête (drag pointer, listeners au document comme ailleurs).
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".ecm-close")) return; // pas depuis ✕
    e.preventDefault();
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const x = ev.clientX - dragRef.current.dx;
      const y = ev.clientY - dragRef.current.dy;
      // On garde toujours une bande visible à l'écran (pas de panneau perdu).
      const minX = -(PANEL_W - 140);
      const maxX = window.innerWidth - 140;
      const maxY = window.innerHeight - 44;
      setPos({ x: Math.max(minX, Math.min(maxX, x)), y: Math.max(0, Math.min(maxY, y)) });
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  // Auto-scroll vers le bas à chaque nouveau message / à l'ouverture.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log, open]);

  if (!open) return null;

  return (
    <div
      className="ecm-panel"
      // eslint-disable-next-line react/forbid-component-props
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Console électronique"
    >
      {/* En-tête = poignée de déplacement */}
      <div className="ecm-drag" onPointerDown={startDrag}>
        <span className="ecm-title">🔌 Console électronique</span>
        <button type="button" className="ecm-close" onClick={onClose} title="Fermer">
          ✕
        </button>
      </div>

      <div className="ecm-content">
        {/* ── État de la liaison ──────────────────────────────────────── */}
        <div className="ecm-status">
          <span className={`robotlink-dot robotlink-dot--${status}`} />
          <div className="ecm-status-text">
            <div className="robotlink-status-label">{STATUS_LABEL[status] ?? status}</div>
            <div className="robotlink-status-detail">
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
        {errorMsg && <div className="robotlink-note warn">{errorMsg}</div>}

        {/* ── Connexion + arrêt d'urgence ─────────────────────────────── */}
        <div className="ecm-actions">
          {connected ? (
            <button type="button" className="btn" onClick={() => void disconnect()}>
              Déconnecter
            </button>
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
          <button
            type="button"
            className="btn btn-danger ecm-estop"
            disabled={!connected}
            onClick={() => void releaseAll()}
            title="Arrêt d'urgence : coupe le couple de tous les servos câblés"
          >
            ⏻ Arrêt d'urgence (couple off)
          </button>
        </div>

        {/* ── Debug : requêtes carte (Q/QP/STOP) + commande brute ─────── */}
        {connected && (
          <div className="ecm-debug">
            <span className="ecm-debug-label">Canal</span>
            <input
              className="ecm-debug-ch"
              type="number"
              min={0}
              max={31}
              value={dbgChannel}
              aria-label="Canal ciblé"
              title="Canal ciblé par Q / QP / STOP"
              onChange={(e) => setDbgChannel(Math.max(0, Math.min(31, Number(e.target.value) || 0)))}
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void queryMoving()}
              title="Q : un mouvement est-il en cours ? (+ / .)"
            >
              Q
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void queryPulseChannel(dbgChannel)}
              title="QP : lire la largeur d'impulsion (position) du canal"
            >
              QP
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void sendStop(dbgChannel)}
              title="STOP : arrêter le canal à sa position courante"
            >
              STOP
            </button>
            <form
              className="ecm-debug-cmd"
              onSubmit={(e) => {
                e.preventDefault();
                const c = dbgCmd.trim();
                if (c) {
                  void sendRaw(c + term);
                  setDbgCmd("");
                }
              }}
            >
              <input
                type="text"
                value={dbgCmd}
                placeholder="commande brute (ex. #0 P1500 T500)"
                onChange={(e) => setDbgCmd(e.target.value)}
              />
            </form>
          </div>
        )}

        {/* ── Historique des échanges (session) ───────────────────────── */}
        <div className="ecm-console-bar">
          <span className="electro-console-title">
            Émission <span className="ec-tx">→</span> / Réception <span className="ec-rx">←</span>
          </span>
          <span className="electro-console-count">
            {log.length} ligne{log.length > 1 ? "s" : ""} · RX {rxByteCount} octet
            {rxByteCount > 1 ? "s" : ""}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={clearLog}
            disabled={log.length === 0}
            title="Vider la console"
          >
            Clean
          </button>
        </div>

        <div className="ecm-console-body" ref={bodyRef}>
          {log.length === 0 ? (
            <div className="electro-console-empty">
              Aucun échange pour l'instant. Connectez la carte puis bougez un servo (page
              Électronique) : l'historique de la session s'affiche ici depuis n'importe quelle page.
            </div>
          ) : (
            log.map((e, i) => (
              <div key={i} className={`ec-line ec-line--${e.dir}`}>
                <span className="ec-time">{fmtTime(e.t)}</span>
                <span className="ec-arrow">
                  {e.dir === "tx" ? "→" : e.dir === "rx" ? "←" : "•"}
                </span>
                <span className="ec-text">{e.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
