import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { useProjectStore } from "../store/useProjectStore";
import { useSerialStore } from "../store/useSerialStore";
import { useToastStore } from "../store/useToastStore";
import { useSavedSequencesStore } from "../store/useSavedSequencesStore";
import {
  useSequencerStore,
  buildInterpolated,
  type SequencerStep,
} from "../store/useSequencerStore";
import {
  SERVO_COUNT,
  defaultBinding,
  protocolForController,
  resolveHardwareSpecs,
  type ServoBinding,
} from "../model/electronics";
import { buildSequenceScript } from "../model/sequenceScript";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Sous-onglet « Séquence » : choisit une séquence enregistrée, reconstruit ses
 * images (étapes définies + interpolées) et propose le script de commandes à
 * envoyer à la carte de contrôle des servos. Le script est éditable, copiable et
 * directement transmissible (ligne par ligne, en respectant la durée T).
 */
export function ElectroSequencePanel() {
  const activeProject = useProjectStore((s) => s.activeProject);
  const sequences = useSavedSequencesStore((s) => s.sequences);
  const activeSequenceId = useSavedSequencesStore((s) => s.activeSequenceId);
  const stepDelay = useSequencerStore((s) => s.stepDelay);
  const status = useSerialStore((s) => s.status);
  const sendRaw = useSerialStore((s) => s.sendRaw);
  const waitUntilIdle = useSerialStore((s) => s.waitUntilIdle);
  const showToast = useToastStore((s) => s.show);

  const connected = status === "connected";

  // ── Sélection de séquence + chargement de ses étapes définies ───────────────
  const [seqId, setSeqId] = useState<string>("");
  const [seqName, setSeqName] = useState<string>("");
  const [defined, setDefined] = useState<SequencerStep[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Options de génération ───────────────────────────────────────────────────
  // Par défaut : étapes définies seules + T généreux. Mode le plus sûr pour un
  // robot lourd — une commande par pose, déplacement lent et synchronisé par la
  // carte (le SSC-32U interpole lui-même sur la durée T), sans saturer la liaison
  // série. L'interpolation logicielle (40 img/s) sert surtout à l'aperçu 3D.
  const [includeInterpolated, setIncludeInterpolated] = useState(false);
  const [loop, setLoop] = useState(false);
  const [comments, setComments] = useState(true);
  const [moveTimeMs, setMoveTimeMs] = useState(1500);
  // Synchro Q : enchaîner sur la fin réelle du mouvement plutôt qu'un délai aveugle.
  const [syncQ, setSyncQ] = useState(true);

  // ── Script généré (éditable) ────────────────────────────────────────────────
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [sending, setSending] = useState(false);
  const abortRef = useRef(false);

  // Charge la liste des séquences à l'affichage et pré-sélectionne l'active.
  useEffect(() => {
    useSavedSequencesStore.getState().list().catch(() => {});
  }, []);
  useEffect(() => {
    if (!seqId && activeSequenceId) setSeqId(activeSequenceId);
  }, [activeSequenceId, seqId]);

  // Récupère les étapes définies de la séquence choisie.
  useEffect(() => {
    if (!seqId) {
      setDefined([]);
      setSeqName("");
      return;
    }
    let cancelled = false;
    setLoadError(null);
    useSavedSequencesStore
      .getState()
      .getSequence(seqId)
      .then((seq) => {
        if (cancelled) return;
        setDefined(seq.steps.filter((st) => st.type !== "interpolated"));
        setSeqName(seq.name);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Chargement impossible");
        setDefined([]);
      });
    return () => {
      cancelled = true;
    };
  }, [seqId]);

  // Contexte matériel : liaisons + specs + protocole de la carte contrôleur.
  const hw = useMemo(() => {
    const hardware = activeProject?.hardware;
    const electronics = hardware?.electronics ?? null;
    const bindings: Record<number, ServoBinding> = {};
    for (let id = 0; id < SERVO_COUNT; id++) {
      bindings[id] = electronics?.bindings?.[id] ?? defaultBinding(id);
    }
    const specs = resolveHardwareSpecs({
      servoTypeId: hardware?.servoTypeId ?? null,
      servoControllerId: hardware?.servoControllerId ?? null,
      customServoTypes: hardware?.customServoTypes ?? [],
    });
    const protocol = protocolForController(hardware?.servoControllerId ?? null);
    return { bindings, servo: specs.servo, controller: specs.controller, protocol };
  }, [activeProject?.hardware]);

  // Images de la séquence : définies seules ou définies + interpolées.
  const frames = useMemo<SequencerStep[]>(() => {
    if (!includeInterpolated || defined.length < 2) return defined.slice();
    const full = buildInterpolated(defined, stepDelay);
    if (loop) return full;
    // Sans bouclage : on retire les images interpolées de retour vers l'étape 1
    // (celles situées après la dernière étape définie).
    let lastDefined = -1;
    for (let i = 0; i < full.length; i++) {
      if (full[i].type !== "interpolated") lastDefined = i;
    }
    return full.slice(0, lastDefined + 1);
  }, [defined, includeInterpolated, loop, stepDelay]);

  // Métadonnées du dernier script généré (compteurs affichés).
  const built = useMemo(
    () =>
      buildSequenceScript(
        frames,
        { moveTimeMs, comments, sequenceName: seqName || "Séquence" },
        {
          bindings: hw.bindings,
          servo: hw.servo,
          controller: hw.controller,
          protocolId: hw.protocol.id,
        }
      ),
    [frames, moveTimeMs, comments, seqName, hw]
  );

  // (Re)génère le texte de l'éditeur tant que l'utilisateur ne l'a pas édité.
  // Toute modification d'option régénère et réinitialise l'édition manuelle.
  useEffect(() => {
    setText(seqId ? built.text : "");
    setDirty(false);
  }, [built.text, seqId]);

  const definedCount = defined.length;
  const interpCount = Math.max(0, built.frameCount - definedCount);
  const terminator = hw.protocol.id === "ssc32u" ? "\r" : "\n";
  // Synchro Q possible seulement si le protocole sait répondre « mouvement ? ».
  const canSync = !!hw.protocol.queryMove;

  const regenerate = () => {
    setText(seqId ? built.text : "");
    setDirty(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Script copié dans le presse-papier");
    } catch {
      showToast("Copie impossible");
    }
  };

  // Envoi ligne par ligne : on saute commentaires/lignes vides, ajoute le
  // terminateur du protocole, puis patiente la durée T (ou moveTimeMs par défaut).
  const handleSend = async () => {
    if (!connected || sending) return;
    const lines = text.split("\n");
    abortRef.current = false;
    setSending(true);
    try {
      for (const raw of lines) {
        if (abortRef.current) break;
        const line = raw.trim();
        if (!line || line.startsWith(";") || line.startsWith("//")) continue;
        await sendRaw(line + terminator);
        const m = /\bT(\d+)/.exec(line);
        const wait = m ? Number(m[1]) : moveTimeMs;
        if (syncQ && canSync) {
          // Attendre la fin réelle du mouvement (Q), plafonné pour ne jamais bloquer.
          await waitUntilIdle(wait + 800);
        } else if (wait > 0) {
          await sleep(wait);
        }
      }
      if (!abortRef.current) showToast("Séquence transmise à la carte");
    } finally {
      setSending(false);
    }
  };

  const handleStop = () => {
    abortRef.current = true;
  };

  return (
    <div className="electro-seq">
      <section className="electro-seq-head">
        <label className="electro-baud electro-seq-pick">
          Séquence
          <select value={seqId} onChange={(e) => setSeqId(e.target.value)}>
            <option value="">— Choisir une séquence —</option>
            {sequences.map((sq) => (
              <option key={sq.id} value={sq.id}>
                {sq.name}
              </option>
            ))}
          </select>
        </label>

        <label className="electro-seq-opt">
          <input
            type="checkbox"
            checked={includeInterpolated}
            onChange={(e) => setIncludeInterpolated(e.target.checked)}
          />
          Inclure les étapes interpolées
        </label>
        <label className="electro-seq-opt" title="Ajoute le retour interpolé vers l'étape 1">
          <input
            type="checkbox"
            checked={loop}
            disabled={!includeInterpolated}
            onChange={(e) => setLoop(e.target.checked)}
          />
          Boucler vers l'étape 1
        </label>
        <label className="electro-seq-opt">
          <input
            type="checkbox"
            checked={comments}
            onChange={(e) => setComments(e.target.checked)}
          />
          Commentaires
        </label>
        <label
          className="electro-seq-opt"
          title={
            canSync
              ? "Enchaîne chaque pas sur la fin réelle du mouvement (requête Q), au lieu d'un délai aveugle"
              : "Ce protocole ne renvoie pas l'état de mouvement (Q) : envoi temporisé"
          }
        >
          <input
            type="checkbox"
            checked={syncQ && canSync}
            disabled={!canSync}
            onChange={(e) => setSyncQ(e.target.checked)}
          />
          Synchroniser sur Q
        </label>
        <label className="electro-baud electro-seq-time">
          Durée T (ms)
          <input
            type="number"
            min={0}
            step={5}
            value={moveTimeMs}
            onChange={(e) => setMoveTimeMs(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          />
        </label>
      </section>

      {sequences.length === 0 && (
        <div className="electro-banner electro-banner--info">
          Aucune séquence enregistrée. Créez-en une dans l'onglet Conception (séquenceur), puis
          revenez ici pour générer son script.
        </div>
      )}

      {loadError && <div className="electro-banner electro-banner--warn">{loadError}</div>}

      {seqId && (
        <div className="electro-seq-meta">
          <span>
            <strong>{definedCount}</strong> étape{definedCount > 1 ? "s" : ""} définie
            {definedCount > 1 ? "s" : ""}
          </span>
          <span>
            <strong>{interpCount}</strong> interpolée{interpCount > 1 ? "s" : ""}
          </span>
          <span>
            <strong>{built.frameCount}</strong> image{built.frameCount > 1 ? "s" : ""} au total
          </span>
          <span>
            <strong>{built.channelCount}</strong> canal{built.channelCount > 1 ? "ux" : ""} câblé
            {built.channelCount > 1 ? "s" : ""}
          </span>
          <span>
            durée ≈ <strong>{(built.totalMs / 1000).toFixed(1)} s</strong>
          </span>
          {includeInterpolated && (
            <span className="electro-seq-meta-note">
              interpolation basée sur le délai d'étape du séquenceur ({stepDelay.toFixed(2)} s)
            </span>
          )}
        </div>
      )}

      <section className="electro-globals">
        <button type="button" className="btn" onClick={regenerate} disabled={!seqId}>
          Régénérer le script
        </button>
        <button type="button" className="btn" onClick={() => void handleCopy()} disabled={!text}>
          📋 Copier
        </button>
        {sending ? (
          <button type="button" className="btn btn-danger" onClick={handleStop}>
            ⏹ Arrêter l'envoi
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSend()}
            disabled={!connected || !text || built.channelCount === 0}
            title={connected ? "Transmettre le script à la carte" : "Connectez la carte (USB) pour envoyer"}
          >
            ▶ Envoyer à la carte
          </button>
        )}
        <span className="electro-hint">
          {dirty ? "Script modifié manuellement — « Régénérer » pour repartir de la séquence. " : ""}
          L'envoi transmet chaque ligne de mouvement (commentaires ignorés) en patientant la durée T.
        </span>
      </section>

      <div className="electro-seq-editor">
        <CodeMirror
          value={text}
          height="100%"
          theme={oneDark}
          onChange={(v) => {
            setText(v);
            setDirty(true);
          }}
          placeholder="Sélectionnez une séquence pour générer le script de commandes."
        />
      </div>
    </div>
  );
}
