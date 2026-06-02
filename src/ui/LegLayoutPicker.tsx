import type { LegLayout } from "../model/hexapod";

/** Sélecteur de disposition des pattes : étoile (angles variés) ou rectiligne. */
export function LegLayoutPicker({ value, onChange }: { value: LegLayout; onChange: (l: LegLayout) => void }) {
  return (
    <div className="leg-layout-picker">
      {(["star", "linear"] as LegLayout[]).map((layout) => (
        <button
          key={layout}
          type="button"
          className={`leg-layout-btn${value === layout ? " active" : ""}`}
          onClick={() => onChange(layout)}
        >
          <svg viewBox="0 0 60 40" className="leg-layout-svg" aria-hidden="true">
            <rect x="20" y="12" width="20" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            {layout === "star" ? (
              <>
                <line x1="20" y1="16" x2="9"  y2="5"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="20" y1="20" x2="6"  y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="20" y1="24" x2="9"  y2="35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="40" y1="16" x2="51" y2="5"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="40" y1="20" x2="54" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="40" y1="24" x2="51" y2="35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </>
            ) : (
              <>
                <line x1="20" y1="15" x2="6"  y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="20" y1="20" x2="6"  y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="20" y1="25" x2="6"  y2="25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="40" y1="15" x2="54" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="40" y1="20" x2="54" y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="40" y1="25" x2="54" y2="25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </>
            )}
          </svg>
          <span>{layout === "star" ? "Étoile" : "Rectiligne"}</span>
        </button>
      ))}
    </div>
  );
}
