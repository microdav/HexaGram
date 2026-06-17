import { useCallback, useMemo, useRef, useState } from "react";
import { useProjectStore } from "../store/useProjectStore";
import { useSavedSequencesStore } from "../store/useSavedSequencesStore";
import { useSerialStore } from "../store/useSerialStore";
import { useScsStore } from "../store/useScsStore";
import { LEG_NAMES } from "../model/hexapod";
import type { Program } from "../model/program";
import {
  resolveScsHardware,
  feasibleTimesForRows,
  servoSecPer60,
  scsCellUs,
  SCS_SERVOS,
} from "../model/scs";

interface ScsPanelProps {
  /** Programme courant (brouillon de la page Programmation) à convertir. */
  program: Pick<Program, "initPose" | "steps"> | null;
  programName?: string;
}

/**
 * Dock bas « SSC-32 ServoControlleur Séquenceur » (SCS) — même esprit que le
 * séquenceur de Conception (poignée + contenu repliable + redimensionnement).
 * Vue tabulaire éditable du flux de commandes réellement envoyé à la carte :
 * colonnes = servos, lignes = trames groupées. Convertit le programme graphique
 * courant, puis joue ligne à ligne en respectant le temps faisable.
 */
export function ScsPanel({ program, programName }: ScsPanelProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const status = useSerialStore((s) => s.status);
  const connected = status === "connected";

  const rows = useScsStore((s) => s.rows);
  const playing = useScsStore((s) => s.playing);
  const currentRow = useScsStore((s) => s.currentRow);
  const sourceName = useScsStore((s) => s.sourceName);
  const panelOpen = useScsStore((s) => s.panelOpen);
  const panelHeight = useScsStore((s) => s.panelHeight);
  const setPanelOpen = useScsStore((s) => s.setPanelOpen);
  const loadFromProgram = useScsStore((s) => s.loadFromProgram);
  const toggleSend = useScsStore((s) => s.toggleSend);
  const setDeg = useScsStore((s) => s.setDeg);
  const setRowName = useScsStore((s) => s.setRowName);
  const setRowTime = useScsStore((s) => s.setRowTime);
  const addRowAfter = useScsStore((s) => s.addRowAfter);
  const removeRow = useScsStore((s) => s.removeRow);
  const moveRow = useScsStore((s) => s.moveRow);
  const play = useScsStore((s) => s.play);
  const stop = useScsStore((s) => s.stop);

  const hw = useMemo(() => resolveScsHardware(activeProject?.hardware), [activeProject?.hardware]);
  const secPer60 = useMemo(() => servoSecPer60(hw.servo), [hw]);
  const feasibleTimes = useMemo(() => feasibleTimesForRows(rows, secPer60), [rows, secPer60]);

  // Redimensionnement du dock (drag vertical sur le bord supérieur).
  const [resizing, setResizing] = useState(false);
  const resizeStartRef = useRef<{ y: number; h: number } | null>(null);
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizeStartRef.current = { y: e.clientY, h: useScsStore.getState().panelHeight };
    setResizing(true);
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      if (!resizeStartRef.current) return;
      const dy = resizeStartRef.current.y - ev.clientY;
      useScsStore.getState().setPanelHeight(resizeStartRef.current.h + dy);
    };
    const onUp = () => {
      resizeStartRef.current = null;
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, []);

  const convert = () => {
    if (!program) return;
    void loadFromProgram(
      program,
      programName || "Programme",
      useSavedSequencesStore.getState().getSequence,
      hw
    );
  };

  return (
    <div
      className={`sequencer-panel scs-panel${panelOpen ? " open" : ""}${resizing ? " resizing" : ""}`}
      // eslint-disable-next-line react/forbid-component-props
      style={{ "--seq-panel-h": `${panelHeight}px` } as React.CSSProperties}
    >
      <button
        type="button"
        className="seq-panel-handle"
        onClick={() => setPanelOpen(!panelOpen)}
        title={`${panelOpen ? "Fermer" : "Ouvrir"} le séquenceur carte (SCS)`}
      >
        SCS — séquenceur carte {panelOpen ? "▾" : "▴"}
      </button>

      <div className="sequencer-content">
        <div className="seq-resize-handle" onPointerDown={handleResizeStart} />

        <div className="scs-body">
          <div className="scs-toolbar">
            <strong className="scs-title">SSC-32 ServoControlleur Séquenceur</strong>
            <button type="button" className="btn" onClick={convert} disabled={!program}>
              ↻ Convertir le programme courant
            </button>
            {playing ? (
              <button type="button" className="btn btn-danger" onClick={stop}>
                ⏹ Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void play(hw)}
                disabled={!connected || rows.length === 0}
                title={connected ? "Jouer la séquence sur la carte" : "Connectez la carte (USB) pour jouer"}
              >
                ▶ Play
              </button>
            )}
            <span className="scs-status">
              {sourceName ? `« ${sourceName} » — ` : ""}
              {rows.length} ligne{rows.length > 1 ? "s" : ""} ·{" "}
              {connected ? "carte connectée" : "non connectée (édition seule)"}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="scs-empty">
              Convertissez le programme courant pour générer les lignes réellement envoyées à la
              carte. Une ligne = une trame ; coché = le servo reçoit sa position (deg, µs au
              survol). « T auto » = temps physiquement faisable, respecté à la lecture.
            </div>
          ) : (
            <div className="scs-grid-scroll">
              <table className="scs-grid">
                <thead>
                  <tr>
                    <th className="scs-sticky-l" colSpan={2} />
                    {[0, 1, 2, 3, 4, 5].map((leg) => (
                      <th key={leg} colSpan={3} className="scs-leg-grp">
                        {LEG_NAMES[leg]}
                      </th>
                    ))}
                    <th colSpan={2} />
                  </tr>
                  <tr>
                    <th className="scs-sticky-l">#</th>
                    <th className="scs-col-name">Nom</th>
                    {SCS_SERVOS.map((sv) => (
                      <th key={sv.id} className={`scs-jh scs-j-${sv.joint}`} title={sv.label}>
                        {sv.short}
                        <span className="scs-jl">{sv.letter}</span>
                      </th>
                    ))}
                    <th className="scs-col-t">T (ms)</th>
                    <th className="scs-col-act" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.id} className={i === currentRow ? "scs-row-active" : ""}>
                      <td className="scs-sticky-l">{i + 1}</td>
                      <td className="scs-col-name">
                        <input
                          type="text"
                          aria-label={`Nom de la ligne ${i + 1}`}
                          value={row.name}
                          onChange={(e) => setRowName(row.id, e.target.value)}
                        />
                      </td>
                      {SCS_SERVOS.map((sv) => {
                        const bound = hw.bindings[sv.id]?.channel != null;
                        const us = bound ? scsCellUs(row, sv.id, hw) : null;
                        return (
                          <td
                            key={sv.id}
                            className={`scs-cell${row.send[sv.id] ? " scs-cell-on" : ""}`}
                          >
                            <input
                              type="checkbox"
                              checked={row.send[sv.id]}
                              disabled={!bound}
                              title={bound ? "Envoyer ce servo" : "Servo non câblé"}
                              onChange={() => toggleSend(row.id, sv.id)}
                            />
                            <input
                              type="number"
                              className="scs-deg"
                              value={row.deg[sv.id]}
                              disabled={!bound}
                              title={us != null ? `${us} µs` : "non câblé"}
                              onChange={(e) => setDeg(row.id, sv.id, Number(e.target.value))}
                            />
                          </td>
                        );
                      })}
                      <td className="scs-col-t">
                        <input
                          type="number"
                          min={0}
                          step={10}
                          className="scs-t"
                          placeholder={`auto (${feasibleTimes[i]})`}
                          value={row.timeMs ?? ""}
                          title={`Temps faisable ≈ ${feasibleTimes[i]} ms`}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRowTime(row.id, v === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));
                          }}
                        />
                      </td>
                      <td className="scs-col-act scs-actions">
                        <button type="button" onClick={() => moveRow(row.id, -1)} disabled={i === 0} title="Monter">
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveRow(row.id, 1)}
                          disabled={i === rows.length - 1}
                          title="Descendre"
                        >
                          ↓
                        </button>
                        <button type="button" onClick={() => addRowAfter(i)} title="Insérer une ligne">
                          ＋
                        </button>
                        <button type="button" onClick={() => removeRow(row.id)} title="Supprimer la ligne">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
