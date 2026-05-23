import { useEffect } from "react";
import { useToastStore } from "../store/useToastStore";

const DURATION = 3000;

export function Toast() {
  const message = useToastStore((s) => s.message);
  const hide = useToastStore((s) => s.hide);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(hide, DURATION);
    return () => clearTimeout(id);
  }, [message, hide]);

  if (!message) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
