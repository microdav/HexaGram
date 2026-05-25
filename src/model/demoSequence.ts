import type { SequencerStep } from '../store/useSequencerStore';

// Tripod A = legs 0(L), 2(L), 4(R)   Tripod B = legs 1(L), 3(R), 5(R)
//
// Left legs  (0,1,2) yawDeg=+90 → coxa NEGATIVE = forward (+X), POSITIVE = backward
// Right legs (3,4,5) yawDeg=-90 → coxa POSITIVE = forward (+X), NEGATIVE = backward

const U  = [  0,  20, -30] as const; // Levé (en l'air pendant le swing)
const FL = [-25, -20, -60] as const; // Avant gauche  (coxa négatif = avant)
const FR = [ 25, -20, -60] as const; // Avant droite  (coxa positif = avant)
const BL = [ 25, -20, -60] as const; // Arrière gauche (coxa positif = arrière)
const BR = [-25, -20, -60] as const; // Arrière droite (coxa négatif = arrière)

function pose(
  l0: readonly number[], l1: readonly number[], l2: readonly number[],
  l3: readonly number[], l4: readonly number[], l5: readonly number[]
): number[] {
  return [...l0, ...l1, ...l2, ...l3, ...l4, ...l5];
}

// Cycle 4-steps qui boucle proprement (step 4 → step 1 : groupe B passe de arrière → levé)
// Chaque demi-cycle (steps 1-2 ou 3-4) fait avancer le corps d'un pas complet.
export const DEMO_STEPS: SequencerStep[] = [
  {
    id: 'demo-1',
    name: 'A avant — B levé',
    type: 'defined',
    //       L0   L1  L2   L3  L4   L5
    pose: pose(FL,  U,  FL,  U,  FR,  U),
  },
  {
    id: 'demo-2',
    name: 'A pousse — B atterrit avant',
    type: 'defined',
    //       L0   L1   L2   L3   L4   L5
    pose: pose(BL,  FL,  BL,  FR,  BR,  FR),
  },
  {
    id: 'demo-3',
    name: 'A levé — B avant',
    type: 'defined',
    //       L0  L1   L2  L3   L4  L5
    pose: pose(U,  FL,  U,  FR,  U,  FR),
  },
  {
    id: 'demo-4',
    name: 'B pousse — A atterrit avant',
    type: 'defined',
    //       L0   L1   L2   L3   L4   L5
    pose: pose(FL,  BL,  FL,  BR,  FR,  BR),
  },
];

export const DEMO_SEQUENCE_NAME = 'Démo Tripode';
