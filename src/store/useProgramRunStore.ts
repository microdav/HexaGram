import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Program, LoopTarget } from "../model/program";
import type { Pose } from "../model/pose";
import {
  resolveProgramKeyframes,
  buildPlaybackFrames,
  type ProgramFrame,
} from "../model/programPlayback";
import { useHexapodStore } from "./useHexapodStore";
import { useSequencerStore } from "./useSequencerStore";
import { useSavedSequencesStore } from "./useSavedSequencesStore";
import { useSerialStore } from "./useSerialStore";
import { computeLegMounts } from "../model/hexapod";

export const ROOM_PANEL_MIN_W = 280;
export const ROOM_PANEL_MAX_W = 900;
export const ROOM_PANEL_DEFAULT_W = 460;

// Timer de lecture au niveau module (partagé entre composants).
let _timer: ReturnType<typeof setTimeout> | null = null;

function _clearTimer() {
  if (_timer !== null) { clearTimeout(_timer); _timer = null; }
}

/** Intervalle (ms) entre images, calé sur les réglages de vitesse du séquenceur. */
function frameIntervalMs(): number {
  const { transitionSpeed, stepDelay, playbackSpeed } = useSequencerStore.getState();
  const speed = playbackSpeed > 0 ? playbackSpeed : 1;
  return ((transitionSpeed + stepDelay) * 1000) / speed;
}

/** Locomotion réelle (P3) active : envoi au robot demandé ET carte connectée. */
function robotActive(): boolean {
  return (
    useProgramRunStore.getState().robotStepping &&
    useSerialStore.getState().status === "connected"
  );
}

/**
 * Prochaine keyframe en ordre de lecture (en tenant compte du bouclage), avec la
 * durée `T` du segment = nb d'images denses × intervalle (respecte la vitesse).
 * Sert à commander le robot pas-à-pas pendant que la 3D interpole en fluide.
 */
function nextPlaybackKeyframe(idx: number): { pose: Pose; timeMs: number } | null {
  const s = useProgramRunStore.getState();
  const frames = s.frames;
  for (let j = idx + 1; j < frames.length; j++) {
    if (frames[j].isKeyframe) {
      return { pose: frames[j].pose, timeMs: Math.max(1, Math.round((j - idx) * frameIntervalMs())) };
    }
  }
  // Fin de la liste : appliquer le bouclage (pas d'images denses → transition douce).
  const softT = Math.max(400, Math.round(frameIntervalMs()));
  switch (s.loop.type) {
    case "init":
      return frames.length > 0 ? { pose: frames[0].pose, timeMs: softT } : null;
    case "step": {
      const t = s.loopTargetFrame >= 0 ? s.loopTargetFrame : 0;
      return frames[t] ? { pose: frames[t].pose, timeMs: softT } : null;
    }
    default:
      return null; // "none" : pas de pas suivant
  }
}

interface ProgramRunState {
  isRunning: boolean;
  isPreparing: boolean;
  error: string | null;
  frames: ProgramFrame[];
  currentFrameIndex: number;
  /** Configuration de bouclage active pour la lecture en cours. */
  loop: LoopTarget;
  /**
   * Relâcher le couple en fin de lecture « Fin » (loop = none) quand le robot est
   * réellement piloté (cf. Program.releaseOnEnd). Renseigné à chaque `run`.
   */
  releaseOnEnd: boolean;
  /** stepIndex → index de la 1re image (keyframe) de cette étape. */
  stepStartFrame: Record<number, number>;
  /** Largeur du panneau salle (persistée) et son ouverture. */
  panelWidth: number;
  panelOpen: boolean;
  /** Caméra de la salle : azimut (deg) sur l'ellipse murale + hauteur (m). */
  camAzimuthDeg: number;
  camHeight: number;
  /** Position de départ du robot au sol (persistée) + drag en cours. */
  startX: number;
  startZ: number;
  isDraggingRobot: boolean;
  /**
   * Locomotion réelle : si vrai ET la carte connectée, le Run envoie les
   * keyframes au robot (transition `T`, synchro `Q`) en plus d'animer la 3D.
   * Persisté (préférence d'atelier).
   */
  robotStepping: boolean;
  /**
   * Pose affichée au repos (hors lecture) dans la salle et l'écran conception :
   * 1re keyframe du programme (Init). Non persistée — recalculée par le panneau.
   */
  restPose: Pose | null;

