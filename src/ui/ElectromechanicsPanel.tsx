import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHexapodStore } from '../store/useHexapodStore';
import { useSequencerStore } from '../store/useSequencerStore';
import { computeLegMounts } from '../model/hexapod';
import { estimateTorques, ncmToKgcm } from '../model/torqueEstimator';
import { computeBodyTransform } from '../model/kinematics';
import { findServoType } from '../model/servoTypes';
import type { HexapodGeometry } from '../model/hexapod';
import type { Pose } from '../model/pose';

const DEG_TO_RAD = Math.PI / 180;
const COL_MECA = 'var(--accent)';
const COL_ELEC = '#60a5fa';

interface PowerSample { time: number; powerW: number; }
interface Stats { min: number; avg: number; max: number; }

function statsOf(samples: PowerSample[]): Stats | null {
  if (samples.length === 0) return null;
  const pw = samples.map(s => s.powerW);
  return { min: Math.min(...pw), max: Math.max(...pw), avg: pw.reduce((a, b) => a + b, 0) / pw.length };
}

function buildMecaSeries(
  poses: Pose[], geometry: HexapodGeometry, totalWeightG: number,
  gravityEnabled: boolean, transitionSpeed: number, stepDelay: number
): PowerSample[] {
  if (poses.length < 2 || totalWeightG <= 0) return [];
  const mounts = computeLegMounts(geometry);
  const dur = transitionSpeed + stepDelay;
  return poses.map((pose, i) => {
    const prev = i === 0 ? poses[poses.length - 1] : poses[i - 1];
    const bt = computeBodyTransform(pose, geometry, mounts, gravityEnabled);
    const torques = estimateTorques(pose, geometry, mounts, bt.contacts, totalWeightG);
    let pw = 0;
    for (let s = 0; s < 18; s++) {
      const omega = transitionSpeed > 0 ? Math.abs(pose[s] - prev[s]) * DEG_TO_RAD / transitionSpeed : 0;
      pw += torques[s] * 0.01 * omega;
    }
    return { time: i * dur, powerW: pw };
  });
}

function buildElecSeries(
  poses: Pose[], geometry: HexapodGeometry, totalWeightG: number,
  gravityEnabled: boolean, transitionSpeed: number, stepDelay: number,
  voltage: number, maxKgcm: number, idleA: number, stallA: number
): PowerSample[] {
  if (poses.length < 2 || totalWeightG <= 0) return [];
  const mounts = computeLegMounts(geometry);
  const dur = transitionSpeed + stepDelay;
  return poses.map((pose, i) => {
    const bt = computeBodyTransform(pose, geometry, mounts, gravityEnabled);
    const torques = estimateTorques(pose, geometry, mounts, bt.contacts, totalWeightG);
    let pw = 0;
    for (let s = 0; s < 18; s++) {
      const ratio = Math.min(1, ncmToKgcm(torques[s]) / maxKgcm);
      pw += voltage * (idleA + (stallA - idleA) * ratio);
    }
    return { time: i * dur, powerW: pw };
  });
}

// ── Chart ──────────────────────────────────────────────────────────────
const VW = 260, VH = 90;
const PT = 8, PR = 6, PB = 20, PL = 30;
const CW = VW - PL - PR;
const CH = VH - PT - PB;

