import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Program, LoopTarget } from "../model/program";
import {
  resolveProgramKeyframes,
  buildPlaybackFrames,
  type ProgramFrame,
} from "../model/programPlayback";
import { useHexapodStore } from "./useHexapodStore";
import { useSequencerStore } from "./useSequencerStore";
import { useSavedSequencesStore } from "./useSavedSequencesStore";

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

interface ProgramRunState {
  isRunning: boolean;
  isPreparing: boolean;
  error: string | null;
  frames: ProgramFrame[];
  currentFrameIndex: number;
  /** Configuration de bouclage active pour la lecture en cours. */
  loop: LoopTarget;
  /** stepIndex → index de la 1re image (keyframe) de cette étape. */
  stepStartFrame: Record<number, number>;
  /** Largeur du panneau salle (persistée) et son ouverture. */
  panelWidth: number;
  panelOpen: boolean;
  /** Caméra de la salle : azimut (deg) sur l'ellipse murale + hauteur (m). */
  camAzimuthDeg: number;
  camHeight: number;

  run: (program: Pick<Program, "initPose" | "steps" | "loop">) => Promise<void>;
  stop: () => void;
  setPanelWidth: (w: number) => void;
  setPanelOpen: (open: boolean) => void;
  setCamAzimuth: (deg: number) => void;
  nudgeCamAzimuth: (deltaDeg: number) => void;
  setCamHeight: (h: number) => void;
}

export const CAM_HEIGHT_MIN = 0.6;
export const CAM_HEIGHT_MAX = 2.3;
/** Azimuts des 4 coins (deg) : avant-droite, avant-gauche, arrière-gauche, arrière-droite. */
export const CAM_CORNERS = { avD: 45, avG: 135, arG: 225, arD: 315 };

function _scheduleNext(nextIdx: number) {
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
        useProgramRunStore.getState().stop();
        return;
    }
  }

  useProgramRunStore.setState({ currentFrameIndex: idx });
  useHexapodStore.getState().applyPose(s.frames[idx].pose);
  _timer = setTimeout(() => _scheduleNext(idx + 1), frameIntervalMs());
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
      stepStartFrame: {},
      loopTargetFrame: -1,
      panelWidth: ROOM_PANEL_DEFAULT_W,
      panelOpen: true,
      camAzimuthDeg: 52,
      camHeight: 1.6,

      run: async (program) => {
        _clearTimer();
        set({ isPreparing: true, error: null, isRunning: false, currentFrameIndex: -1 });
        try {
          const { stepDelay } = useSequencerStore.getState();
          const getSequence = useSavedSequencesStore.getState().getSequence;
          const keyframes = await resolveProgramKeyframes(program, getSequence);
          const frames = buildPlaybackFrames(keyframes, stepDelay);

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
            loopTargetFrame,
            isPreparing: false,
            isRunning: true,
            currentFrameIndex: 0,
          });
          useHexapodStore.getState().applyPose(frames[0].pose);
          _timer = setTimeout(() => _scheduleNext(1), frameIntervalMs());
        } catch (e: unknown) {
          set({
            isPreparing: false,
            isRunning: false,
            error: e instanceof Error ? e.message : "Erreur de préparation",
          });
        }
      },

      stop: () => {
        _clearTimer();
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
    }),
    {
      name: "hexagram-program-run",
      partialize: (s) => ({
        panelWidth: s.panelWidth,
        panelOpen: s.panelOpen,
        camAzimuthDeg: s.camAzimuthDeg,
        camHeight: s.camHeight,
      }),
    },
  ),
);
