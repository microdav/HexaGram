import { Fragment, type ComponentType } from 'react';
import { useToolboxStore } from '../store/useToolboxStore';
import type { PanelSide } from '../store/useToolboxStore';
import { Toolbox } from './Toolbox';
import { GeometryContent, CogContent } from './GeometryPanel';
import { ServoGroupContent } from './ServoPanel';
import { SimulationContent } from './SimulationPanel';
import { SequencerControlsContent } from './SequencerControlsContent';
import { ElectromechanicsContent } from './ElectromechanicsPanel';
import { WalkSpeedContent } from './WalkSpeedPanel';
import { PhotoSpaceContent } from './PhotoSpacePanel';

const ServoLeft = () => <ServoGroupContent side="left" />;
const ServoRight = () => <ServoGroupContent side="right" />;

const REGISTRY: Record<string, { title: string; Content: ComponentType }> = {
  geometry:          { title: 'Géométrie',                    Content: GeometryContent },
  cog:               { title: 'Centre de gravité',            Content: CogContent },
  simulation:        { title: 'Simulation',                   Content: SimulationContent },
  'servos-left':     { title: 'Servos gauche',                Content: ServoLeft },
  'servos-right':    { title: 'Servos droite',                Content: ServoRight },
  'seq-ctrl':        { title: 'Lecture',                      Content: SequencerControlsContent },
  electromechanics:  { title: 'Performances électroméca.', Content: ElectromechanicsContent },
  'walk-speed':      { title: 'Vitesse de déplacement',       Content: WalkSpeedContent },
  'photo-space':     { title: 'Espace photo',                 Content: PhotoSpaceContent },
};

function InsertMarker({ active }: { active: boolean }) {
  return <div className={`insert-marker${active ? ' active' : ''}`} />;
}

export function ToolboxSlot({ panel }: { panel: PanelSide }) {
  const configs = useToolboxStore((s) => s.configs);
  const draggingId = useToolboxStore((s) => s.draggingId);
  const hoveredPanel = useToolboxStore((s) => s.hoveredPanel);
  const hoveredInsertIndex = useToolboxStore((s) => s.hoveredInsertIndex);

  const docked = Object.entries(configs)
    .filter(([, c]) => c.panel === panel)
    .sort(([, a], [, b]) => a.order - b.order);

  const isDragging = !!draggingId;
  const isHovered = hoveredPanel === panel;
  const compact = panel === 'sequencer';

  return (
    <>
      {isDragging && !compact && (
        <InsertMarker active={isHovered && hoveredInsertIndex === 0} />
      )}
      {docked.map(([id], idx) => {
        const reg = REGISTRY[id];
        if (!reg) return null;
        const { Content } = reg;
        return (
          <Fragment key={id}>
            <Toolbox id={id} title={reg.title} compact={compact}>
              <Content />
            </Toolbox>
            {isDragging && !compact && (
              <InsertMarker active={isHovered && hoveredInsertIndex === idx + 1} />
            )}
          </Fragment>
        );
      })}
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
