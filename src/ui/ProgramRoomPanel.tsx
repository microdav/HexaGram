import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomScene } from "../three/RoomScene";
import { PoseThumbnail } from "./PoseThumbnail";
import { useProgramRunStore, CAM_CORNERS } from "../store/useProgramRunStore";
import { useSequencerStore } from "../store/useSequencerStore";
import { useSavedSequencesStore } from "../store/useSavedSequencesStore";
import { useProjectStore } from "../store/useProjectStore";
import { useSerialStore } from "../store/useSerialStore";
import { resolveProgramKeyframes, type ProgramKeyframe } from "../model/programPlayback";
import { SpeedWheel } from "./SpeedWheel";
import type { Program } from "../model/program";

type RunnableProgram = Pick<Program, "initPose" | "steps" | "loop">;

interface ProgramRoomPanelProps {
  /** Brouillon courant à exécuter (avec ses modifications non enregistrées). */
  program: RunnableProgram | null;
}

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

  // Locomotion réelle : envoi au robot pas-à-pas (T + synchro Q) pendant le Run.
  const robotStepping = useProgramRunStore((s) => s.robotStepping);
  const setRobotStepping = useProgramRunStore((s) => s.setRobotStepping);
  const serialStatus = useSerialStore((s) => s.status);
  const connected = serialStatus === "connected";
  const electronics = useProjectStore((s) => s.activeProject?.hardware?.electronics) ?? null;
  const boundCount = useMemo(() => {
    if (!electronics) return 0;
    let n = 0;
    for (let id = 0; id < 18; id++) if (electronics.bindings[id]?.channel != null) n++;
    return n;
  }, [electronics]);
  const robotReady = connected && boundCount > 0;

  const canRun = !!program && (!!program.initPose || program.steps.length > 0);

  // Keyframes de la frise (résolues à partir du brouillon, hors lecture).
  const [keyframes, setKeyframes] = useState<ProgramKeyframe[]>([]);
  const signature = programSignature(program);
  useEffect(() => {
    const setRestPose = useProgramRunStore.getState().setRestPose;
    if (!program) { setKeyframes([]); setRestPose(null); return; }
    // Pose Init disponible immédiatement (synchrone) si définie : évite le flash
    // « pose par défaut → Init » avant la résolution asynchrone des séquences.
    setRestPose(program.initPose ?? null);
    let cancelled = false;
    const getSequence = useSavedSequencesStore.getState().getSequence;
    resolveProgramKeyframes(program, getSequence)
      .then((kf) => {
        if (cancelled) return;
        setKeyframes(kf);
        // Pose de repos = pose/étape sélectionnée pour INIT (sinon 1re keyframe).
        setRestPose(program.initPose ?? kf[0]?.pose ?? null);
      })
      .catch(() => { if (!cancelled) { setKeyframes([]); setRestPose(null); } });
    return () => { cancelled = true; };
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrêt à la sortie de la page : sinon le timer module-level continuerait de
  // piloter la pose globale après avoir quitté l'onglet Programmation.
  useEffect(() => () => { useProgramRunStore.getState().stop(); }, []);

  // Persistance projet de la position de départ : à la fin d'un drag du robot.
  const isDraggingRobot = useProgramRunStore((s) => s.isDraggingRobot);
  const wasDraggingRobot = useRef(false);
  useEffect(() => {
    if (wasDraggingRobot.current && !isDraggingRobot) {
      const { startX, startZ } = useProgramRunStore.getState();
      useProjectStore.getState().updatePreferences({ roomStartPos: { x: startX, z: startZ } }).catch(() => {});
    }
    wasDraggingRobot.current = isDraggingRobot;
  }, [isDraggingRobot]);

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
    // Si un drag du robot vient de démarrer (handler 3D sur la cible), ne pas
    // pivoter la caméra — le pointerdown 3D s'exécute avant ce handler DOM.
    if (useProgramRunStore.getState().isDraggingRobot) return;
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

  // Label de groupe = nom de la séquence/étape source (jaune, étendu sur ses vignettes).
  const groupLabel = (stepIndex: number): string => {
    if (stepIndex < 0) return "Init";
    const s = program?.steps[stepIndex];
    if (!s) return `Étape ${stepIndex + 1}`;
    return s.type === "ref" ? s.sequenceName || "Séquence" : s.name;
  };
  // Regroupe les keyframes consécutives de même étape.
  const groups: { label: string; items: { k: ProgramKeyframe; i: number }[] }[] = [];
  keyframes.forEach((k, i) => {
    const last = groups[groups.length - 1];
    if (last && last.items[0].k.stepIndex === k.stepIndex) last.items.push({ k, i });
    else groups.push({ label: groupLabel(k.stepIndex), items: [{ k, i }] });
  });

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
        <label className="program-room-speed" title="Vitesse d'exécution">
          <span aria-hidden="true">⏱</span>
          <SpeedWheel
            value={playbackSpeed}
            onChange={setPlaybackSpeed}
            title="Vitesse d'exécution"
          />
        </label>
        <button
          type="button"
          className={`btn btn-sm ${robotStepping ? "btn-primary" : ""}`}
          aria-pressed={robotStepping ? "true" : "false"}
          disabled={isRunning}
          onClick={() => setRobotStepping(!robotStepping)}
          title={
            !connected
              ? "Envoi au robot pendant le Run (pas-à-pas, T + synchro Q) — connectez d'abord la carte (USB)"
              : boundCount === 0
                ? "Aucun servo câblé — affectez les canaux dans l'onglet Électronique"
                : robotStepping
                  ? "Le Run pilotera le robot réel (pas-à-pas, synchro Q). Cliquer pour désactiver."
                  : "Activer l'envoi au robot pendant le Run (pas-à-pas, transition T, synchro Q)"
          }
        >
          🤖 Robot{robotStepping ? (robotReady ? " ✓" : " (hors ligne)") : ""}
        </button>
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

      {/* Frise : vignettes groupées par séquence (label jaune) + curseur de progression */}
      {n > 0 && (
        <div className="program-room-timeline">
          <div className="room-timeline-track">
            {groups.map((g, gi) => (
              <div key={gi} className="room-timeline-group" style={{ flexGrow: g.items.length }}>
                <div className="room-timeline-grouplabel" title={g.label}>{g.label}</div>
                <div className="room-timeline-cells">
                  {g.items.map(({ k, i }) => (
                    <div
                      key={`${k.id}-${i}`}
                      className={"room-timeline-cell" + (i === activeIdx ? " active" : "")}
                      title={k.name}
                    >
                      <PoseThumbnail id={k.id} pose={k.pose} alt={k.name} />
                    </div>
                  ))}
                </div>
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
