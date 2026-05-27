/**
 * Garde des modifications non enregistrées de la page Programmation.
 *
 * Contrairement aux gardes de Conception (pose/étape/profil) qui lisent des
 * stores globaux, le brouillon de programme vit dans l'état local de
 * `ProgramPage`. Cette dernière enregistre ici une fonction de garde tant
 * qu'elle est montée ; App (changement d'onglet) l'appelle sans connaître
 * l'état interne de la page.
 */
type GuardFn = () => Promise<boolean>;

let registered: GuardFn | null = null;

/** Enregistre (ou retire avec `null`) la garde fournie par ProgramPage. */
export function registerProgramGuard(fn: GuardFn | null): void {
  registered = fn;
}

/**
 * Garde à appeler avant tout changement de contexte (sortie de l'onglet
 * Programmation, ouverture d'un autre programme…). Résout `true` si l'appelant
 * peut poursuivre, `false` s'il doit annuler. Sans page montée : `true`.
 */
export function guardProgramEdit(): Promise<boolean> {
  return registered ? registered() : Promise.resolve(true);
}
