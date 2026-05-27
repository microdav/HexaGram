import { useCallback, useEffect, useRef, useState } from "react";
import { RoomScene } from "../three/RoomScene";
import { PoseThumbnail } from "./PoseThumbnail";
import { useProgramRunStore, CAM_CORNERS } from "../store/useProgramRunStore";
import { useSequencerStore } from "../store/useSequencerStore";
import { useSavedSequencesStore } from "../store/useSavedSequencesStore";
import { resolveProgramKeyframes, type ProgramKeyframe } from "../model/programPlayback";
import type { Program } from "../model/program";

type RunnableProgram = Pick<Program, "initPose" | "steps" | "loop">;

interface ProgramRoomPanelProps {
  /** Brouillon courant à exécuter (avec ses modifications non enregistrées). */
  program: RunnableProgram | null;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4];

/** Signature structurelle (hors noms) pour ne re-résoudre la frise qu'au besoin. */
function programSignature(p: RunnableProgram | null): string {
  if (!p) return "";
  return JSON.stringify({
    init: p.initPose,
    steps: p.steps.map((s) =>
      s.type === "ref" ? ["ref", s.sequenceId] : ["inline", s.steps.map((x) => x.id)],
    ),
  });
}

export function ProgramRoomPanel({ program }: ProgramRoomPanelProps) {
  const isRunning = useProgramRunStore((s) => s.isRunning);
  const isPreparing = useProgramRunStore((s) => s.isPreparing);
  const error = useProgramRunStore((s) => s.error);
  const panelWidth = useProgramRunStore((s) => s.panelWidth);
  const currentFrameIndex = useProgramRunStore((s) => s.currentFrameIndex);
  const framesLen = useProgramRunStore((s) => s.frames.length);
  const run = useProgramRunStore((s) => s.run);
  const stop = useProgramRunStore((s) => s.stop);
  const setPanelWidth = useProgramRunStore((s) => s.setPanelWidth);
  const camAzimuthDeg = useProgramRunStore((s) => s.camAzimuthDeg);
  const setCamAzimuth = useProgramRunStore((s) => s.setCamAzimuth);
  const nudgeCamAzimuth = useProgramRunStore((s) => s.nudgeCamAzimuth);

  const playbackSpeed = useSequencerStore((s) => s.playbackSpeed);
  const setPlaybackSpeed = useSequencerStore((s) => s.setPlaybackSpeed);

  const canRun = !!program && (!!program.initPose || program.steps.length > 0);

  // Keyframes de la frise (résolues à partir du brouillon, hors lecture).
  const [keyframes, setKeyframes] = useState<ProgramKeyframe[]>([]);
  const signature = programSignature(program);
  useEffect(() => {
    if (!program) { setKeyframes([]); return; }
    let cancelled = false;
    const getSequence = useSavedSequencesStore.getState().getSequence;
    resolveProgramKeyframes(program, getSequence)
      .then((kf) => { if (!cancelled) setKeyframes(kf); })
      .catch(() => { if (!cancelled) setKeyframes([]); });
    return () => { cancelled = true; };
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrêt à la sortie de la page : sinon le timer module-level continuerait de
  // piloter la pose globale après avoir quitté l'onglet Programmation.
  useEffect(() => () => { useProgramRunStore.getState().stop(); }, []);

  const resizeStartRef = useRef<{ x: number; w: number } | null>(null);

  // Resize horizontal — panneau ancré à droite : tirer vers la gauche élargit.
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizeStartRef.current = { x: e.clientX, w: useProgramRunStore.getState().panelWidth };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      if (!resizeStartRef.current) return;
      const dx = resizeStartRef.current.x - ev.clientX;
      useProgramRunStore.getState().setPanelWidth(resizeStartRef.current.w + dx);
    };
    const onUp = () => {
      resizeStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  const onRunClick = () => {
    if (isRunning) { stop(); return; }
    if (program) run(program);
  };

  const onHandleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { setPanelWidth(panelWidth + 24); e.preventDefault(); }
    else if (e.key === "ArrowRight") { setPanelWidth(panelWidth - 24); e.preventDefault(); }
  };

  // Glisser dans la scène : pivote la caméra (X) et ajuste la hauteur (Y).
  const camDragRef = useRef<{ x: number; y: number } | null>(null);
  const handleCamDragStart = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".room-cam-overlay")) return; // pas sur les boutons
    camDragRef.current = { x: e.clientX, y: e.clientY };
    const onMove = (ev: PointerEvent) => {
      if (!camDragRef.current) return;
      const dx = ev.clientX - camDragRef.current.x;
      const dy = ev.clientY - camDragRef.current.y;
      camDragRef.current = { x: ev.clientX, y: ev.clientY };
      const st = useProgramRunStore.getState();
      st.nudgeCamAzimuth(dx * 0.3);
      st.setCamHeight(st.camHeight - dy * 0.004);
    };
    const onUp = () => {
      camDragRef.current = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  // Coin actif (azimut proche à ±22,5°).
  const angularDist = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
  const cornerCls = (deg: number) =>
    "room-cam-corner" + (angularDist(camAzimuthDeg, deg) < 22.5 ? " active" : "");

  // Position continue (en unités de keyframe) du curseur de progression.
  const n = keyframes.length;
  const playPos =
    isRunning && framesLen > 1 && currentFrameIndex >= 0 && n > 1
      ? (currentFrameIndex / (framesLen - 1)) * (n - 1)
      : -1;
  const playheadPct = n > 1 ? ((playPos + 0.5) / n) * 100 : 50;
  const activeIdx = playPos >= 0 ? Math.round(playPos) : -1;

  return (
    <div className="program-room-panel" style={{ width: panelWidth }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionner le panneau salle"
        tabIndex={0}
        className="program-room-handle"
        onPointerDown={handleResizeStart}
        onKeyDown={onHandleKey}
        title="Glisser pour redimensionner"
      >
        ⋮
      </div>

      <div className="program-room-toolbar">
        <span className="program-room-title">🏠 Salle d'exécution</span>
        {error && <span className="program-room-error">{error}</span>}
        <span className="program-room-spacer" />
        <label className="program-room-speed" title="Vitesse de lecture">
          <span aria-hidden="true">⏱</span>
          <select
            aria-label="Vitesse de lecture"
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
          >
            {SPEEDS.map((v) => (
              <option key={v} value={v}>{v}×</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`btn btn-sm ${isRunning ? "btn-danger" : "btn-primary"}`}
          onClick={onRunClick}
          disabled={!isRunning && (!canRun || isPreparing)}
          title={
            isRunning
              ? "Arrêter l'exécution"
              : canRun
                ? "Exécuter le programme dans la salle"
                : "Ajoutez une pose d'init ou des étapes pour exécuter"
          }
        >
          {isRunning ? "■ Stop" : isPreparing ? "Préparation…" : "▶ Run"}
        </button>
      </div>

      <div
        className="program-room-canvas"
        onPointerDown={handleCamDragStart}
        title="Glisser pour pivoter la caméra"
      >
        <RoomScene />
        <div className="room-cam-overlay">
          <div className="room-cam-rotate">
            <button type="button" onClick={() => nudgeCamAzimuth(-90)} title="Pivoter de 90° à gauche" aria-label="Pivoter à gauche">↺</button>
            <button type="button" onClick={() => nudgeCamAzimuth(90)} title="Pivoter de 90° à droite" aria-label="Pivoter à droite">↻</button>
          </div>
          <div className="room-cam-corners" role="group" aria-label="Coins de la pièce">
            <button type="button" className={cornerCls(CAM_CORNERS.arG)} onClick={() => setCamAzimuth(CAM_CORNERS.arG)} title="Coin arrière gauche" aria-label="Coin arrière gauche">◤</button>
            <button type="button" className={cornerCls(CAM_CORNERS.arD)} onClick={() => setCamAzimuth(CAM_CORNERS.arD)} title="Coin arrière droite" aria-label="Coin arrière droite">◥</button>
            <button type="button" className={cornerCls(CAM_CORNERS.avG)} onClick={() => setCamAzimuth(CAM_CORNERS.avG)} title="Coin avant gauche" aria-label="Coin avant gauche">◣</button>
            <button type="button" className={cornerCls(CAM_CORNERS.avD)} onClick={() => setCamAzimuth(CAM_CORNERS.avD)} title="Coin avant droite" aria-label="Coin avant droite">◢</button>
          </div>
        </div>
      </div>

      {/* Frise : vignettes des keyframes + curseur de progression vertical */}
      {n > 0 && (
        <div className="program-room-timeline">
          <div className="room-timeline-track">
            {keyframes.map((k, i) => (
              <div
                key={`${k.id}-${i}`}
                className={
                  "room-timeline-cell" +
                  (i > 0 && k.stepIndex !== keyframes[i - 1].stepIndex ? " step-start" : "") +
                  (i === activeIdx ? " active" : "")
                }
                title={k.name}
              >
                <PoseThumbnail id={k.id} pose={k.pose} alt={k.name} />
              </div>
            ))}
            {playPos >= 0 && (
              <div className="room-timeline-playhead" style={{ left: `${playheadPct}%` }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
