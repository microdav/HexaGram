import { type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, children, className }: ModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className={`modal${className ? ` ${className}` : ""}`}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}
