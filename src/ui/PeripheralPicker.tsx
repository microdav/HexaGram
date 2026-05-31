import { useEffect, useMemo, useState } from "react";
import {
  PERIPHERAL_CATALOG,
  PERIPHERAL_CATEGORIES,
  type PeripheralCategory,
} from "../model/peripherals";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Ajoute le périphérique du catalogue (la popin reste ouverte pour en ajouter d'autres). */
  onAdd: (specId: string) => void;
}

type Filter = "all" | PeripheralCategory;

/** Popin de recherche dans le référentiel de capteurs/périphériques. */
export function PeripheralPicker({ open, onClose, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PERIPHERAL_CATALOG.filter((p) => {
      if (filter !== "all" && p.category !== filter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.interfaces.some((i) => i.toLowerCase().includes(q))
      );
    });
  }, [query, filter]);

  if (!open) return null;

  const categories = Object.keys(PERIPHERAL_CATEGORIES) as PeripheralCategory[];

  return (
    <div className="periph-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="periph-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Ajouter un capteur ou périphérique"
      >
        <div className="periph-modal-head">
          <h3>Ajouter un capteur / périphérique</h3>
          <button type="button" className="periph-modal-close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="periph-modal-bar">
          <input
            type="text"
            className="periph-search"
            value={query}
            placeholder="Rechercher (nom, description, bus…)"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher un périphérique"
            autoFocus
          />
        </div>

        <div className="periph-filters">
          <button
            type="button"
            className={`periph-filter${filter === "all" ? " active" : ""}`}
            onClick={() => setFilter("all")}
          >
            Tous
          </button>
          {categories.map((c) => (
            <button
              type="button"
              key={c}
              className={`periph-filter${filter === c ? " active" : ""}`}
              onClick={() => setFilter(c)}
            >
              {PERIPHERAL_CATEGORIES[c].icon} {PERIPHERAL_CATEGORIES[c].label}
            </button>
          ))}
        </div>

        <div className="periph-results">
          {results.length === 0 && <div className="periph-empty">Aucun résultat.</div>}
          {results.map((p) => (
            <div className="periph-item" key={p.id}>
              <span className="periph-item-icon" aria-hidden="true">
                {p.icon}
              </span>
              <div className="periph-item-text">
                <div className="periph-item-name">{p.name}</div>
                <div className="periph-item-desc">{p.description}</div>
              </div>
              <span className="periph-item-bus">{p.interfaces.join(" · ")}</span>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onAdd(p.id)}>
                + Ajouter
              </button>
            </div>
          ))}
        </div>

        <div className="periph-modal-foot">
          <span className="periph-hint">Ajoutez plusieurs éléments, puis fermez.</span>
          <button type="button" className="btn" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
