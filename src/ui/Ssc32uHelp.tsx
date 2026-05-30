import { Ssc32uSchematic } from "./BoardSvg";

// Panneau d'aide spécifique à la carte Lynxmotion SSC-32U : spécifications,
// branchement / alimentation / cavaliers, procédure de calibrage (USB seul si
// possible) et liste des pièges à éviter.
//
// Sources : documentation officielle Lynxmotion (lynxmotion.com — fiche SSC-32U
// et « Hardware Commands »). Les tensions sont indicatives : toujours vérifier
// la fiche du servo et le manuel PDF (la sérigraphie de la carte fait foi).

const SPECS: Array<[string, string]> = [
  ["Canaux", "32 (4 bancs de 8 — 0–15 sur VS1, 16–31 sur VS2)"],
  ["Impulsion", "500–2500 µs (centre 1500 µs), résolution 1 µs"],
  ["Course servo", "≈ 180°"],
  ["Liaison", "USB (FTDI → port COM virtuel) + série TTL ; socket XBee (sans-fil)"],
  ["Débit série", "9600 (défaut) / 38400 / 115200 — cavaliers BAUD"],
  ["Alim logique (VL)", "auto-sélection : USB, ou VS, ou VL externe (~5–9 V)"],
  ["Alim servos (VS1/VS2)", "selon le servo — typiquement 4,8–6 V (NiMH 5×AA ≈ 6 V)"],
  ["Entrées", "4 entrées statiques A–D (capteurs)"],
  ["Microcontrôleur", "Atmel AVR (firmware SSC-32U)"],
];

const DONTS: string[] = [
  "Ne pas compter sur l'USB pour alimenter les servos : l'USB n'alimente que la logique. Un seul servo en charge tire 1–2,5 A là où l'USB donne ~0,5 A → brown-out, reset, perte du port COM. Les servos exigent une alim VS1/VS2 dédiée.",
  "Ne jamais inverser la polarité +/− sur VS1, VS2 ou VL : destruction immédiate de la carte.",
  "Ne pas dépasser la tension admissible du servo sur VS (souvent 6 V pour un servo standard) — VS = tension servo, pas tension logique.",
  "Garder le cavalier VS1=VS2 UNIQUEMENT si une seule alim servo : avec deux alims séparées sur les deux bancs, le cavalier les met en court-circuit.",
  "Ne pas brancher / débrancher un servo sous tension (hot-plug) : pic de courant et faux contacts.",
  "Respecter le sens du connecteur servo (signal / + / −, sérigraphié) : à l'envers, le servo peut être endommagé.",
  "Ne pas laisser un servo forcer en butée mécanique pendant le réglage : surchauffe et surintensité → coupez le couple (arrêt d'urgence) si ça force.",
];

