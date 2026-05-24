import type { ComponentType } from 'react';
import { useToolboxStore } from '../store/useToolboxStore';
import type { PanelSide } from '../store/useToolboxStore';
import { Toolbox } from './Toolbox';
import { GeometryContent, CogContent } from './GeometryPanel';
import { ServoGroupContent } from './ServoPanel';

const ServoLeft = () => <ServoGroupContent side="left" />;
const ServoRight = () => <ServoGroupContent side="right" />;

const REGISTRY: Record<string, { title: string; Content: ComponentType }> = {
  geometry:       { title: 'Géométrie',        Content: GeometryContent },
  cog:            { title: 'Centre de gravité', Content: CogContent },
  'servos-left':  { title: 'Servos gauche',     Content: ServoLeft },
  'servos-right': { title: 'Servos droite',     Content: ServoRight },
};

export function ToolboxSlot({ panel }: { panel: PanelSide }) {
  const configs = useToolboxStore((s) => s.configs);
  const draggingId = useToolboxStore((s) => s.draggingId);
  const hoveredPanel = useToolboxStore((s) => s.hoveredPanel);

  const docked = Object.entries(configs)
    .filter(([, c]) => c.panel === panel)
    .sort(([, a], [, b]) => a.order - b.order);

  return (
    <>
      {docked.map(([id]) => {
        const reg = REGISTRY[id];
        if (!reg) return null;
        const { Content } = reg;
        return (
          <Toolbox key={id} id={id} title={reg.title}>
            <Content />
          </Toolbox>
        );
      })}
      {draggingId && (
        <div className={`dock-zone${hoveredPanel === panel ? ' dock-zone-active' : ''}`}>
          Déposer ici
        </div>
      )}
    </>
  );
}

export function FloatingToolboxes() {
  const configs = useToolboxStore((s) => s.configs);

  return (
    <>
      {Object.entries(configs)
        .filter(([, c]) => c.panel === null)
        .map(([id]) => {
          const reg = REGISTRY[id];
          if (!reg) return null;
          const { Content } = reg;
          return (
            <Toolbox key={id} id={id} title={reg.title}>
              <Content />
            </Toolbox>
          );
        })}
    </>
  );
}
