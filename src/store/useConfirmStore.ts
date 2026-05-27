import { create } from "zustand";

/** Résultat d'une confirmation (jusqu'à quatre états). */
export type ConfirmResult = "confirm" | "alt" | "discard" | "cancel";

export interface ConfirmOptions {
  /** Texte du modal. Une seule chaîne, ou plusieurs lignes via tableau. */
  message: string | string[];
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * Libellé d'un troisième bouton "neutre" (ex. "Abandonner"). S'il est défini,
   * le modal devient tri-état et résout `'discard'` quand on clique dessus.
   */
  discardLabel?: string;
  /**
   * Libellé d'un quatrième bouton secondaire (ex. "Nouvelle pose"). S'il est
   * défini, le modal résout `'alt'` quand on clique dessus.
   */
  altLabel?: string;
  /** Variante visuelle (rouge pour les suppressions). */
  variant?: "default" | "danger";
}

interface ConfirmPending {
  options: ConfirmOptions;
  resolve: (r: ConfirmResult) => void;
}

interface ConfirmState {
  pending: ConfirmPending | null;
  /** Confirmation binaire — résout `true` uniquement sur "Confirmer". */
  ask: (options: ConfirmOptions) => Promise<boolean>;
  /** Confirmation multi-état — résout 'confirm' | 'alt' | 'discard' | 'cancel'. */
  askTri: (options: ConfirmOptions) => Promise<ConfirmResult>;
  resolve: (r: ConfirmResult) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  ask: (options) => get().askTri(options).then((r) => r === "confirm"),
  askTri: (options) =>
    new Promise<ConfirmResult>((resolve) => {
      // Si une confirmation est déjà en attente, on l'annule pour ne pas
      // empiler les modales.
      const current = get().pending;
      if (current) current.resolve("cancel");
      set({ pending: { options, resolve } });
    }),
  resolve: (r) => {
    const current = get().pending;
    if (!current) return;
    current.resolve(r);
    set({ pending: null });
  },
}));

/** Helper synchrone à appeler depuis n'importe où — équivalent à window.confirm stylisé. */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === "string" ? { message: options } : options;
  return useConfirmStore.getState().ask(opts);
}

/** Variante multi-état — résout 'confirm' | 'alt' | 'discard' | 'cancel'. */
export function confirmTri(options: ConfirmOptions | string): Promise<ConfirmResult> {
  const opts: ConfirmOptions = typeof options === "string" ? { message: options } : options;
  return useConfirmStore.getState().askTri(opts);
}
