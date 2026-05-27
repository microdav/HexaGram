import { useEffect, useRef } from "react";
import { useConfirmStore } from "../store/useConfirmStore";

/**
 * Modal de confirmation global. À monter une seule fois en haut de l'App.
 * Déclenché par `confirmDialog(...)` depuis n'importe où.
 */
export function ConfirmDialog() {
  const pending = useConfirmStore((s) => s.pending);
  const resolve = useConfirmStore((s) => s.resolve);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolve("cancel");
      if (e.key === "Enter") resolve("confirm");
    };
    window.addEventListener("keydown", handler);
    // Focus le bouton "Confirmer" pour permettre la validation au clavier
    setTimeout(() => confirmBtnRef.current?.focus(), 30);
    return () => window.removeEventListener("keydown", handler);
  }, [pending, resolve]);

  if (!pending) return null;

  const { options } = pending;
  const lines = Array.isArray(options.message) ? options.message : [options.message];
  const variantClass = options.variant === "danger" ? " confirm-dialog-danger" : "";

  return (
    <div className="confirm-dialog-backdrop" onClick={() => resolve("cancel")}>
      <div className={`confirm-dialog${variantClass}`} onClick={(e) => e.stopPropagation()}>
        {options.title && <div className="confirm-dialog-title">{options.title}</div>}
        <div className="confirm-dialog-body">
          {lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="confirm-dialog-btn"
            onClick={() => resolve("cancel")}
          >
            {options.cancelLabel ?? "Annuler"}
          </button>
          {options.discardLabel && (
            <button
              type="button"
              className="confirm-dialog-btn confirm-dialog-btn-discard"
              onClick={() => resolve("discard")}
            >
              {options.discardLabel}
            </button>
          )}
          {options.altLabel && (
            <button
              type="button"
              className="confirm-dialog-btn"
              onClick={() => resolve("alt")}
            >
              {options.altLabel}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            className={`confirm-dialog-btn confirm-dialog-btn-primary${options.variant === "danger" ? " confirm-dialog-btn-danger" : ""}`}
            onClick={() => resolve("confirm")}
          >
            {options.confirmLabel ?? "Confirmer"}
          </button>
        </div>
      </div>
    </div>
  );
}