function PowerChart({ meca, elec, currentIdx }: {
  meca: PowerSample[]; elec: PowerSample[]; currentIdx: number;
}) {
  const allP = [...meca, ...elec].map(s => s.powerW);
  const maxP = Math.max(...allP, 0.01);
  const refSamples = meca.length > 0 ? meca : elec;
  const maxT = refSamples[refSamples.length - 1]?.time ?? 1;

  const sx = (t: number) => PL + (maxT > 0 ? (t / maxT) * CW : 0);
  const sy = (p: number) => PT + (1 - p / maxP) * CH;
  const mkPath = (s: PowerSample[]) =>
    s.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.time).toFixed(1)},${sy(p.powerW).toFixed(1)}`).join(' ');
  const mkArea = (path: string) =>
    `${path} L${sx(maxT).toFixed(1)},${(PT + CH).toFixed(1)} L${PL},${(PT + CH).toFixed(1)} Z`;

  const mecaPath = mkPath(meca);
  const elecPath = mkPath(elec);
  const cur = currentIdx >= 0 && currentIdx < meca.length ? meca[currentIdx] : null;
  const yTicks = [0, 0.5, 1].map(f => ({ y: sy(f * maxP), v: (f * maxP).toFixed(1) }));
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
      {elec.length > 0 && <>
        <path d={mkArea(elecPath)} fill={COL_ELEC} fillOpacity={0.05} />
        <path d={elecPath} fill="none" stroke={COL_ELEC} strokeWidth={1.5} strokeLinejoin="round" />
      </>}
      {meca.length > 0 && <>
        <path d={mkArea(mecaPath)} fill={COL_MECA} fillOpacity={0.08} />
        <path d={mecaPath} fill="none" stroke={COL_MECA} strokeWidth={1.5} strokeLinejoin="round" />
      </>}
      {cur && (
        <line x1={sx(cur.time)} x2={sx(cur.time)} y1={PT} y2={PT + CH}
          stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="3 2" opacity={0.6} />
      )}
      <text x={8} y={PT + CH / 2} textAnchor="middle" fontSize={7} fill="var(--text-dim)"
        transform={`rotate(-90 8 ${PT + CH / 2})`}>W</text>
    </svg>
  );
}

// ── Info popover ────────────────────────────────────────────────────────
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

function SectionTitle({ variant, label, children }: {
  variant: 'meca' | 'elec'; label: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="perf-section-row">
      <span className={`perf-dot perf-dot--${variant}`} />
      <span className="perf-section-label">{label}</span>
      <button type="button" className="info-btn" onClick={() => setOpen(v => !v)}>i</button>
      {open && <InfoPopover onClose={close}>{children}</InfoPopover>}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────
export function ElectromechanicsContent() {
  const torqueEnabled = useHexapodStore(s => s.torqueEnabled);
  const setTorqueEnabled = useHexapodStore(s => s.setTorqueEnabled);
  const globalServoTypeId = useHexapodStore(s => s.globalServoTypeId);
  const totalWeightG = useHexapodStore(s => s.weightConfig.totalWeightG);
  const gravityEnabled = useHexapodStore(s => s.gravityEnabled);
  const geometry = useHexapodStore(s => s.geometry);

  const steps = useSequencerStore(s => s.steps);
  const transitionSpeed = useSequencerStore(s => s.transitionSpeed);
  const stepDelay = useSequencerStore(s => s.stepDelay);
  const currentStepIndex = useSequencerStore(s => s.currentStepIndex);

  const spec = useMemo(() => findServoType(globalServoTypeId), [globalServoTypeId]);

  const torqueAvailable = !!(spec && totalWeightG && totalWeightG > 0);
  const torqueDisabledReason = !spec
    ? 'Définissez un servo global dans le profil'
    : !totalWeightG
    ? 'Définissez le poids total dans le profil (onglet Matériel)'
    : null;

  const poses = useMemo(() => steps.map(s => s.pose), [steps]);

  const mecaSeries = useMemo(
    () => buildMecaSeries(poses, geometry, totalWeightG ?? 0, gravityEnabled, transitionSpeed, stepDelay),
    [poses, geometry, totalWeightG, gravityEnabled, transitionSpeed, stepDelay]
  );

  const elecSeries = useMemo(() => {
    if (!spec) return [];
    const voltage = spec.torqueKgCm.v7_4 ? 7.4 : 6.0;
    const maxKgcm = spec.torqueKgCm.v7_4 ?? spec.torqueKgCm.v6 ?? 1;
    const idleA = spec.currentMa.idle / 1000;
    const stallA = spec.currentMa.stall / 1000;
    return buildElecSeries(
      poses, geometry, totalWeightG ?? 0, gravityEnabled,
      transitionSpeed, stepDelay, voltage, maxKgcm, idleA, stallA
    );
  }, [spec, poses, geometry, totalWeightG, gravityEnabled, transitionSpeed, stepDelay]);

  const mecaStats = useMemo(() => statsOf(mecaSeries), [mecaSeries]);
  const elecStats = useMemo(() => statsOf(elecSeries), [elecSeries]);

  const canShow = torqueAvailable && mecaSeries.length >= 2;

  return (
    <>
      <label
        className={`toggle-row${!torqueAvailable ? ' toggle-row--disabled' : ''}`}
        title={torqueDisabledReason ?? undefined}
      >
        <input
          type="checkbox"
          checked={torqueEnabled && torqueAvailable}
          disabled={!torqueAvailable}
          onChange={e => setTorqueEnabled(e.target.checked)}
        />
        <span>Couple</span>
        <span className="hint">
          {torqueDisabledReason ?? (torqueEnabled
            ? 'Couples estimés visibles en lecture de séquence'
            : 'Masqué — activer pour voir les couples pendant la lecture')}
        </span>
      </label>

      {torqueEnabled && torqueAvailable && (
        <div className="torque-legend">
          <div className="tl-row"><span className="tl-dot tl-dot--green" /><span>&lt; 40 % — nominal</span></div>
          <div className="tl-row"><span className="tl-dot tl-dot--yellow" /><span>40–65 % — attention</span></div>
          <div className="tl-row"><span className="tl-dot tl-dot--orange" /><span>65–85 % — élevé</span></div>
          <div className="tl-row"><span className="tl-dot tl-dot--red" /><span>&gt; 85 % — critique</span></div>
          <div className="tl-note">% du couple max du servo sélectionné</div>
        </div>
      )}

      <SectionTitle variant="meca" label="Puissance mécanique">
        <p>Puissance utile de sortie : travail fourni pour déplacer les masses contre la gravité.</p>
        <p><code>P = τ × ω</code></p>
        <p>
          • τ : couple gravitationnel estimé (modèle statique simplifié)<br />
          • ω : variation d'angle / durée de transition (rad/s)
        </p>
        <p className="perf-pop-warn">
          ⚠ Un servo maintenant une position sous charge consomme du courant sans travail
          mécanique → sous-estime la réalité. Facteur réel : ×2 à ×4.
        </p>
      </SectionTitle>

      <SectionTitle variant="elec" label="Puissance électrique">
        <p>Consommation estimée de l'ensemble des servomoteurs.</p>
        <p><code>P ≈ V × (I₀ + (Ical − I₀) × τ/τmax)</code></p>
        <p>
          • V : tension d'alimentation du servo<br />
          • I₀ : courant à vide (idle)<br />
          • Ical : courant de cale (stall)<br />
          • τ/τmax : ratio de charge instantané
        </p>
        <p className="perf-pop-warn">
          ⚠ Approximation linéaire moteur DC. N'inclut pas les pertes câblage,
          carte de commande, ni les courants de démarrage.
        </p>
      </SectionTitle>

      {!canShow ? (
        <div className="perf-hint">
          {!torqueAvailable
            ? 'Configurez le servo global et le poids total pour activer'
            : 'Ajoutez au moins 2 étapes à la séquence'}
        </div>
      ) : (
        <>
          <PowerChart meca={mecaSeries} elec={elecSeries} currentIdx={currentStepIndex} />
          <div className="perf-dual-stats">
            {mecaStats && (
              <div className="perf-stat-row">
                <span className="perf-legend-line perf-legend-line--meca" />
                <span className="perf-stat-rowlabel">Méca.</span>
                <span><span className="perf-stat-label">Min </span>{mecaStats.min.toFixed(2)} W</span>
                <span><span className="perf-stat-label">Moy </span>{mecaStats.avg.toFixed(2)} W</span>
                <span><span className="perf-stat-label">Max </span>{mecaStats.max.toFixed(2)} W</span>
              </div>
            )}
            {elecStats && (
              <div className="perf-stat-row">
                <span className="perf-legend-line perf-legend-line--elec" />
                <span className="perf-stat-rowlabel">Élec.</span>
                <span><span className="perf-stat-label">Min </span>{elecStats.min.toFixed(2)} W</span>
                <span><span className="perf-stat-label">Moy </span>{elecStats.avg.toFixed(2)} W</span>
                <span><span className="perf-stat-label">Max </span>{elecStats.max.toFixed(2)} W</span>
              </div>
            )}
          </div>
          <div className="perf-note">Modèle statique · τ×ω (méca.) · V×I(ratio) (élec.)</div>
        </>
      )}
    </>
  );
}
