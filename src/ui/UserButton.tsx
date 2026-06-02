import { useState, useRef, useEffect } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { AvatarImg } from "./AvatarPicker";

export function UserButton() {
  const { user, logout, setOpenModal } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setMenuOpen(false);
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
    setMenuOpen(false);
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
          <button className="user-menu-item user-menu-item-danger" onClick={handleLogout}>
            Déconnexion
          </button>
        </div>
      )}
    </div>
  );
}
