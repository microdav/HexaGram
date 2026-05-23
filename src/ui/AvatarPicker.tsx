import { createAvatar } from "@dicebear/core";
import { bottts } from "@dicebear/collection";

export const AVATAR_SEEDS = [
  "hex-01", "hex-02", "hex-03", "hex-04", "hex-05",
  "hex-06", "hex-07", "hex-08", "hex-09", "hex-10",
  "hex-11", "hex-12", "hex-13", "hex-14", "hex-15",
] as const;

export type AvatarSeed = (typeof AVATAR_SEEDS)[number];

function renderSvg(seed: string): string {
  return createAvatar(bottts, { seed }).toString();
}

interface AvatarProps {
  seed: string;
  size?: number;
}

export function AvatarImg({ seed, size = 40 }: AvatarProps) {
  const svg = renderSvg(seed);
  const dataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return <img src={dataUri} width={size} height={size} alt={`avatar ${seed}`} />;
}

interface AvatarPickerProps {
  selected: string;
  onChange: (seed: string) => void;
}

export function AvatarPicker({ selected, onChange }: AvatarPickerProps) {
  return (
    <div className="avatar-grid">
      {AVATAR_SEEDS.map((seed) => (
        <button
          key={seed}
          type="button"
          className={`avatar-tile${selected === seed ? " selected" : ""}`}
          onClick={() => onChange(seed)}
          title={seed}
        >
          <AvatarImg seed={seed} size={48} />
        </button>
      ))}
    </div>
  );
}
