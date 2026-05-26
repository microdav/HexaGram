import { useEffect, useMemo } from 'react';
import type { Pose } from '../model/pose';
import { usePoseThumbnailStore, hashPose } from '../store/usePoseThumbnailStore';

interface PoseThumbnailProps {
  /** Identifiant unique pour le cache (id d'étape séquenceur ou id de pose enregistrée). */
  id: string;
  pose: Pose;
  alt?: string;
}

/**
 * Vignette PNG d'une pose. Demande la génération si nécessaire et affiche
 * l'image dès qu'elle est disponible. La taille d'affichage est gérée en CSS
 * (.pose-thumb).
 */
export function PoseThumbnail({ id, pose, alt }: PoseThumbnailProps) {
  const poseHash = useMemo(() => hashPose(pose), [pose]);

  // S'abonner au cache via un sélecteur force un re-render quand la vignette
  // arrive ou quand la version (cameraDir / geometry) change.
  const dataUrl = usePoseThumbnailStore((s) => {
    const entry = s.thumbnails[id];
    if (!entry) return null;
    if (entry.version !== s.version) return null;
    if (entry.poseHash !== poseHash) return null;
    return entry.dataUrl;
  });
  // S'abonner explicitement à `version` : si invalidateAll() vide la file alors
  // qu'un request() avait déjà été émis (typiquement au boot du mode démo, où
  // loadSteps puis setGeometry s'enchaînent), le selector dataUrl reste null
  // et l'effet ne se redéclencherait pas sans cette dépendance.
  const version = usePoseThumbnailStore((s) => s.version);
  const request = usePoseThumbnailStore((s) => s.request);

  useEffect(() => {
    if (dataUrl) return;
    request(id, pose);
  }, [dataUrl, request, id, pose, version]);

  if (!dataUrl) {
    return <div className="pose-thumb pose-thumb-placeholder" aria-label="Génération en cours" />;
  }
  return <img className="pose-thumb" src={dataUrl} alt={alt ?? 'Pose'} draggable={false} />;
}
