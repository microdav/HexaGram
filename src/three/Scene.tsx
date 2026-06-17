import { useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewcube, Grid, OrbitControls } from "@react-three/drei";
import type { Group } from "three";
import { Hexapod } from "./Hexapod";
import { Compass } from "./Compass";
import { StepInfoPanel } from "./StepInfoPanel";
import { PoseInfoPanel } from "./PoseInfoPanel";
import { ServoDetailPanel } from "./ServoDetailPanel";
import { HeightRuler } from "../ui/HeightRuler";
import { useHexapodStore } from "../store/useHexapodStore";
import { useCollisions } from "../store/useCollisions";
import { useSequencerStore } from "../store/useSequencerStore";
import { computeBodyTransform } from "../model/kinematics";
import { computeLegMounts } from "../model/hexapod";

const CAM_KEY = "hexagram.camera";

const GRID_SECTION = 0.1; // période de la grille (m) — pour le wrap sans couture

/**
 * Sol qui réagit pendant la lecture du séquenceur pour donner l'illusion du
 * déplacement RÉEL — y compris les **virages et rotations**. Le mouvement est
 * dérivé de l'évolution des appuis (pieds plantés) entre deux IMAGES : un
 * ajustement rigide 2D (Procrustes) des positions prev→curr fournit à la fois
 * la translation ET la rotation apparentes du sol, composées dans le repère du sol.
 *
 * Piloté IMAGE PAR IMAGE (à chaque changement d'image du séquenceur), donc
 * naturellement synchronisé avec la VITESSE de lecture : à ×5 le sol va 5× plus
 * vite, et le déplacement total reste identique quelle que soit la vitesse.
 *
 * Deux groupes imbriqués : le groupe externe porte la **rotation** (autour du
 * robot), l'interne la **translation** (exprimée dans le repère tourné du sol,
 * d'où un wrap au pas de grille sans couture). À l'arrêt, tout est remis à zéro.
 */
