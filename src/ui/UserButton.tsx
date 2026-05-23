import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { useProfilesStore } from "../store/useProfilesStore";
import { AvatarImg } from "./AvatarPicker";
import { ProfileMenu } from "./ProfileMenu";

export function UserButton() {
  const { user, logout, setOpenModal } = useAuthStore();
  const { list, clear } = useProfilesStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showProfiles, setShowProfiles] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setShowProfiles(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  if (!user) {
    return (
      <button className="user-button" onClick={() => setOpenModal(true)}>
        <span className="user-button-icon">⎆</span>
        Connexion
      </button>
    );
  }

  function handleLogout() {
    logout();
    clear();
    setMenuOpen(false);
    setShowProfiles(false);
  }

  function handleOpenProfiles() {
    setShowProfiles(true);
    if (!useProfilesStore.getState().profiles.length) list();
  }

  return (
    <div className="user-button-wrapper" ref={ref}>
      <button className="user-button user-button-logged" onClick={() => setMenuOpen((v) => !v)}>
        <AvatarImg seed={user.avatarSeed} size={24} />
        <span className="user-button-login">{user.login}</span>
        <span className="user-button-caret">{menuOpen ? "▲" : "▼"}</span>
      </button>

      {menuOpen && (
        <div className="user-menu">
          {!showProfiles ? (
            <>
              <button className="user-menu-item" onClick={handleOpenProfiles}>
                Mes robots
              </button>
              <button className="user-menu-item user-menu-item-danger" onClick={handleLogout}>
                Déconnexion
              </button>
            </>
          ) : (
            <>
              <button className="user-menu-back" onClick={() => setShowProfiles(false)}>
                ← Retour
              </button>
              <ProfileMenu />
            </>
          )}
        </div>
      )}
    </div>
  );
}