  run: (program: Pick<Program, "initPose" | "steps" | "loop" | "releaseOnEnd">) => Promise<void>;
  stop: () => void;
  setPanelWidth: (w: number) => void;
  setPanelOpen: (open: boolean) => void;
  setCamAzimuth: (deg: number) => void;
  nudgeCamAzimuth: (deltaDeg: number) => void;
  setCamHeight: (h: number) => void;
  setStartPos: (x: number, z: number) => void;
  setDraggingRobot: (v: boolean) => void;
  setRestPose: (p: Pose | null) => void;
  setRobotStepping: (v: boolean) => void;
}

export const CAM_HEIGHT_MIN = 0.6;
export const CAM_HEIGHT_MAX = 2.3;
/** Demi-dimensions utiles de la salle pour borner la position de départ. */
const START_MARGIN = 0.5;
const START_MAX_X = 2.5 - START_MARGIN;
const START_MAX_Z = 4 - START_MARGIN;
/** Azimuts des 4 coins (deg) : avant-droite, avant-gauche, arrière-gauche, arrière-droite. */
export const CAM_CORNERS = { avD: 45, avG: 135, arG: 225, arD: 315 };

async function _scheduleNext(nextIdx: number) {
  const s = useProgramRunStore.getState();
  if (!s.isRunning || s.frames.length === 0) return;

  let idx = nextIdx;
  if (idx >= s.frames.length) {
    // Fin des images : appliquer la boucle.
    switch (s.loop.type) {
      case "init":
        idx = 0;
        break;
      case "step":
        // Index de la 1re image de l'étape ciblée (résolu dans run()).
        idx = s.loopTargetFrame >= 0 ? s.loopTargetFrame : 0;
        break;
      case "none":
      default:
        // Fin (pas de boucle) : si le programme pilote réellement le robot et que
        // l'option « relâcher en fin » est active, on attend l'arrivée à la pose
        // finale (séquence « couché » au sol) PUIS on coupe le couple — jamais en
        // plein mouvement, sinon le robot s'effondre au lieu de se poser.
        if (s.releaseOnEnd && robotActive()) {
          const serial = useSerialStore.getState();
          await serial.waitUntilIdle(Math.max(1500, frameIntervalMs() * 2));
          await serial.releaseAll();
        }
        useProgramRunStore.getState().stop();
        return;
    }
  }

  useProgramRunStore.setState({ currentFrameIndex: idx });
  useHexapodStore.getState().applyPose(s.frames[idx].pose);

  // Locomotion réelle (P3) : à chaque keyframe, on s'assure que le robot a fini le
  // pas précédent (gate `Q`), puis on lui envoie la keyframe suivante sur la durée
  // du segment (le contrôleur interpole). La 3D, elle, reste fluide (images denses).
  if (s.frames[idx].isKeyframe && robotActive()) {
    const serial = useSerialStore.getState();
    await serial.waitUntilIdle(Math.max(1500, frameIntervalMs() * 2));
    if (!useProgramRunStore.getState().isRunning) return;
    const seg = nextPlaybackKeyframe(idx);
    if (seg) await serial.sendPoseTimed(seg.pose, seg.timeMs);
    if (!useProgramRunStore.getState().isRunning) return;
  }

  _timer = setTimeout(() => void _scheduleNext(idx + 1), frameIntervalMs());
}

interface ProgramRunInternal extends ProgramRunState {
  /** Index d'image cible pour la boucle « → Étape N » (-1 si non applicable). */
  loopTargetFrame: number;
}