function GridWithScroll() {
  const rotRef = useRef<Group>(null);     // rotation du sol (virages / rotations)
  const scrollRef = useRef<Group>(null);  // translation du sol (locomotion)
  const prevStepIdx = useRef(-1);
  const prevContacts = useRef<Map<number, { x: number; z: number }> | null>(null);
  // Transformation rigide accumulée du sol : rotation (yaw, rad) + translation
  // monde (offset). Seul le modulo (dans le repère tourné) est appliqué au mesh
  // pour qu'il reste près de l'origine (évite le frustum culling).
  const yaw = useRef(0);
  const offset = useRef({ x: 0, z: 0 });

  const applyToMesh = () => {
    // Translation dans le repère TOURNÉ du sol : L = R(−yaw)·offset, wrappée au
    // pas de grille → mesh près de l'origine, défilement sans couture.
    const cy = Math.cos(yaw.current), sy = Math.sin(yaw.current);
    const lx = offset.current.x * cy - offset.current.z * sy;
    const lz = offset.current.x * sy + offset.current.z * cy;
    const mod = (v: number) => ((v % GRID_SECTION) + GRID_SECTION) % GRID_SECTION;
    if (scrollRef.current) {
      scrollRef.current.position.x = mod(lx);
      scrollRef.current.position.z = mod(lz);
    }
    if (rotRef.current) rotRef.current.rotation.y = yaw.current;
  };

  useFrame(() => {
    const { isPlaying, currentStepIndex } = useSequencerStore.getState();

    if (!isPlaying) {
      prevStepIdx.current = -1;
      prevContacts.current = null;
      offset.current = { x: 0, z: 0 };
      yaw.current = 0;
      if (scrollRef.current) {
        scrollRef.current.position.x = 0;
        scrollRef.current.position.z = 0;
      }
      if (rotRef.current) rotRef.current.rotation.y = 0;
      return;
    }

    // Rien à faire tant que l'image jouée n'a pas changé : le sol n'avance qu'au
    // rythme réel des images (donc à la vitesse de lecture).
    if (currentStepIndex === prevStepIdx.current) return;
    prevStepIdx.current = currentStepIndex;

    const { pose, geometry, gravityEnabled } = useHexapodStore.getState();
    const mounts = computeLegMounts(geometry);
    const bt = computeBodyTransform(pose, geometry, mounts, gravityEnabled);

    // Build contact map for this frame: legIndex → XZ position
    const currentMap = new Map<number, { x: number; z: number }>();
    for (const c of bt.contacts) {
      currentMap.set(c.legIndex, { x: c.position.x, z: c.position.z });
    }

    if (prevContacts.current !== null) {
      // Appuis persistants → ajustement rigide 2D (Procrustes) prev→curr : donne
      // la rotation (θ, sens rotation.y de Three) et la translation (d) apparentes
      // du sol pour CETTE image. ≥2 appuis requis pour estimer une rotation.
      const prev: { x: number; z: number }[] = [];
      const curr: { x: number; z: number }[] = [];
      for (const [leg, q] of currentMap) {
        const p = prevContacts.current.get(leg);
        if (p) { prev.push(p); curr.push(q); }
      }
      const n = prev.length;
      if (n > 0) {
        let pbx = 0, pbz = 0, qbx = 0, qbz = 0;
        for (let i = 0; i < n; i++) { pbx += prev[i].x; pbz += prev[i].z; qbx += curr[i].x; qbz += curr[i].z; }
        pbx /= n; pbz /= n; qbx /= n; qbz /= n;
        let cdot = 0, ccross = 0;
        for (let i = 0; i < n; i++) {
          const ax = prev[i].x - pbx, az = prev[i].z - pbz;
          const bx = curr[i].x - qbx, bz = curr[i].z - qbz;
          cdot += ax * bx + az * bz;
          ccross += az * bx - ax * bz; // rotation au sens rotation.y de Three
        }
        // Garde-fou : rotation par image bornée (évite les sauts si les appuis changent).
        let dth = n >= 2 ? Math.atan2(ccross, cdot) : 0;
        dth = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, dth));
        // Translation monde : d = currbar − R(θ)·prevbar (R = rotation.y de Three).
        const c = Math.cos(dth), s = Math.sin(dth);
        const dx = qbx - (pbx * c + pbz * s);
        const dz = qbz - (-pbx * s + pbz * c);
        // Compose la transformation rigide : yaw += δθ ; offset = R(δθ)·offset + δd.
        const nx = offset.current.x * c + offset.current.z * s + dx;
        const nz = -offset.current.x * s + offset.current.z * c + dz;
        offset.current = { x: nx, z: nz };
        yaw.current += dth;
        applyToMesh();
      }
    }

    prevContacts.current = currentMap;
  });

  return (
    <group position={[0, -0.001, 0]}>
      <group ref={rotRef}>
        <group ref={scrollRef}>
          <Grid
            args={[2, 2]}
            cellSize={0.01}
            cellThickness={0.8}
            cellColor="#39414f"
            sectionSize={0.1}
            sectionThickness={1.4}
            sectionColor="#5b6679"
            fadeDistance={1.6}
            fadeStrength={1}
            infiniteGrid
          />
        </group>
      </group>
    </group>
  );
}

type SavedCamera = {
  position: [number, number, number];
  target: [number, number, number];
};

