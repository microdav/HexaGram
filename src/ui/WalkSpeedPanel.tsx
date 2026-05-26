import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHexapodStore } from '../store/useHexapodStore';
import { useSequencerStore } from '../store/useSequencerStore';
import { buildWalkSpeedSeries, computeWalkSpeedStats, type WalkSpeedSample } from '../model/walkSpeed';

const COL_SPEED = '#34d399';
const COL_SLIP = '#f59e0b';
const M_TO_CM = 100;

const VW = 260, VH = 90;
const PT = 8, PR = 6, PB = 20, PL = 30;
const CW = VW - PL - PR;
const CH = VH - PT - PB;

function SpeedChart({ samples, currentIdx }: {
  samples: WalkSpeedSample[]; currentIdx: number;
}) {
  const speeds = samples.map(s => s.speed * M_TO_CM);
  const maxV = Math.max(...speeds, 0.01);
  const maxT = samples[samples.length - 1]?.time ?? 1;

  const sx = (t: number) => PL + (maxT > 0 ? (t / maxT) * CW : 0);
  const sy = (v: number) => PT + (1 - v / maxV) * CH;
  const path = samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${sx(s.time).toFixed(1)},${sy(s.speed * M_TO_CM).toFixed(1)}`)
    .join(' ');
  const area = `${path} L${sx(maxT).toFixed(1)},${(PT + CH).toFixed(1)} L${PL},${(PT + CH).toFixed(1)} Z`;
  const cur = currentIdx >= 0 && currentIdx < samples.length ? samples[currentIdx] : null;
  const yTicks = [0, 0.5, 1].map(f => ({ y: sy(f * maxV), v: (f * maxV).toFixed(1) }));
  const xTicks = [0, 0.5, 1].map(f => ({ x: sx(f * maxT), v: (f * maxT).toFixed(1) }));

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" className="power-chart-svg">
      {yTicks.map((t, i) => (
        <g key={i}>
          {i > 0 && <line x1={PL} x2={PL + CW} y1={t.y} y2={t.y} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="3 2" />}
          <text x={PL - 3} y={t.y + 3} textAnchor="end" fontSize={7} fill="var(--text-dim)">{t.v}</text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={t.x} y={VH - 4} textAnchor="middle" fontSize={7} fill="var(--text-dim)">{t.v}</text>
      ))}
      <line x1={PL} x2={PL} y1={PT} y2={PT + CH} stroke="var(--border)" strokeWidth={1} />
      <line x1={PL} x2={PL + CW} y1={PT + CH} y2={PT + CH} stroke="var(--border)" strokeWidth={1} />
      <path d={area} fill={COL_SPEED} fillOpacity={0.08} />
      <path d={path} fill="none" stroke={COL_SPEED} strokeWidth={1.5} strokeLinejoin="round" />
      {cur && (
        <line x1={sx(cur.time)} x2={sx(cur.time)} y1={PT} y2={PT + CH}
          stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="3 2" opacity={0.6} />
      )}
      <text x={8} y={PT + CH / 2} textAnchor="middle" fontSize={7} fill="var(--text-dim)"
        transform={`rotate(-90 8 ${PT + CH / 2})`}>cm/s</text>
      <text x={PL + CW / 2} y={VH - 1} textAnchor="middle" fontSize={6.5} fill="var(--text-dim)">s</text>
    </svg>
  );
}

function InfoPopover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return <div ref={ref} className="perf-popover">{children}</div>;
}

function SectionTitle({ label, colorStyle, children }: {
  label: string; colorStyle: React.CSSProperties; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="perf-section-row">
      <span className="perf-dot" style={colorStyle} />
      <span className="perf-section-label">{label}</span>
      <button type="button" className="info-btn" onClick={() => setOpen(v => !v)}>i</button>
      {open && <InfoPopover onClose={close}>{children}</InfoPopover>}
    </div>
  );
}

export function WalkSpeedContent() {
  const geometry = useHexapodStore(s => s.geometry);
  const gravityEnabled = useHexapodStore(s => s.gravityEnabled);

  const steps = useSequencerStore(s => s.steps);
  const transitionSpeed = useSequencerStore(s => s.transitionSpeed);
  const stepDelay = useSequencerStore(s => s.stepDelay);
  const currentStepIndex = useSequencerStore(s => s.currentStepIndex);

  const poses = useMemo(() => steps.map(s => s.pose), [steps]);

  const samples = useMemo(
    () => buildWalkSpeedSeries(poses, geometry, gravityEnabled, transitionSpeed, stepDelay),
    [poses, geometry, gravityEnabled, transitionSpeed, stepDelay]
  );

  const stats = useMemo(() => computeWalkSpeedStats(samples), [samples]);
  const canShow = samples.length >= 2;

  const orphanCount = useMemo(() => samples.filter(s => s.anchorCount === 0).length, [samples]);

  return (
    <>
      <SectionTitle label="Vitesse de déplacement" colorStyle={{ background: COL_SPEED }}>
        <p>
          Vitesse instantanée du corps déduite des pattes en contact au sol.
          Entre deux poses, chaque pied <em>ancré</em> (touchant le sol aux deux étapes)
          impose le déplacement du corps qui le maintient immobile :
        </p>
        <p><code>Δcorps = pos_pied(n) − pos_pied(n+1)</code></p>
        <p>
          Vitesse = ‖Δcorps‖ / (transition + délai). Lorsque plusieurs pieds sont
          ancrés, on moyenne ; l'écart entre eux donne le <em>glissement</em>
          (en orange), indicateur de la qualité de la démarche.
        </p>
        <p className="perf-pop-warn">
          ⚠ Hypothèse : sol plat, pieds rigides, pas de glissement.
          Si aucun pied n'est ancré sur une transition (phase aérienne),
          la vitesse y est notée 0.
        </p>
      </SectionTitle>

      {!canShow ? (
        <div className="perf-hint">Ajoutez au moins 2 étapes à la séquence</div>
      ) : (
        <>
          <SpeedChart samples={samples} currentIdx={currentStepIndex} />
          <div className="perf-table-wrap">
            <table className="perf-table">
              <thead>
                <tr>
                  <th>(cm/s)</th>
                  <th>Min</th>
                  <th>Moy</th>
                  <th>Max</th>
                </tr>
              </thead>
              <tbody>
                {stats && (
                  <tr>
                    <td>
                      <span className="perf-table-label">
                        <span className="perf-legend-line" style={{ background: COL_SPEED }} />
                        Instant.
                      </span>
                    </td>
                    <td>{(stats.min * M_TO_CM).toFixed(2)}</td>
                    <td>{(stats.avg * M_TO_CM).toFixed(2)}</td>
                    <td>{(stats.max * M_TO_CM).toFixed(2)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {stats && (
            <div className="perf-table-wrap" style={{ marginTop: 4 }}>
              <table className="perf-table">
                <tbody>
                  <tr>
                    <td>
                      <span className="perf-table-label">Vitesse nette de cycle</span>
                    </td>
                    <td>{(stats.cycleSpeed * M_TO_CM).toFixed(2)} cm/s</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="perf-table-label">Avance par cycle</span>
                    </td>
                    <td>{(stats.cycleDisplacement * M_TO_CM).toFixed(2)} cm</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="perf-table-label" style={{ color: COL_SLIP }}>
                        Glissement moyen
                      </span>
                    </td>
                    <td>{(stats.avgSlip * M_TO_CM).toFixed(2)} cm</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {orphanCount > 0 && (
            <div className="perf-note" style={{ color: COL_SLIP }}>
              {orphanCount} transition{orphanCount > 1 ? 's' : ''} sans pied ancré (phase aérienne) — vitesse forcée à 0
            </div>
          )}
          <div className="perf-note">Modèle cinématique · sans glissement · sol plat</div>
        </>
      )}
    </>
  );
}
