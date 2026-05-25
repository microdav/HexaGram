import { useMemo } from 'react';
import { useHexapodStore } from '../store/useHexapodStore';
import { useSequencerStore } from '../store/useSequencerStore';
import { computeLegMounts } from '../model/hexapod';
import { estimateTorques } from '../model/torqueEstimator';
import { computeBodyTransform } from '../model/kinematics';
import type { HexapodGeometry } from '../model/hexapod';
import type { Pose } from '../model/pose';

const DEG_TO_RAD = Math.PI / 180;

interface PowerSample {
  time: number;
  powerW: number;
}

function buildPowerSeries(
  poses: Pose[],
  geometry: HexapodGeometry,
  totalWeightG: number,
  gravityEnabled: boolean,
  transitionSpeed: number,
  stepDelay: number
): PowerSample[] {
  if (poses.length < 2 || totalWeightG <= 0) return [];
  const mounts = computeLegMounts(geometry);
  const stepDur = transitionSpeed + stepDelay;
  return poses.map((pose, i) => {
    const prevPose = i === 0 ? poses[poses.length - 1] : poses[i - 1];
    const bt = computeBodyTransform(pose, geometry, mounts, gravityEnabled);
    const torques = estimateTorques(pose, geometry, mounts, bt.contacts, totalWeightG);
    let pw = 0;
    for (let s = 0; s < 18; s++) {
      const omega = transitionSpeed > 0
        ? Math.abs(pose[s] - prevPose[s]) * DEG_TO_RAD / transitionSpeed
        : 0;
      pw += torques[s] * 0.01 * omega; // N·cm × 0.01 → N·m; × rad/s → W
    }
    return { time: i * stepDur, powerW: pw };
  });
}

const VW = 260, VH = 90;
const PAD_T = 8, PAD_R = 6, PAD_B = 20, PAD_L = 30;
const CW = VW - PAD_L - PAD_R;
const CH = VH - PAD_T - PAD_B;

function PowerChart({ samples, currentIdx }: { samples: PowerSample[]; currentIdx: number }) {
  const maxP = Math.max(...samples.map(s => s.powerW), 0.01);
  const maxT = samples[samples.length - 1].time;

  const sx = (t: number) => PAD_L + (maxT > 0 ? (t / maxT) * CW : 0);
  const sy = (p: number) => PAD_T + (1 - p / maxP) * CH;

  const linePts = samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${sx(s.time).toFixed(1)},${sy(s.powerW).toFixed(1)}`)
    .join(' ');

  const area =
    `${linePts} L${sx(maxT).toFixed(1)},${(PAD_T + CH).toFixed(1)} L${PAD_L},${(PAD_T + CH).toFixed(1)} Z`;

  const cur = currentIdx >= 0 && currentIdx < samples.length ? samples[currentIdx] : null;

  const yTicks = [0, 0.5, 1].map(f => ({ y: sy(f * maxP), label: (f * maxP).toFixed(2) }));
  const xTicks = maxT > 0
    ? [0, 0.5, 1].map(f => ({ x: sx(f * maxT), label: (f * maxT).toFixed(1) }))
    : [];

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" className="power-chart-svg">
      {yTicks.map((t, i) => (
        <g key={i}>
          {i > 0 && (
            <line x1={PAD_L} x2={PAD_L + CW} y1={t.y} y2={t.y}
              stroke="var(--border)" strokeWidth={0.5} strokeDasharray="3 2" />
          )}
          <text x={PAD_L - 3} y={t.y + 3} textAnchor="end" fontSize={7} fill="var(--text-dim)">
            {t.label}
          </text>
        </g>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={t.x} y={VH - 4} textAnchor="middle" fontSize={7} fill="var(--text-dim)">
          {t.label}
        </text>
      ))}
      <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={PAD_T + CH} stroke="var(--border)" strokeWidth={1} />
      <line x1={PAD_L} x2={PAD_L + CW} y1={PAD_T + CH} y2={PAD_T + CH} stroke="var(--border)" strokeWidth={1} />
      <path d={area} fill="var(--accent)" fillOpacity={0.07} />
      <path d={linePts} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" />
      {cur && (
        <line
          x1={sx(cur.time)} x2={sx(cur.time)}
          y1={PAD_T} y2={PAD_T + CH}
          stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 2" opacity={0.9}
        />
      )}
      <text
        x={8} y={PAD_T + CH / 2}
        textAnchor="middle" fontSize={7} fill="var(--text-dim)"
        transform={`rotate(-90 8 ${PAD_T + CH / 2})`}
      >W</text>
    </svg>
  );
}

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

  const torqueAvailable = !!(globalServoTypeId && totalWeightG && totalWeightG > 0);
  const torqueDisabledReason = !globalServoTypeId
    ? 'Définissez un servo global dans le profil'
    : !totalWeightG
    ? 'Définissez le poids total dans le profil (onglet Matériel)'
    : null;

  const poses = useMemo(() => steps.map(s => s.pose), [steps]);

  const samples = useMemo(
    () => buildPowerSeries(poses, geometry, totalWeightG ?? 0, gravityEnabled, transitionSpeed, stepDelay),
    [poses, geometry, totalWeightG, gravityEnabled, transitionSpeed, stepDelay]
  );

  const stats = useMemo(() => {
    if (samples.length === 0) return null;
    const powers = samples.map(s => s.powerW);
    return {
      min: Math.min(...powers),
      max: Math.max(...powers),
      avg: powers.reduce((a, b) => a + b, 0) / powers.length,
    };
  }, [samples]);

  const canShowChart = torqueAvailable && samples.length >= 2;

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
          {torqueDisabledReason
            ? torqueDisabledReason
            : torqueEnabled
            ? 'Couples estimés visibles en lecture de séquence'
            : 'Masqué — activer pour voir les couples pendant la lecture'}
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

      <div className="perf-section-title">Puissance mécanique</div>

      {!canShowChart ? (
        <div className="perf-hint">
          {!torqueAvailable
            ? 'Configurez le servo global et le poids total pour activer'
            : 'Ajoutez au moins 2 étapes à la séquence'}
        </div>
      ) : (
        <>
          <PowerChart samples={samples} currentIdx={currentStepIndex} />
          {stats && (
            <div className="perf-stats">
              <span><span className="perf-stat-label">Min </span>{stats.min.toFixed(2)} W</span>
              <span><span className="perf-stat-label">Moy </span>{stats.avg.toFixed(2)} W</span>
              <span><span className="perf-stat-label">Max </span>{stats.max.toFixed(2)} W</span>
            </div>
          )}
          <div className="perf-note">Puissance statique estimée · τ × ω</div>
        </>
      )}
    </>
  );
}