function readSavedCamera(): SavedCamera | null {
  try {
    const raw = localStorage.getItem(CAM_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedCamera;
  } catch { return null; }
}

function CameraTracker() {
  const { camera, controls } = useThree();
  const setCameraDirection = useHexapodStore((s) => s.setCameraDirection);
  const compassLocked = useHexapodStore((s) => s.compassLocked);
  const last = useRef<[number, number, number]>([0, 0, 0]);
  const restored = useRef(false);
  const lastSaveTime = useRef(0);
  const lastSavedPos = useRef("");

  useFrame(() => {
    // Restore OrbitControls target on first frame once controls are ready
    if (!restored.current && controls) {
      restored.current = true;
      const saved = readSavedCamera();
      if (saved) {
        const orb = controls as { target?: { set: (x: number, y: number, z: number) => void }; update?: () => void };
        orb.target?.set(...saved.target);
        orb.update?.();
      }
    }

    // Compass direction tracking
    if (!compassLocked) {
      const x = camera.position.x;
      const y = camera.position.y;
      const z = camera.position.z;
      const m = Math.sqrt(x * x + y * y + z * z);
      if (m >= 1e-4) {
        const dx = x / m, dy = y / m, dz = z / m;
        if (
          Math.abs(dx - last.current[0]) > 1e-3 ||
          Math.abs(dy - last.current[1]) > 1e-3 ||
          Math.abs(dz - last.current[2]) > 1e-3
        ) {
          last.current = [dx, dy, dz];
          setCameraDirection([dx, dy, dz]);
        }
      }
    }

    // Throttled camera persistence (every 500 ms when position changes)
    const now = performance.now();
    if (now - lastSaveTime.current < 500) return;
    const posKey = `${camera.position.x.toFixed(3)},${camera.position.y.toFixed(3)},${camera.position.z.toFixed(3)}`;
    if (posKey === lastSavedPos.current) return;
    lastSavedPos.current = posKey;
    lastSaveTime.current = now;
    try {
      const orb = controls as { target?: { x: number; y: number; z: number } } | null;
      const t = orb?.target ?? { x: 0, y: 0, z: 0 };
      localStorage.setItem(CAM_KEY, JSON.stringify({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [t.x, t.y, t.z],
      }));
    } catch {}
  });

  return null;
}

const DEFAULT_CAM_POS: [number, number, number] = [0.55, 0.4, 0.55];

function CollisionBanner() {
  const collisions = useCollisions();
  if (!collisions.hasCollision) return null;
  return (
    <div className="collision-banner">
      <span className="collision-banner-icon">▼</span>
      <span>Collision détectée</span>
    </div>
  );
}

export function Scene() {
  // Untyped: drei's OrbitControls ref shape is OrbitControlsImpl from three-stdlib;
  // we only need .reset() so we keep it loose.
  const controlsRef = useRef<{ reset: () => void } | null>(null);
  const arcInteracting = useHexapodStore((s) => s.arcShownMask !== 0);
  const cogDragging = useHexapodStore((s) => s.cogDragging);
  const footDragging = useHexapodStore((s) => s.footDragging);
  const bodyHeightDragging = useHexapodStore((s) => s.bodyHeightDragging);
  const chassisSelected = useHexapodStore((s) => s.chassisSelected);

  const onHome = () => controlsRef.current?.reset();

  // Échap désélectionne le châssis (referme poignée + règle de hauteur).
  useEffect(() => {
    if (!chassisSelected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useHexapodStore.getState().setChassisSelected(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chassisSelected]);

  const initCamPos = readSavedCamera()?.position ?? DEFAULT_CAM_POS;

  return (
    <div className="viewer-inner">
      <CollisionBanner />
      <Canvas
        shadows
        camera={{ position: initCamPos, fov: 45, near: 0.01, far: 50 }}
        dpr={[1, 2]}
        onPointerMissed={() => useHexapodStore.getState().setChassisSelected(false)}
      >
        <color attach="background" args={["#15171c"]} />

        <ambientLight intensity={0.45} />
        <directionalLight
          position={[2, 3, 2]}
          intensity={1.0}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />

        <GridWithScroll />

        <Hexapod />

        <CameraTracker />

        <OrbitControls
          ref={controlsRef as never}
          makeDefault
          enabled={!arcInteracting && !cogDragging && !footDragging && !bodyHeightDragging}
          enableDamping
          dampingFactor={0.1}
          minDistance={0.15}
          maxDistance={2}
          target={[0, 0, 0]}
        />

        <GizmoHelper alignment="bottom-left" margin={[70, 70]}>
          <GizmoViewcube
            color="#4a4f5a"
            opacity={1}
            strokeColor="#6b7280"
            textColor="#e6e8ec"
            hoverColor="#f5c518"
            font="bold 64px sans-serif"
            faces={["X", "-X", "Y", "-Y", "Z", "-Z"]}
          />
        </GizmoHelper>
      </Canvas>

      <Compass />

      <StepInfoPanel />

      <PoseInfoPanel />

      {/* Boîte de réglage du servo sélectionné (bas-centre) */}
      <ServoDetailPanel />

      {/* Règle graduée de hauteur du châssis (visible quand le châssis est
          sélectionné, comme la poignée 3D). */}
      {chassisSelected && <HeightRuler />}

      <button
        type="button"
        className="btn-home"
        onClick={onHome}
        title="Revenir à la vue d'origine"
        aria-label="Revenir à la vue d'origine"
      >
        ⌂ Home
      </button>
    </div>
  );
}
