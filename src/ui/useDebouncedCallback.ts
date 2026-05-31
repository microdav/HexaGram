import { useCallback, useEffect, useRef } from "react";

/**
 * Renvoie une version « anti-rebond » de `fn` : les appels rapprochés sont
 * regroupés et `fn` n'est exécutée qu'après `delay` ms sans nouvel appel. Le
 * dernier jeu d'arguments l'emporte. Un appel en attente est exécuté (flush) au
 * démontage, pour ne pas perdre la dernière saisie si l'on quitte la vue.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number
): (...args: A) => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgs = useRef<A | null>(null);

  const debounced = useCallback(
    (...args: A) => {
      lastArgs.current = args;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        if (lastArgs.current) fnRef.current(...lastArgs.current);
      }, delay);
    },
    [delay]
  );

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        if (lastArgs.current) fnRef.current(...lastArgs.current);
      }
    },
    []
  );

  return debounced;
}