export function Ssc32uHelp({ controllerId }: { controllerId: string | null }) {
  const isSsc = controllerId === "lynxmotion-ssc-32u";

  return (
    <section className="electro-help">
      <div className="electro-help-title">
        Aide carte — {isSsc ? "Lynxmotion SSC-32U" : "carte de contrôle"}
      </div>

      {!isSsc && (
        <p className="electro-hint">
          Le contrôleur du projet n'est pas un SSC-32U. Cette aide détaillée est rédigée pour la
          SSC-32U (le contrôleur actuellement défini dans votre projet) ; sélectionnez-la dans
          l'onglet Projet → Matériel pour des conseils adaptés.
        </p>
      )}

      <details open>
        <summary>Spécifications techniques</summary>
        <table className="ssc-spec-table">
          <tbody>
            {SPECS.map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <details>
        <summary>Branchement &amp; alimentation</summary>
        <p>
          Trois entrées d'alimentation séparées, sur borniers à vis (chacune avec + et −) :
        </p>
        <ul className="ssc-list">
          <li><strong>VS1</strong> — alimente les servos des voies <strong>0 à 15</strong>.</li>
          <li><strong>VS2</strong> — alimente les servos des voies <strong>16 à 31</strong>.</li>
          <li>
            <strong>VL</strong> — alimente la logique. Sur la SSC-32U la logique est en
            <strong> auto-sélection</strong> (USB, ou VS, ou VL externe) : en pratique l'USB suffit
            pour configurer/tester.
          </li>
        </ul>

        <div className="ssc-schema-wrap">
          <Ssc32uSchematic />
        </div>

        <p className="ssc-note">
          Montage type le plus simple : <strong>USB</strong> pour la logique + une <strong>alim
          servo 6 V</strong> (2–3 A) sur <strong>VS1</strong>, cavalier <strong>VS1=VS2</strong> en
          place pour alimenter les 32 voies depuis une seule source. La masse est commune sur la carte.
        </p>
      </details>

      <details>
        <summary>Cavaliers (jumpers)</summary>
        <ul className="ssc-list">
          <li>
            <strong>VS1=VS2</strong> — relie les deux bancs servo : une seule alim sur VS1
            alimente les 32 voies. À <em>retirer</em> si vous utilisez deux alims distinctes.
          </li>
          <li>
            <strong>Alim logique</strong> — pas de cavalier à poser : la SSC-32U a une
            auto-sélection (gros condensateurs anti-brown-out). Le cavalier VS1=VL de l'ancienne
            SSC-32 n'est plus nécessaire.
          </li>
          <li>
            <strong>BAUD</strong> (2 cavaliers) — sélectionnent 9600 / 38400 / 115200. D'usine =
            <strong> 9600</strong>. Réglez la « Vitesse » ci-dessus sur la même valeur.
          </li>
        </ul>
        <p className="ssc-note">
          La sérigraphie de votre carte fait foi — en cas de doute, consultez le
          {" "}
          <a
            href="https://wiki.lynxmotion.com/info/wiki/lynxmotion/download/servo-erector-set-system/ses-electronics/ses-modules/ssc-32u/WebHome/lynxmotion_ssc-32u_usb_user_guide.pdf"
            target="_blank"
            rel="noopener noreferrer"
          >
            guide utilisateur officiel SSC-32U (PDF)
          </a>.
        </p>
      </details>

      <details>
        <summary>Calibrage des servos — avec ou sans alim externe</summary>
        <p>
          Le but : amener chaque articulation à sa position mécanique « 0 » (segments alignés) pour
          pouvoir monter les palonniers droits, puis mémoriser l'offset.
        </p>
        <p className="ssc-note ssc-note--info">
          <strong>En USB seul (sans alim VS) :</strong> la carte se connecte et accepte les
          commandes (la logique est alimentée par l'USB). Vous pouvez donc déjà <strong>mapper les
          canaux</strong>, vérifier le protocole et préparer la config — <em>mais les servos ne
          bougeront pas</em> tant que VS1/VS2 ne sont pas alimentés. L'USB ne peut pas fournir le
          courant des servos.
        </p>
        <p>
          Procédure conseillée (alim VS 6 V branchée) :
        </p>
        <ol className="ssc-list ssc-list--ol">
          <li>Branchez l'alim servo 6 V sur VS1, cavalier VS1=VS2 en place. Connectez l'USB.</li>
          <li>Connectez la carte ici, vérifiez la vitesse (9600 par défaut).</li>
          <li>Pour chaque servo : « Identifier » pour repérer lequel c'est, ajustez son canal.</li>
          <li>« Centrer » (envoi du 0 logique), puis affinez l'<strong>offset −/+</strong> jusqu'à
            l'alignement mécanique. C'est enregistré automatiquement.</li>
          <li>Montez le palonnier dans l'axe une fois le 0 atteint ; cochez « Inverser » si le sens
            est opposé.</li>
        </ol>
        <p className="ssc-note">
          Astuce sécurité : travaillez <strong>un servo à la fois</strong>, sans charge mécanique,
          et utilisez l'<strong>arrêt d'urgence</strong> si un servo force ou chauffe.
        </p>
      </details>

      <details open>
        <summary className="ssc-dont-summary">⚠ À ne pas faire</summary>
        <ul className="ssc-dont-list">
          {DONTS.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
