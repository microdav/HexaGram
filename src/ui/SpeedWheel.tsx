import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';

/** Plage de vitesse partagée (lecture séquenceur + exécution salle) : ×0,1 → ×20,0. */
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 20;

const INT_VALUES = Array.from({ length: 21 }, (_, i) => i); // 0..20
const DEC_VALUES = Array.from({ length: 10 }, (_, i) => i); // 0..9
/** Voisins affichés de part et d'autre de la valeur centrée. */
const VISIBLE = 2;
/** Hauteur d'une ligne (doit suivre `.wheel-row` dans le CSS). */
const ROW_H = 22;

function clampSpeed(v: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
}

/** Décompose une vitesse en partie entière + dixième, après bornage. */
function splitSpeed(v: number): { int: number; dec: number } {
  const c = clampSpeed(v);
  const int = Math.floor(c + 1e-9);
  const dec = Math.round((c - int) * 10);
  return dec >= 10 ? { int: int + 1, dec: 0 } : { int, dec };
}

/** Libellé compact « 1,0 » / « 0,1 » / « 20,0 ». */
function fmtSpeed(v: number): string {
  const { int, dec } = splitSpeed(v);
  return `${int},${dec}`;
}

/** Colonne de défilement (molette / glisser / flèches) façon roulette. */
function WheelColumn({
  values,
  index,
  onIndex,
  ariaLabel,
}: {
  values: number[];
  index: number;
  onIndex: (i: number) => void;
  ariaLabel: string;
}) {
  const drag = useRef<{ startY: number; startIdx: number } | null>(null);
  const clampIdx = (i: number) => Math.max(0, Math.min(values.length - 1, i));

  const onWheel = (e: ReactWheelEvent) => {
    e.preventDefault();
    onIndex(clampIdx(index + (e.deltaY > 0 ? 1 : -1)));
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startIdx: index };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const steps = Math.round((d.startY - e.clientY) / ROW_H); // vers le haut → valeur plus grande
    onIndex(clampIdx(d.startIdx + steps));
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    drag.current = null;
  };

  const rows = [];
  for (let off = -VISIBLE; off <= VISIBLE; off++) {
    const i = index + off;
    const inRange = i >= 0 && i < values.length;
    rows.push(
      <div
        key={off}
        className={`wheel-row${off === 0 ? ' wheel-row--sel' : ''}`}
        data-off={Math.abs(off)}
      >
        {inRange ? values[i] : ''}
      </div>,
    );
  }

  return (
    <div
      className="wheel-col"
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={values[0]}
      aria-valuemax={values[values.length - 1]}
      aria-valuenow={values[index]}
      tabIndex={0}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          onIndex(clampIdx(index - 1));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          onIndex(clampIdx(index + 1));
        }
      }}
    >
      {rows}
    </div>
  );
}

/**
 * Sélecteur de vitesse : un libellé « ×1,0 » qui, au clic (ou tap tablette),
 * ouvre une popin « roulette » à deux colonnes (entier, dixième) séparées par
 * une virgule. Chaque colonne défile à la molette ou au glissement du doigt.
 * Bornes ×0,1 → ×20,0. Partagé séquenceur / salle d'exécution.
 */
export function SpeedWheel({
  value,
  onChange,
  title = 'Vitesse',
}: {
  value: number;
  onChange: (v: number) => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const { int, dec } = splitSpeed(value);
  const setInt = (newInt: number) => onChange(clampSpeed(newInt + dec / 10));
  const setDec = (newDec: number) => onChange(clampSpeed(int + newDec / 10));

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const popW = 120;
      const left = Math.max(8, Math.min(window.innerWidth - popW - 8, r.left));
      setPos({ left, top: r.bottom + 4 });
    }
    setOpen(true);
  };

  // Fermeture sur clic extérieur / Échap (la popin est un portal)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !triggerRef.current?.contains(t)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`speed-wheel-trigger${open ? ' active' : ''}`}
        onClick={toggle}
        title={`${title} — cliquer pour régler`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        ×{fmtSpeed(value)}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="speed-pop"
            role="dialog"
            aria-label={title}
            // eslint-disable-next-line react/forbid-component-props
            style={{ '--sp-left': `${pos.left}px`, '--sp-top': `${pos.top}px` } as CSSProperties}
          >
            <div className="speed-wheel">
              <span className="speed-wheel-mult" aria-hidden="true">×</span>
              <WheelColumn values={INT_VALUES} index={int} onIndex={setInt} ariaLabel={`${title}, partie entière`} />
              <span className="speed-wheel-sep" aria-hidden="true">,</span>
              <WheelColumn values={DEC_VALUES} index={dec} onIndex={setDec} ariaLabel={`${title}, dixièmes`} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
