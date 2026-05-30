import { Ssc32uSchematic } from "./BoardSvg";

// Panneau d'aide spécifique à la carte Lynxmotion SSC-32U : spécifications,
// branchement / alimentation / cavaliers, procédure de calibrage (USB seul si
// possible) et liste des pièges à éviter.
//
// Sources : documentation officielle Lynxmotion (lynxmotion.com — fiche SSC-32U
// et « Hardware Commands »). Les tensions sont indicatives : toujours vérifier
// la fiche du servo et le manuel PDF (la sérigraphie de la carte fait foi).

const SPECS: Array<[string, string]> = [
  ["Canaux", "32 servos en 2 sections de 16 (0–15 sur VS1, 16–31 sur VS2), connecteurs groupés par 4"],
  ["Impulsion", "500–2500 µs (centre 1500 µs), résolution 1 µs"],
  ["Course servo", "≈ 180°"],
  ["Liaison", "USB (FTDI → port COM virtuel) + série TTL (TX/RX/G) ; socket XBee (sans-fil)"],
  ["Débit série", "9600 (défaut) / 38400 / 115200 — réglé par le bouton Baud (pas de cavalier)"],
  ["Alim logique", "auto-sélection MAX(VL, VS1) − 0,7 V régulée en 5 V — rien à brancher sur VL tant que VS1 ≥ 5,3 V"],
  ["Alim servos (VS1/VS2)", "selon le servo — typiquement 4,8–6 V (NiMH 5×AA ≈ 6 V)"],
  ["Entrées/sorties", "8 broches A–H (lecture ana/num de capteurs) ; A/B = I2C (SCL/SDA)"],
  ["Microcontrôleur", "Atmel ATmega328P (firmware SSC-32U)"],
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
            <strong>VL</strong> — alimente la logique. La SSC-32U sélectionne <strong>automatiquement</strong>
            la plus haute tension entre VL et VS1 : tant que <strong>VS1 ≥ 5,3 V</strong>, il n'y a
            <strong> rien à brancher sur VL</strong>. On n'alimente VL séparément que pour des cas
            précis (VS1 trop bas à 4,8 V, ou garder la logique vivante quand on coupe la puissance servos).
          </li>
        </ul>

        <div className="ssc-schema-wrap">
          <Ssc32uSchematic />
        </div>

        <p className="ssc-note ssc-note--info">
          ⚠ <strong>L'USB n'alimente pas le microcontrôleur</strong> — uniquement la puce FTDI. Le
          port COM apparaît sur l'ordinateur, mais le cerveau de la carte (ATmega) reste éteint tant
          que <strong>VS1 (ou VL)</strong> n'est pas alimenté. La LED <strong>PWR</strong> ne s'allume
          que lorsque la logique reçoit du courant.
        </p>

        <p className="ssc-note">
          Montage type le plus simple : une seule <strong>alim 6 V</strong> (2–3 A) sur
          <strong> VS1</strong>, cavaliers <strong>VS1=VS2</strong> en place pour alimenter les 32
          voies depuis une seule source ; l'<strong>USB</strong> sert à la communication (port COM).
          La masse est commune sur la carte.
        </p>
      </details>

      <details>
        <summary>Cavaliers (jumpers)</summary>
        <ul className="ssc-list">
          <li>
            <strong>VS1=VS2</strong> (deux cavaliers, <em>posés d'usine</em>) — relient les deux bancs
            servo : une seule alim sur VS1 alimente les 32 voies. Deux cavaliers (et non un) pour
            encaisser le courant. À <em>retirer</em> si vous utilisez deux alims distinctes ; posés,
            alimentez VS1 <em>ou</em> VS2, jamais les deux.
          </li>
          <li>
            <strong>VL=VS</strong> (2 broches à droite du bornier, <em>non posé et non fourni</em>) —
            forçage <em>optionnel</em> : oblige la logique à se servir de VS1 au lieu de l'auto-sélection.
            À laisser <strong>ouvert</strong> dans la quasi-totalité des cas. Si vous le posez,
            <strong> n'utilisez pas</strong> le bornier VL.
          </li>
          <li>
            <strong>Débit série (Baud)</strong> — réglé par le <strong>bouton-poussoir</strong> de la
            carte (et non par cavalier) : maintenez-le appuyé pour faire défiler 9600 / 38400 / 115200
            (LED verte / rouge / les deux). D'usine = <strong>9600</strong>. Réglez la « Vitesse »
            ci-dessus sur la même valeur.
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
          <strong>USB seul ne suffit pas :</strong> l'USB n'alimente que la puce FTDI — le port COM
          apparaît, mais le microcontrôleur reste éteint tant que <strong>VS1 (ou VL)</strong> n'est
          pas alimenté. La carte ne répondra donc à aucune commande sans alim. Branchez toujours une
          alim 6 V sur VS1 (LED <strong>PWR</strong> allumée) : la logique <em>et</em> les servos sont
          alors prêts.
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
