import { useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { useHexapodStore } from '../store/useHexapodStore';
import { usePoseThumbnailStore } from '../store/usePoseThumbnailStore';
import { usePhotoSpaceStore } from '../store/usePhotoSpaceStore';
import { MiniHexapod, computeThumbnailCameraPos } from './MiniHexapod';

/* ─── Paramètres ────────────────────────────────────────────────────────────
 * Modifiable ici sans toucher au reste du code.
 *   THUMBNAIL_RENDER_SIZE — taille (px) du buffer WebGL et du PNG capturé
 *   THUMBNAIL_CAMERA_DISTANCE — distance caméra/point visé (mètres)
 *   THUMBNAIL_FOV — focale (deg)
 *   THUMBNAIL_LOOK_AT_Y — hauteur du point visé (m)
 *   THUMBNAIL_BG — couleur de fond
 * L'angle de vue est lu depuis usePhotoSpaceStore (modifiable via la toolbox
 * "Espace photo").
 */
export const THUMBNAIL_RENDER_SIZE = 250;
export const THUMBNAIL_CAMERA_DISTANCE = 0.95;
export const THUMBNAIL_FOV = 35;
export const THUMBNAIL_LOOK_AT_Y = 0.06;
export const THUMBNAIL_BG = '#15171c';

/**
 * Suit le job actif (tête de la queue) : à chaque nouveau job, on attend deux
 * rAF (pour laisser R3F mettre à jour le scene graph et le navigateur composer),
 * puis on force un rendu et on capture le PNG.
 */
function ThumbnailJobRunner() {
  const { gl, scene, camera } = useThree();
  const activeJob = usePoseThumbnailStore((s) => s.queue[0] ?? null);
  const finishJob = usePoseThumbnailStore((s) => s.finishJob);
  const processingKey = useRef<string | null>(null);
  const cleanupRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeJob) return;
    const key = `${activeJob.stepId}:${activeJob.version}:${activeJob.poseHash}`;
    if (processingKey.current === key) return;
    processingKey.current = key;

    const h1 = requestAnimationFrame(() => {
      const h2 = requestAnimationFrame(() => {
        try {
          gl.render(scene, camera);
          const dataUrl = gl.domElement.toDataURL('image/png');
          finishJob(activeJob.stepId, activeJob.version, dataUrl);
        } catch {
          finishJob(activeJob.stepId, activeJob.version, '');
        }
      });
      cleanupRef.current = h2;
    });
    cleanupRef.current = h1;

    return () => {
      if (cleanupRef.current !== null) cancelAnimationFrame(cleanupRef.current);
    };
  }, [activeJob, gl, scene, camera, finishJob]);

  return null;
}

/**
 * Renderer offscreen : un seul contexte WebGL pour toutes les vignettes.
 * Angle de vue fixe — indépendant de la caméra principale. Pas de sol.
 */
export function PoseThumbnailRenderer() {
  const activeJob = usePoseThumbnailStore((s) => s.queue[0] ?? null);
  const geometry = useHexapodStore((s) => s.geometry);
  const gravityEnabled = useHexapodStore((s) => s.gravityEnabled);
  const bodyTransparent = useHexapodStore((s) => s.bodyTransparent);
  const viewDirection = usePhotoSpaceStore((s) => s.viewDirection);
  const invalidateAll = usePoseThumbnailStore((s) => s.invalidateAll);

  // Invalidation globale sur changement de géométrie / gravité / transparence.
  const lastGeometryRef = useRef(geometry);
  useEffect(() => {
    if (lastGeometryRef.current !== geometry) {
      lastGeometryRef.current = geometry;
      invalidateAll();
    }
  }, [geometry, invalidateAll]);

  const lastGravityRef = useRef(gravityEnabled);
  useEffect(() => {
    if (lastGravityRef.current !== gravityEnabled) {
      lastGravityRef.current = gravityEnabled;
      invalidateAll();
    }
  }, [gravityEnabled, invalidateAll]);

  const lastTransparentRef = useRef(bodyTransparent);
  useEffect(() => {
    if (lastTransparentRef.current !== bodyTransparent) {
      lastTransparentRef.current = bodyTransparent;
      invalidateAll();
    }
  }, [bodyTransparent, invalidateAll]);

  const camPos = computeThumbnailCameraPos(viewDirection, THUMBNAIL_CAMERA_DISTANCE);

  return (
    <div
      className="pose-thumb-renderer"
      aria-hidden="true"
      // eslint-disable-next-line react/forbid-component-props
      style={{ width: `${THUMBNAIL_RENDER_SIZE}px`, height: `${THUMBNAIL_RENDER_SIZE}px` } as React.CSSProperties}
    >
      <Canvas
        frameloop="demand"
        dpr={1}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: false }}
        camera={{
          position: [camPos.x, camPos.y + THUMBNAIL_LOOK_AT_Y, camPos.z],
          fov: THUMBNAIL_FOV,
          near: 0.01,
          far: 50,
        }}
        onCreated={({ camera }) => {
          camera.lookAt(0, THUMBNAIL_LOOK_AT_Y, 0);
        }}
      >
        <color attach="background" args={[THUMBNAIL_BG]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 3, 2]} intensity={0.9} />
        <directionalLight position={[-2, 1, -1]} intensity={0.3} />

        {activeJob && (
          <MiniHexapod
            pose={activeJob.pose}
            geometry={geometry}
            gravityEnabled={gravityEnabled}
            bodyTransparent={bodyTransparent}
          />
        )}

        <CameraSync direction={viewDirection} distance={THUMBNAIL_CAMERA_DISTANCE} />

        <ThumbnailJobRunner />
      </Canvas>
    </div>
  );
}

/** Met à jour la position de la caméra quand l'angle de vue change (toolbox Espace photo). */
function CameraSync({ direction, distance }: { direction: [number, number, number]; distance: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const p = computeThumbnailCameraPos(direction, distance);
    camera.position.set(p.x, p.y + THUMBNAIL_LOOK_AT_Y, p.z);
    camera.lookAt(0, THUMBNAIL_LOOK_AT_Y, 0);
    camera.updateProjectionMatrix();
  }, [direction, distance, camera]);
  return null;
}
