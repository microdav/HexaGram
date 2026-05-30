import { poseToDict, dictToPose, arrayToPose, parsePoseJson } from './poseIo';
import type { Pose } from './pose';
import type { LoopTarget, Program, ProgramStep } from './program';
import type { SequencerStep, StepType } from '../store/useSequencerStore';
import type { SavedSequence } from '../store/useSavedSequencesStore';

/**
 * Sérialisation/désérialisation unifiée des trois entités exportables :
 * poses, séquences et programmes graphiques. Toutes les poses sont représentées
 * par un dictionnaire de servos lisible (« Avant gauche - coxa (S0) »), et les
 * enveloppes portent un discriminant `kind` pour l'auto-détection à l'import.
 *
 * L'export d'un programme est *autonome* : les étapes qui référencent une
 * séquence enregistrée (`type:'ref'`) sont résolues et embarquées en
 * `type:'inline'`, ce qui rend le JSON portable hors du projet d'origine.
 */

export type TransferKind = 'pose' | 'sequence' | 'program';

type ServoDict = Record<string, number>;

interface TransferStep {
  id: string;
  name: string;
  type: StepType;
  pose: ServoDict;
}

interface ProgramTransferStep {
  id: string;
  type: 'inline';
  name: string;
  steps: TransferStep[];
}

export interface PoseTransfer {
  kind: 'pose';
  name: string;
  pose: ServoDict;
}

export interface SequenceTransfer {
  kind: 'sequence';
  name: string;
  transitionSpeed: number;
  stepDelay: number;
  steps: TransferStep[];
}

export interface ProgramTransfer {
  kind: 'program';
  name: string;
  initPose: Pose | null;
  initPoseName: string;
  loop: LoopTarget;
  steps: ProgramTransferStep[];
}

// ───────────────────────── Helpers internes ─────────────────────────

let idCounter = 0;
function newId(seed: number): string {
  idCounter += 1;
  return `${seed}-${idCounter.toString(36)}`;
}

function stepToTransfer(st: SequencerStep): TransferStep {
  return {
    id: st.id,
    name: st.name,
    type: (st.type ?? 'defined') as StepType,
    pose: poseToDict(st.pose),
  };
}

/** Reconstruit un SequencerStep depuis une étape de transfert (pose en dict ou tableau). */
function transferToStep(raw: unknown, index: number, seed: number): SequencerStep {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let pose: Pose;
  if (Array.isArray(o.pose)) pose = arrayToPose(o.pose);
  else if (o.pose && typeof o.pose === 'object') pose = dictToPose(o.pose as Record<string, unknown>);
  else pose = dictToPose({});
  return {
    id: typeof o.id === 'string' ? o.id : newId(seed + index),
    name: typeof o.name === 'string' ? o.name : `Étape ${index + 1}`,
    pose,
    type: o.type === 'interpolated' ? 'interpolated' : 'defined',
    sourcePoseId: null,
  };
}

function definedOnly(steps: SequencerStep[]): SequencerStep[] {
  return steps.filter((s) => s.type !== 'interpolated');
}

// ───────────────────────── Export ─────────────────────────

export function poseToTransfer(name: string, pose: Pose): PoseTransfer {
  return { kind: 'pose', name, pose: poseToDict(pose) };
}

export function sequenceToTransfer(
  name: string,
  steps: SequencerStep[],
  transitionSpeed: number,
  stepDelay: number,
): SequenceTransfer {
  return {
    kind: 'sequence',
    name,
    transitionSpeed,
    stepDelay,
    steps: definedOnly(steps).map(stepToTransfer),
  };
}

/**
 * Export autonome d'un programme : chaque étape `ref` est résolue via
 * `resolveSequence` et embarquée en `inline`. `program` doit être le programme
 * complet (avec `steps`), pas un simple résumé.
 */
export async function programToTransfer(
  program: Pick<Program, 'name' | 'initPose' | 'initPoseName' | 'loop' | 'steps'>,
  resolveSequence: (id: string) => Promise<SavedSequence>,
): Promise<ProgramTransfer> {
  const steps: ProgramTransferStep[] = [];
  for (const st of program.steps) {
    if (st.type === 'inline') {
      steps.push({
        id: st.id,
        type: 'inline',
        name: st.name,
        steps: definedOnly(st.steps).map(stepToTransfer),
      });
    } else {
      const seq = await resolveSequence(st.sequenceId);
      steps.push({
        id: st.id,
        type: 'inline',
        name: st.sequenceName || seq.name,
        steps: definedOnly(seq.steps).map(stepToTransfer),
      });
    }
  }
  return {
    kind: 'program',
    name: program.name,
    initPose: program.initPose,
    initPoseName: program.initPoseName,
    loop: program.loop,
    steps,
  };
}

