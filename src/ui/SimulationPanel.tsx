import { useState } from "react";
import { useHexapodStore } from "../store/useHexapodStore";
import { useBodyTransform } from "../store/useBodyTransform";
import { computeFootTip } from "../model/kinematics";
import { computeLegMounts, LEG_NAMES, SERVOS } from "../model/hexapod";

export function SimulationContent() {
  const bodyTransparent = useHexapodStore((s) => s.bodyTransparent);
  const setBodyTransparent = useHexapodStore((s) => s.setBodyTransparent);
  const gravityEnabled = useHexapodStore((s) => s.gravityEnabled);
  const geometry = useHexapodStore((s) => s.geometry);
  const pose = useHexapodStore((s) => s.pose);
  const transform = useBodyTransform();
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const handleCopy = async () => {
    const mounts = computeLegMounts(geometry);
    const tipsBody = mounts.map((m) => computeFootTip(m, pose, geometry));
    const tipsWorld = tipsBody.map((p) =>
      p.clone().applyQuaternion(transform.quaternion).add(transform.position)
    );

    const fmt = (n: number, d = 4) => n.toFixed(d);
    const fmtV = (v: { x: number; y: number; z: number }) =>
      `(${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)})`;

    const lines: string[] = [];
    lines.push("# HexaGram — État courant");
    lines.push("");
    lines.push("## Géométrie (m)");
    lines.push(`- Châssis  L×l×h : ${fmt(geometry.chassis.length, 3)} × ${fmt(geometry.chassis.width, 3)} × ${fmt(geometry.chassis.height, 3)}`);
    lines.push(`- Segments coxa/fémur/tibia : ${fmt(geometry.segments.coxa, 3)} / ${fmt(geometry.segments.femur, 3)} / ${fmt(geometry.segments.tibia, 3)}`);
    lines.push(`- CoG offset (body) : ${fmtV(geometry.cog)}`);
    lines.push("");
    lines.push("## Simulation");
    lines.push(`- Gravité : ${gravityEnabled ? "activée" : "désactivée"}`);
    lines.push("");
    lines.push("## Pose (servos, deg)");
    lines.push("| Patte | Coxa | Fémur | Tibia |");
    lines.push("|---|---:|---:|---:|");
    for (let leg = 0; leg < 6; leg++) {
      const c = pose[leg * 3 + 0];
      const f = pose[leg * 3 + 1];
      const t = pose[leg * 3 + 2];
      lines.push(`| ${LEG_NAMES[leg]} | ${c.toFixed(1)} | ${f.toFixed(1)} | ${t.toFixed(1)} |`);
    }
    void SERVOS;
    lines.push("");
    lines.push("## Transform corps (monde)");
    lines.push(`- Position : ${fmtV(transform.position)}`);
    const q = transform.quaternion;
    lines.push(`- Quaternion (x,y,z,w) : (${fmt(q.x)}, ${fmt(q.y)}, ${fmt(q.z)}, ${fmt(q.w)})`);
    lines.push(`- CoG monde : ${fmtV(transform.cogWorld)}`);
    lines.push(`- CoG dans polygone d'appui : ${transform.cogInside ? "OUI (stable)" : "NON (instable / sur arête)"}`);
    lines.push("");
    lines.push("## Bouts de patte (monde)");
    lines.push("| Patte | X | Y | Z | Contact |");
    lines.push("|---|---:|---:|---:|:---:|");
    tipsWorld.forEach((p, i) => {
      const contact = transform.contacts.find((c) => c.legIndex === i);
      lines.push(`| ${LEG_NAMES[i]} | ${fmt(p.x)} | ${fmt(p.y)} | ${fmt(p.z)} | ${contact ? "✓" : ""} |`);
    });
    lines.push("");
    lines.push("## Polygone d'appui (xz monde, ordre hull)");
    if (transform.supportPolygon.length === 0) {
      lines.push("- (vide)");
    } else {
      transform.supportPolygon.forEach((p, i) => {
        lines.push(`- ${i}: (${fmt(p.x)}, ${fmt(p.z)})`);
      });
    }

    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copié !");
    } catch {
      setCopyStatus("Échec (presse-papier)");
    }
    setTimeout(() => setCopyStatus(null), 2000);
  };

  return (
    <>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={bodyTransparent}
          onChange={(e) => setBodyTransparent(e.target.checked)}
        />
        <span>Corps transparent</span>
        <span className="hint">
          {bodyTransparent
            ? "On voit le CoG à travers le châssis"
            : "Châssis opaque"}
        </span>
      </label>

      <button type="button" className="copy-state-btn" onClick={handleCopy}>
        {copyStatus ?? "Copier l'état complet"}
      </button>
    </>
  );
}