export const useProgramRunStore = create<ProgramRunInternal>()(
  persist(
    (set, get) => ({
      isRunning: false,
      isPreparing: false,
      error: null,
      frames: [],
      currentFrameIndex: -1,
      loop: { type: "none" },
      releaseOnEnd: false,
      stepStartFrame: {},
      loopTargetFrame: -1,
      panelWidth: ROOM_PANEL_DEFAULT_W,
      panelOpen: true,
      camAzimuthDeg: 52,
      camHeight: 1.6,
      startX: 0,
      startZ: 0,
      isDraggingRobot: false,
      restPose: null,
      robotStepping: false,

      run: async (program) => {
        _clearTimer();
        // Repartir d'un état propre côté série : le miroir live n'est suspendu
        // que si ce Run pilote effectivement le robot (cf. plus bas).
        useSerialStore.getState().setRobotRunActive(false);
        set({ isPreparing: true, error: null, isRunning: false, currentFrameIndex: -1 });
        try {
          const { stepDelay } = useSequencerStore.getState();
          const getSequence = useSavedSequencesStore.getState().getSequence;
          // Géométrie/ancrages du robot actif : permettent de générer des
          // transitions inter-séquences physiques (pieds levés, équilibre,
          // orientation) plutôt qu'une interpolation linéaire des angles.
          const { geometry } = useHexapodStore.getState();
          const mounts = computeLegMounts(geometry);
          const keyframes = await resolveProgramKeyframes(program, getSequence);
          const frames = buildPlaybackFrames(keyframes, stepDelay, { geometry, mounts });

          if (frames.length === 0) {
            set({
              isPreparing: false,
              error: "Programme vide : ajoutez une pose d'init ou des étapes.",
            });
            return;
          }

          // Index de la 1re keyframe de chaque étape.
          const stepStartFrame: Record<number, number> = {};
          frames.forEach((f, i) => {
            if (f.isKeyframe && f.stepIndex >= 0 && stepStartFrame[f.stepIndex] === undefined) {
              stepStartFrame[f.stepIndex] = i;
            }
          });

          // Résolution de la cible de boucle « → Étape N ».
          let loopTargetFrame = -1;
          if (program.loop.type === "step") {
            const targetStepId = program.loop.stepId;
            const stepIdx = program.steps.findIndex((s) => s.id === targetStepId);
            if (stepIdx >= 0 && stepStartFrame[stepIdx] !== undefined) {
              loopTargetFrame = stepStartFrame[stepIdx];
            }
          }

          set({
            frames,
            stepStartFrame,
            loop: program.loop,
            releaseOnEnd: !!program.releaseOnEnd,
            loopTargetFrame,
            isPreparing: false,
            isRunning: true,
            currentFrameIndex: 0,
          });
          useHexapodStore.getState().applyPose(frames[0].pose);

          if (robotActive()) {
            // Locomotion réelle : soft-start (amener le robot à la pose initiale
            // en douceur, attendre son arrivée) puis entrer dans la boucle
            // pas-à-pas dès la keyframe 0. Le miroir live est suspendu pour ne pas
            // doubler les envois pilotés par la boucle.
            const serial = useSerialStore.getState();
            serial.setRobotRunActive(true);
            const t0 = Math.max(600, Math.round(frameIntervalMs()));
            await serial.sendPoseTimed(frames[0].pose, t0);
            await serial.waitUntilIdle(t0 * 2 + 800);
            if (!get().isRunning) return; // arrêt pendant le soft-start
            void _scheduleNext(0);
          } else {
            _timer = setTimeout(() => void _scheduleNext(1), frameIntervalMs());
          }
        } catch (e: unknown) {
          useSerialStore.getState().setRobotRunActive(false);
          set({
            isPreparing: false,
            isRunning: false,
            error: e instanceof Error ? e.message : "Erreur de préparation",
          });
        }
      },

      stop: () => {
        _clearTimer();
        useSerialStore.getState().setRobotRunActive(false); // réactive le miroir live
        const { frames } = get();
        set({ isRunning: false, isPreparing: false, currentFrameIndex: -1 });
        // Réapplique la pose de départ (init / 1re image) pour un état propre.
        if (frames.length > 0) useHexapodStore.getState().applyPose(frames[0].pose);
      },

      setPanelWidth: (w) =>
        set({ panelWidth: Math.max(ROOM_PANEL_MIN_W, Math.min(ROOM_PANEL_MAX_W, w)) }),
      setPanelOpen: (open) => set({ panelOpen: open }),
      setCamAzimuth: (deg) => set({ camAzimuthDeg: ((deg % 360) + 360) % 360 }),
      nudgeCamAzimuth: (deltaDeg) =>
        set((s) => ({ camAzimuthDeg: ((s.camAzimuthDeg + deltaDeg) % 360 + 360) % 360 })),
      setCamHeight: (h) =>
        set({ camHeight: Math.max(CAM_HEIGHT_MIN, Math.min(CAM_HEIGHT_MAX, h)) }),
      setStartPos: (x, z) =>
        set({
          startX: Math.max(-START_MAX_X, Math.min(START_MAX_X, x)),
          startZ: Math.max(-START_MAX_Z, Math.min(START_MAX_Z, z)),
        }),
      setDraggingRobot: (v) => set({ isDraggingRobot: v }),
      setRestPose: (p) => set({ restPose: p }),
      setRobotStepping: (v) => set({ robotStepping: v }),
    }),
    {
      name: "hexagram-program-run",
      partialize: (s) => ({
        panelWidth: s.panelWidth,
        panelOpen: s.panelOpen,
        camAzimuthDeg: s.camAzimuthDeg,
        camHeight: s.camHeight,
        startX: s.startX,
        startZ: s.startZ,
        robotStepping: s.robotStepping,
      }),
    },
  ),
);
