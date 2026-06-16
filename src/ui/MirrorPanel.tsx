import { useHexapodStore } from "../store/useHexapodStore";
import { useProjectStore, type LegGroup, type LegGroupSens } from "../store/useProjectStore";

// Référence stable : un sélecteur Zustand ne doit jamais renvoyer un nouvel objet
// à chaque rendu (sinon boucle « getSnapshot should be cached »).
const EMPTY_GROUPS: LegGroup[] = [];

export function MirrorPanel() {
  const mirrorEnabled = useHexapodStore((s) => s.mirrorEnabled);
  const setMirrorEnabled = useHexapodStore((s) => s.setMirrorEnabled);
  const bodyTransparent = useHexapodStore((s) => s.bodyTransparent);
  const setBodyTransparent = useHexapodStore((s) => s.setBodyTransparent);
  const linkedGroupId = useHexapodStore((s) => s.linkedGroupId);
  const setLinkedGroupId = useHexapodStore((s) => s.setLinkedGroupId);
  const legGroups = useProjectStore((s) => s.activeProject?.hardware.legGroups ?? EMPTY_GROUPS);
  const updateHardware = useProjectStore((s) => s.updateHardware);

  const linkedGroup = linkedGroupId ? legGroups.find((g) => g.id === linkedGroupId) : undefined;
  const setSens = (sens: LegGroupSens) => {
    if (!linkedGroupId) return;
    void updateHardware({
      legGroups: legGroups.map((g) => (g.id === linkedGroupId ? { ...g, sens } : g)),
    });
  };

  return (
    <div className="panel">
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={mirrorEnabled}
          onChange={(e) => setMirrorEnabled(e.target.checked)}
        />
        <span>Miroir gauche/droite</span>
        <span className="hint">
          {mirrorEnabled
            ? "Les servos symétriques sont liés"
            : "Réglage indépendant de chaque patte"}
        </span>
      </label>

      {/* Lien de groupe : oriente ensemble toutes les pattes d'un groupe (défini
          dans Projet → Groupes de pattes), au-delà du miroir gauche/droite. */}
      <div className="link-group-row">
        <span className="link-group-label">Lier un groupe</span>
        <select
          className="link-group-select"
          value={linkedGroupId ?? ""}
          onChange={(e) => setLinkedGroupId(e.target.value || null)}
          aria-label="Groupe de pattes lié aux déplacements"
        >
          <option value="">— aucun —</option>
          {legGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name || "Groupe"}
            </option>
          ))}
        </select>
        <span className="hint">
          {legGroups.length === 0
            ? "Définissez des groupes dans Projet → Groupes de pattes"
            : linkedGroupId
              ? "Les pattes du groupe s'orientent ensemble"
              : "Bouger une patte du groupe oriente toutes les autres"}
        </span>
      </div>

      {/* Sens du déplacement groupé (visible quand un groupe est lié). */}
      {linkedGroup && (
        <div className="link-group-row">
          <span className="link-group-label">Sens du groupe</span>
          <div className="link-group-sens">
            <label>
              <input
                type="radio"
                name="group-sens"
                checked={(linkedGroup.sens ?? "axis") === "axis"}
                onChange={() => setSens("axis")}
              />
              <span>Axe robot</span>
            </label>
            <label>
              <input
                type="radio"
                name="group-sens"
                checked={linkedGroup.sens === "inverse"}
                onChange={() => setSens("inverse")}
              />
              <span>Inverse</span>
            </label>
          </div>
          <span className="hint">
            {(linkedGroup.sens ?? "axis") === "axis"
              ? "Rotation cohérente selon l'axe du robot (avant/arrière, haut/bas)"
              : "Même angle servo : les pattes opposées partent à l'inverse"}
          </span>
        </div>
      )}

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
    </div>
  );
}
