import { create } from "zustand";

export interface ConfirmOptions {
  /** Texte du modal. Une seule chaîne, ou plusieurs lignes via tableau. */
  message: string | string[];
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Variante visuelle (rouge pour les suppressions). */
  variant?: "default" | "danger";
}

interface ConfirmPending {
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  pending: ConfirmPending | null;
  ask: (options: ConfirmOptions) => Promise<boolean>;
  resolve: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  ask: (options) =>
    new Promise<boolean>((resolve) => {
      // Si une confirmation est déjà en attente, on la rejette pour ne pas
      // empiler les modales.
      const current = get().pending;
      if (current) current.resolve(false);
      set({ pending: { options, resolve } });
    }),
  resolve: (ok) => {
    const current = get().pending;
    if (!current) return;
    current.resolve(ok);
    set({ pending: null });
  },
}));

/** Helper synchrone à appeler depuis n'importe où — équivalent à window.confirm stylisé. */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === "string" ? { message: options } : options;
  return useConfirmStore.getState().ask(opts);
}