/** Sérialise n'importe quelle enveloppe en JSON indenté. */
export function transferToJson(t: PoseTransfer | SequenceTransfer | ProgramTransfer): string {
  return JSON.stringify(t, null, 2);
}

// ───────────────────────── Import ─────────────────────────

export interface ParsedPose {
  kind: 'pose';
  name: string | null;
  pose: Pose;
}
export interface ParsedSequence {
  kind: 'sequence';
  name: string;
  transitionSpeed: number | null;
  stepDelay: number | null;
  steps: SequencerStep[];
}
/** Données prêtes pour `useProgramsStore.create` (le `profileId` est ajouté par l'appelant). */
export interface ParsedProgram {
  kind: 'program';
  name: string;
  initPose: Pose | null;
  initPoseName: string;
  loop: LoopTarget;
  steps: ProgramStep[];
}
export type ParsedTransfer = ParsedPose | ParsedSequence | ParsedProgram;

function detectKind(data: Record<string, unknown>): TransferKind {
  const k = data.kind;
  if (k === 'pose' || k === 'sequence' || k === 'program') return k;
  if (Array.isArray(data.steps)) {
    const first = data.steps[0] as Record<string, unknown> | undefined;
    const looksLikeProgram =
      data.loop !== undefined ||
      (!!first &&
        (first.type === 'ref' ||
          first.type === 'inline' ||
          Array.isArray(first.steps) ||
          typeof first.sequenceId === 'string'));
    return looksLikeProgram ? 'program' : 'sequence';
  }
  return 'pose';
}

function parseLoop(raw: unknown): LoopTarget {
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (o.type === 'init') return { type: 'init' };
    if (o.type === 'step' && typeof o.stepId === 'string') return { type: 'step', stepId: o.stepId };
  }
  return { type: 'none' };
}

function parseProgramStep(raw: unknown, index: number, seed: number): ProgramStep {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  // Tolérance : on conserve une étape `ref` si elle est fournie telle quelle.
  if (o.type === 'ref' && typeof o.sequenceId === 'string') {
    return {
      id: typeof o.id === 'string' ? o.id : newId(seed + index),
      type: 'ref',
      sequenceId: o.sequenceId,
      sequenceName: typeof o.sequenceName === 'string' ? o.sequenceName : '',
    };
  }
  const inner = Array.isArray(o.steps) ? o.steps : [];
  return {
    id: typeof o.id === 'string' ? o.id : newId(seed + index),
    type: 'inline',
    name: typeof o.name === 'string' ? o.name : `Bloc ${index + 1}`,
    steps: inner.map((s, i) => transferToStep(s, i, seed + index * 1000)),
  };
}

/**
 * Parse un texte JSON et renvoie une enveloppe typée selon le `kind` détecté.
 * Lève une `Error` lisible si le texte n'est pas exploitable.
 */
export function parseTransfer(text: string): ParsedTransfer {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('JSON invalide : ' + (e instanceof Error ? e.message : 'erreur de parsing'));
  }

  // Tableau brut d'angles → pose
  if (Array.isArray(data)) {
    const { name, pose } = parsePoseJson(text);
    return { kind: 'pose', name, pose };
  }
  if (!data || typeof data !== 'object') {
    throw new Error('Le JSON doit être un objet ou un tableau d\'angles.');
  }

  const obj = data as Record<string, unknown>;
  const kind = detectKind(obj);
  const seed = 1_000_000; // graine déterministe (pas de Date.now pour la stabilité des tests)

  if (kind === 'pose') {
    const { name, pose } = parsePoseJson(text);
    return { kind: 'pose', name, pose };
  }

  const rawSteps = Array.isArray(obj.steps) ? obj.steps : [];
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name : null;

  if (kind === 'sequence') {
    if (rawSteps.length === 0) throw new Error('La séquence ne contient aucune étape.');
    return {
      kind: 'sequence',
      name: name ?? 'Séquence importée',
      transitionSpeed: typeof obj.transitionSpeed === 'number' ? obj.transitionSpeed : null,
      stepDelay: typeof obj.stepDelay === 'number' ? obj.stepDelay : null,
      steps: rawSteps.map((s, i) => transferToStep(s, i, seed)),
    };
  }

  // program
  return {
    kind: 'program',
    name: name ?? 'Programme importé',
    initPose: Array.isArray(obj.initPose) ? arrayToPose(obj.initPose) : null,
    initPoseName: typeof obj.initPoseName === 'string' ? obj.initPoseName : '',
    loop: parseLoop(obj.loop),
    steps: rawSteps.map((s, i) => parseProgramStep(s, i, seed)),
  };
}
