import { useEffect, useState } from "react";
import { usePwaInstall } from "../hooks/usePwaInstall";
import { HexaLogo } from "./HexaLogo";

export function InstallBanner() {
  const { canInstall, install, isIOS, isInstalled } = usePwaInstall();
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!canInstall || dismissed || isInstalled) return;
    const t = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(t);
  }, [canInstall, dismissed, isInstalled]);

  if (!visible || dismissed || isInstalled) return null;

  const handleInstall = async () => {
    const ok = await install();
    if (ok) setDismissed(true);
  };

  return (
    <div className="install-banner" role="banner">
      <div className="install-banner-logo">
        <HexaLogo size={36} />
      </div>
      <div className="install-banner-body">
        <strong className="install-banner-title">Installer HexaGram</strong>
        {isIOS ? (
          <span className="install-banner-hint">
            Appuyez sur{" "}
            <svg className="install-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
              <polyline points="16 6 12 2 8 6"/>
              <line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
            {" "}puis « Sur l'écran d'accueil »
          </span>
        ) : (
          <span className="install-banner-hint">Accès rapide depuis votre tablette ou mobile</span>
        )}
      </div>
      {!isIOS && (
        <button type="button" className="btn btn-primary install-banner-btn" onClick={handleInstall}>
          Installer
        </button>
      )}
      <button
        type="button"
        className="install-banner-close"
        onClick={() => setDismissed(true)}
        aria-label="Fermer"
      >
        ✕
      </button>
    </div>
  );
}
