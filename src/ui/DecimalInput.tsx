import { useEffect, useState } from "react";

interface Props {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  id?: string;
}

/**
 * Saisie d'un nombre décimal robuste à la locale du clavier (FR).
 *
 * `<input type="number">` est validé selon la locale du navigateur : en FR il
 * attend « , » et ignore le « . » du pavé numérique (et inversement). On utilise
 * donc un champ texte `inputMode="decimal"` qui accepte indifféremment « . » et
 * « , », et on conserve la frappe brute (« 7. », « 7, ») pour ne pas bloquer la
 * saisie des décimales. La valeur remontée est toujours un nombre (séparateur
 * normalisé en point) ou null si le champ est vide.
 */
export function DecimalInput({ value, onChange, placeholder, className, ariaLabel, id }: Props) {
  const [text, setText] = useState(value == null ? "" : String(value));

  // Resynchronise l'affichage quand la valeur externe change réellement (ex.
  // changement de projet/alim), sans écraser une frappe en cours comme « 7. ».
  useEffect(() => {
    const local = text.trim().replace(",", ".");
    const localNum = local === "" ? null : Number.isFinite(Number(local)) ? Number(local) : null;
    if (localNum !== value) setText(value == null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handle = (raw: string) => {
    // N'autorise que chiffres, séparateurs décimaux et signe ; « , » → « . ».
    const filtered = raw.replace(/[^0-9.,-]/g, "");
    setText(filtered);
    const norm = filtered.replace(",", ".");
    if (norm === "" || norm === "-" || norm === "." || norm === "-.") {
      onChange(null);
      return;
    }
    const n = Number(norm);
    if (Number.isFinite(n)) onChange(n);
  };

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      className={className}
      aria-label={ariaLabel}
      onChange={(e) => handle(e.target.value)}
    />
  );
}
