import { useSequencerStore } from '../store/useSequencerStore';

const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 5, 10];

export function SequencerControlsContent() {
  const steps = useSequencerStore((s) => s.steps);
  const isPlaying = useSequencerStore((s) => s.isPlaying);
  const isPaused = useSequencerStore((s) => s.isPaused);
  const playError = useSequencerStore((s) => s.playError);
  const playbackSpeed = useSequencerStore((s) => s.playbackSpeed);

  const hasSequence = steps.length > 0;

  return (
    <div className="seq-controls">
      <button
        type="button"
        className="seq-ctrl-btn seq-ctrl-btn--play"
        disabled={!hasSequence || isPlaying}
        onClick={() => useSequencerStore.getState().play()}
        title={isPaused ? 'Reprendre la séquence' : 'Lancer la séquence'}
      >
        ▶
      </button>
      <button
        type="button"
        className="seq-ctrl-btn seq-ctrl-btn--pause"
        disabled={!hasSequence || !isPlaying}
        onClick={() => useSequencerStore.getState().pause()}
        title="Pause"
      >
        ⏸
      </button>
      <button
        type="button"
        className="seq-ctrl-btn seq-ctrl-btn--stop"
        disabled={!hasSequence || (!isPlaying && !isPaused)}
        onClick={() => useSequencerStore.getState().stop()}
        title="Arrêter la séquence"
      >
        ■
      </button>
      <select
        className="seq-speed-select"
        aria-label="Vitesse de lecture"
        title="Vitesse de lecture"
        value={playbackSpeed}
        onChange={(e) => useSequencerStore.getState().setPlaybackSpeed(Number(e.target.value))}
      >
        {PLAYBACK_SPEEDS.map((v) => (
          <option key={v} value={v}>x{v}</option>
        ))}
      </select>
      {playError && (
        <div
          className="seq-ctrl-error"
          onClick={() => useSequencerStore.getState().setPlayError(null)}
          title="Cliquer pour fermer"
        >
          ⚠ {playError}
        </div>
      )}
    </div>
  );
}
