import { useSequencerStore } from '../store/useSequencerStore';

export function SequencerControlsContent() {
  const steps = useSequencerStore((s) => s.steps);
  const isPlaying = useSequencerStore((s) => s.isPlaying);
  const isPaused = useSequencerStore((s) => s.isPaused);
  const playError = useSequencerStore((s) => s.playError);

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
