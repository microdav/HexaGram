import { useEffect, useRef, useState } from "react";
import { useLinkStore } from "../store/useLinkStore";
import { useAuthStore } from "../store/useAuthStore";

/**
 * Indicateur « Écran lié » du bandeau (à côté de la liaison robot). Pastille
 * cliquable + popover : activation du mode, nom de l'appareil, état de la
 * liaison, qui pilote, et prise/reprise du contrôle.
 */
export function LinkedScreenBadge() {
  const enabled = useLinkStore((s) => s.enabled);
  const status = useLinkStore((s) => s.status);
  const deviceId = useLinkStore((s) => s.deviceId);
  const deviceName = useLinkStore((s) => s.deviceName);
  const devices = useLinkStore((s) => s.devices);
  const controlHolderId = useLinkStore((s) => s.controlHolderId);
  const hostId = useLinkStore((s) => s.hostId);
  const requestPending = useLinkStore((s) => s.requestPending);
  const setEnabled = useLinkStore((s) => s.setEnabled);
  const setDeviceName = useLinkStore((s) => s.setDeviceName);
  const requestControl = useLinkStore((s) => s.requestControl);
  const revokeControl = useLinkStore((s) => s.revokeControl);

  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(deviceName);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setNameDraft(deviceName), [deviceName]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Le mode écran lié nécessite un compte connecté (pas en mode démo).
  if (!user) return null;

  const connected = status === "connected";
  const amController = connected && controlHolderId === deviceId;
  const gatekeeper = hostId ?? controlHolderId;
  const amGatekeeper = gatekeeper === deviceId;
  const others = devices.filter((d) => d.id !== deviceId);
  const holder = devices.find((d) => d.id === controlHolderId);

  // Pastille : état visuel synthétique.
  const variant = !enabled
    ? "off"
    : status === "connecting"
      ? "connecting"
      : !connected
        ? "offline"
        : amController
          ? "pilot"
          : "follower";
  const label = !enabled
    ? "Écran lié"
    : amController
      ? "Pilote"
      : connected
        ? "Lié"
        : "Écran lié";

  const commitName = () => {
    if (nameDraft.trim() && nameDraft.trim() !== deviceName) setDeviceName(nameDraft);
    else setNameDraft(deviceName);
  };

  return (
    <div className="lsb" ref={ref}>
      <button
        type="button"
        className={`lsb-status lsb-status--${variant}${open ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        title="Écran lié — pilotage partagé entre appareils du compte"
      >
        <span className={`lsb-dot lsb-dot--${variant}`} />
        <span className="lsb-status-label">{label}</span>
        {enabled && connected && others.length > 0 && (
          <span className="lsb-count">{devices.length}</span>
        )}
        <span className="rlb-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="rlb-popover lsb-popover">
          <label className="lsb-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Activer l'écran lié</span>
          </label>
          <p className="lsb-hint">
            Synchronise la pose 3D entre les appareils de votre compte. Le robot ne bouge que si
            l'hôte branché en USB a activé le Mode Live.
          </p>

          <label className="rlb-field">
            <span>Nom de cet appareil</span>
            <input
              type="text"
              value={nameDraft}
              maxLength={40}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </label>

          {enabled && (
            <>
              <div className="lsb-state">
                <span className={`lsb-dot lsb-dot--${variant}`} />
                <span>
                  {status === "connecting"
                    ? "Connexion…"
                    : !connected
                      ? "Hors ligne"
                      : amController
                        ? "Vous pilotez le robot"
                        : holder
                          ? `Piloté par ${holder.name}`
                          : "Aucun pilote"}
                </span>
              </div>

              {connected && !amController && !amGatekeeper && (
                <button
                  type="button"
                  className="btn btn-primary lsb-action"
                  disabled={requestPending}
                  onClick={requestControl}
                >
                  {requestPending ? "Demande envoyée…" : "Prendre le contrôle"}
                </button>
              )}
              {connected && !amController && amGatekeeper && (
                <button type="button" className="btn btn-primary lsb-action" onClick={revokeControl}>
                  Reprendre le contrôle
                </button>
              )}

              {connected && (
                <div className="lsb-devices">
                  <div className="lsb-devices-title">Appareils en ligne</div>
                  {others.length === 0 ? (
                    <div className="lsb-devices-empty">Aucun autre appareil connecté.</div>
                  ) : (
                    others.map((d) => (
                      <div key={d.id} className="lsb-device">
                        <span className="lsb-device-name">{d.name}</span>
                        <span className="lsb-device-tags">
                          {d.id === controlHolderId && <span className="lsb-tag lsb-tag--pilot">pilote</span>}
                          {d.usbConnected && <span className="lsb-tag lsb-tag--usb">USB</span>}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
