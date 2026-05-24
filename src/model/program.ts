import type { Pose } from './pose';
import type { SequencerStep } from '../store/useSequencerStore';

export interface ProgramStepRef {
  id: string;
  type: 'ref';
  sequenceId: string;
  sequenceName: string;
}

export interface ProgramStepInline {
  id: string;
  type: 'inline';
  name: string;
  steps: SequencerStep[];
}

export type ProgramStep = ProgramStepRef | ProgramStepInline;

export type LoopTarget =
  | { type: 'none' }
  | { type: 'init' }
  | { type: 'step'; stepId: string };

export interface ProgramSummary {
  id: string;
  name: string;
  profileId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Program extends ProgramSummary {
  /** Pose figée au moment de la sélection. null = pose courante au lancement. */
  initPose: Pose | null;
  /** Label affiché : "NomSéquence / NomStep" ou vide si null. */
  initPoseName: string;
  steps: ProgramStep[];
  loop: LoopTarget;
}
