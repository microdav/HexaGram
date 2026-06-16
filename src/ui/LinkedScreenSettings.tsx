import { useEffect, useState } from "react";
import { useProjectStore, type LinkedDeviceRef } from "../store/useProjectStore";
import { useLinkStore } from "../store/useLinkStore";

/**
 * Onglet « Écran lié » des paramètres projet : liste les appareils (en ligne ∪
 * déjà autorisés) et permet d'activer, par appareil, la **prise de contrôle sans
 * demande**. Les appareils ainsi cochés pilotent le robot sans popup de demande.
 *
 * Enregistrement automatique (chaque bascule persiste `preferences.linkedScreen.autoGrant`).
 */
export function LinkedScreenSettings({
  projectId,
  initialAutoGrant,
}: {
  projectId: string;
  initialAutoGrant: LinkedDeviceRef[];
}) {
  const updatePreferences = useProjectStore((s) => s.updatePreferences);
  const onlineDevices = useLinkStore((s) => s.devices);
  const myDeviceId = useLinkStore((s) => s.deviceId);
  const linkEnabled = useLinkStore((s) => s.enabled);
  const linkStatus = useLinkStore((s) => s.status);

  const [autoGrant, setAutoGrant] = useState<LinkedDeviceRef[]>(initialAutoGrant);

  useEffect(() => setAutoGrant(initialAutoGrant), [initialAutoGrant, projectId]);

  const save = (next: LinkedDeviceRef[]) => {
    setAutoGrant(next);
    updatePreferences({ linkedScreen: { autoGrant: next } }).catch(() => {});
  };

  const toggle = (id: string, name: string) => {
    if (autoGrant.some((g) => g.id === id)) save(autoGrant.filter((g) => g.id !== id));
    else save([...autoGrant, { id, name }]);
  };

  // Union des appareils connus : en ligne (présence WebSocket) ∪ déjà autorisés.
  const known = new Map<string, { id: string; name: string; online: boolean }>();
  for (const d of onlineDevices) known.set(d.id, { id: d.id, name: d.name, online: true });
  for (const g of autoGrant) {
    if (!known.has(g.id)) known.set(g.id, { id: g.id, name: g.name, online: false });
  }
  const rows = [...known.values()];

  return (
    <div className="pp-section">
      <p className="pp-hint">
        Le mode « écran lié » permet à un autre appareil de votre compte de piloter le robot à
        distance ; ses mouvements sont reproduits sur l'appareil branché en USB (et envoyés au robot
        si son Mode Live est actif). Cochez un appareil pour l'autoriser à <strong>prendre le
        contrôle sans demande</strong>. Enregistrement automatique.
      </p>

      {!linkEnabled && (
        <div className="pp-empty">
          L'écran lié n'est pas activé sur cet appareil. Activez-le dans le bandeau « Écran lié » en
          haut pour voir les autres appareils en ligne.
        </div>
      )}

      {rows.length === 0 ? (
        <div className="pp-empty">
          {linkStatus === "connected"
            ? "Aucun appareil connu pour l'instant."
            : "Aucun appareil en ligne. Connectez-vous depuis un autre poste pour le voir apparaître."}
        </div>
      ) : (
        <div className="lss-list">
          {rows.map((d) => {
            const allowed = autoGrant.some((g) => g.id === d.id);
            const isSelf = d.id === myDeviceId;
            return (
              <div key={d.id} className="lss-row">
                <span className={`lss-dot${d.online ? " online" : ""}`} title={d.online ? "En ligne" : "Hors ligne"} />
                <span className="lss-name">
                  {d.name}
                  {isSelf && <span className="lss-self"> (cet appareil)</span>}
                </span>
                <label className="lss-toggle" title="Prise de contrôle sans demande">
                  <input type="checkbox" checked={allowed} onChange={() => toggle(d.id, d.name)} />
                  <span>Sans demande</span>
                </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
