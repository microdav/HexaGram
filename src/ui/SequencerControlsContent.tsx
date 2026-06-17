import { useSequencerStore } from '../store/useSequencerStore';
import { SpeedWheel } from './SpeedWheel';

export function SequencerControlsContent() {
  const steps = useSequencerStore((s) => s.steps);
  const isPlaying = useSequencerStore((s) => s.isPlaying);
  const isPaused = useSequencerStore((s) => s.isPaused);
  const playError = useSequencerStore((s) => s.playError);
  const playbackSpeed = useSequencerStore((s) => s.playbackSpeed);
  const loop = useSequencerStore((s) => s.loop);

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
      <SpeedWheel
        value={playbackSpeed}
        onChange={(v) => useSequencerStore.getState().setPlaybackSpeed(v)}
        title="Vitesse de lecture"
      />
      <button
        type="button"
        className={`seq-ctrl-btn seq-ctrl-btn--loop${loop ? " is-on" : ""}`}
        onClick={() => useSequencerStore.getState().setLoop(!loop)}
        title={loop ? "Lecture en boucle (cliquer pour jouer une seule fois)" : "Lecture une seule fois (cliquer pour boucler)"}
      >
        🔁
      </button>
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
