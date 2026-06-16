import { useLinkStore } from "../store/useLinkStore";
import { useProjectStore } from "../store/useProjectStore";

/**
 * Popup affichée au **gardien** (hôte USB) lorsqu'un autre appareil demande la
 * prise de contrôle du robot. À monter une seule fois en haut de l'App — elle
 * s'affiche quel que soit l'onglet, pour que la demande ne soit jamais manquée.
 *
 * Trois issues : refuser, accepter une fois, ou accepter + mémoriser l'appareil
 * dans les autorisations du projet (prises de contrôle suivantes sans demande).
 */
export function ControlRequestModal() {
  const pending = useLinkStore((s) => s.pendingRequest);
  const grantControl = useLinkStore((s) => s.grantControl);
  const denyControl = useLinkStore((s) => s.denyControl);
  const activeProject = useProjectStore((s) => s.activeProject);
  const updatePreferences = useProjectStore((s) => s.updatePreferences);

  if (!pending) return null;
  const { fromDeviceId, fromName } = pending;

  const alwaysAllow = () => {
    grantControl(fromDeviceId);
    const current = activeProject?.preferences.linkedScreen?.autoGrant ?? [];
    if (!current.some((d) => d.id === fromDeviceId)) {
      updatePreferences({
        linkedScreen: { autoGrant: [...current, { id: fromDeviceId, name: fromName }] },
      }).catch(() => {});
    }
  };

  return (
    <div className="confirm-dialog-backdrop" onClick={() => denyControl(fromDeviceId)}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-dialog-title">Demande de prise de contrôle</div>
        <div className="confirm-dialog-body">
          <p>
            <strong>{fromName}</strong> demande à piloter le robot à distance (écran lié).
          </p>
          <p>Pendant ce temps, cet appareil suivra ses mouvements et les relaiera au robot.</p>
        </div>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn"
            onClick={() => denyControl(fromDeviceId)}
          >
            Refuser
          </button>
          {activeProject && (
            <button type="button" className="confirm-dialog-btn" onClick={alwaysAllow}>
              Toujours autoriser
            </button>
          )}
          <button
            type="button"
            className="confirm-dialog-btn confirm-dialog-btn-primary"
            onClick={() => grantControl(fromDeviceId)}
          >
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
}
