import { useHexapodStore } from '../store/useHexapodStore';
import { usePhotoSpaceStore } from '../store/usePhotoSpaceStore';

export function PhotoSpaceContent() {
  const viewDirection = usePhotoSpaceStore((s) => s.viewDirection);
  const setViewDirection = usePhotoSpaceStore((s) => s.setViewDirection);
  const reset = usePhotoSpaceStore((s) => s.reset);

  const handleUseCurrentView = () => {
    const dir = useHexapodStore.getState().cameraDirection;
    setViewDirection(dir);
  };

  const fmt = (n: number) => n.toFixed(2);

  return (
    <div className="panel">
      <p className="photo-space-hint">
        Toutes les vignettes de pose du séquenceur sont rendues sous cet angle.
      </p>
      <div className="photo-space-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleUseCurrentView}
          title="Fige l'angle des vignettes sur l'orientation actuelle de la caméra principale"
        >
          📷 Utiliser la vue actuelle
        </button>
        <button
          type="button"
          className="btn"
          onClick={reset}
          title="Revenir à l'angle de vue par défaut"
        >
          ↺ Défaut
        </button>
      </div>
      <div className="photo-space-coords">
        <span className="photo-space-coords-label">Direction figée</span>
        <code>[{fmt(viewDirection[0])}, {fmt(viewDirection[1])}, {fmt(viewDirection[2])}]</code>
      </div>
    </div>
  );
}
