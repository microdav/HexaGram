import { useMemo } from "react";
import { Modal } from "./Modal";
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

interface ScsModalProps {
  open: boolean;
  onClose: () => void;
  /** Programme courant (brouillon de la page Programmation) à convertir. */
  program: Pick<Program, "initPose" | "steps"> | null;
  programName?: string;
}

/**
 * Popin « SSC-32 ServoControlleur Séquenceur » (SCS) : vue tabulaire éditable du
 * flux de commandes réellement envoyé à la carte. Colonnes = servos, lignes =
 * trames groupées. Convertit le programme graphique courant, puis joue ligne à
 * ligne en respectant le temps faisable de chaque mouvement.
 */
export function ScsModal({ open, onClose, program, programName }: ScsModalProps) {
  const activeProject = useProjectStore((s) => s.activeProject);
  const status = useSerialStore((s) => s.status);
  const connected = status === "connected";

  const rows = useScsStore((s) => s.rows);
  const playing = useScsStore((s) => s.playing);
  const currentRow = useScsStore((s) => s.currentRow);
  const sourceName = useScsStore((s) => s.sourceName);
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
    <Modal open={open} onClose={onClose} className="scs-modal">
      <h3 className="modal-title">SSC-32 ServoControlleur Séquenceur</h3>

      <div className="scs-toolbar">
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

      <p className="scs-hint">
        Une ligne = une trame envoyée à la carte ; coché = le servo reçoit sa position. La position
        est en degrés (repère servo) ; survolez une cellule pour voir les µs. « T auto » = temps
        physiquement faisable (vitesse servo), respecté à la lecture.
      </p>

      {rows.length === 0 ? (
        <div className="scs-empty">
          Convertissez le programme courant pour générer les lignes réellement envoyées à la carte.
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
                      value={row.name}
                      onChange={(e) => setRowName(row.id, e.target.value)}
                    />
                  </td>
                  {SCS_SERVOS.map((sv) => {
                    const bound = hw.bindings[sv.id]?.channel != null;
                    const us = bound ? scsCellUs(row, sv.id, hw) : null;
                    return (
                      <td key={sv.id} className={`scs-cell${row.send[sv.id] ? " scs-cell-on" : ""}`}>
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
    </Modal>
  );
}
