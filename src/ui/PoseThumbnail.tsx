import { useEffect, useMemo } from 'react';
import type { SequencerStep } from '../store/useSequencerStore';
import { usePoseThumbnailStore, hashPose } from '../store/usePoseThumbnailStore';

interface PoseThumbnailProps {
  step: SequencerStep;
}

/**
 * Vignette PNG d'une pose. Demande la génération si nécessaire et affiche
 * l'image dès qu'elle est disponible. La taille d'affichage est gérée en CSS
 * (.pose-thumb).
 */
export function PoseThumbnail({ step }: PoseThumbnailProps) {
  const poseHash = useMemo(() => hashPose(step.pose), [step.pose]);

  // S'abonner au cache via un sélecteur force un re-render quand la vignette
  // du step arrive ou quand la version (cameraDir / geometry) change.
  const dataUrl = usePoseThumbnailStore((s) => {
    const entry = s.thumbnails[step.id];
    if (!entry) return null;
    if (entry.version !== s.version) return null;
    if (entry.poseHash !== poseHash) return null;
    return entry.dataUrl;
  });
  const request = usePoseThumbnailStore((s) => s.request);

  useEffect(() => {
    if (dataUrl) return;
    request(step.id, step.pose);
  }, [dataUrl, request, step.id, step.pose]);

  if (!dataUrl) {
    return <div className="pose-thumb pose-thumb-placeholder" aria-label="Génération en cours" />;
  }
  return <img className="pose-thumb" src={dataUrl} alt={`Pose ${step.name}`} draggable={false} />;
}
