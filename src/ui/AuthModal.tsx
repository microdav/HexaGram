import { useState } from "react";
import { Modal } from "./Modal";
import { AvatarPicker, AVATAR_SEEDS } from "./AvatarPicker";
import { useAuthStore } from "../store/useAuthStore";

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "login" | "signup";

export function AuthModal({ open, onClose }: AuthModalProps) {
  const [tab, setTab] = useState<Tab>("login");
  const [loginVal, setLoginVal] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [country, setCountry] = useState("");
  const [avatarSeed, setAvatarSeed] = useState<string>(AVATAR_SEEDS[0]);
  const [localError, setLocalError] = useState<string | null>(null);

  const { login: doLogin, signup: doSignup, status } = useAuthStore();
  const loading = status === "loading";

  function reset() {
    setLoginVal("");
    setPassword("");
    setConfirmPassword("");
    setCountry("");
    setAvatarSeed(AVATAR_SEEDS[0]);
    setLocalError(null);
  }

  function switchTab(t: Tab) {
    setTab(t);
    setLocalError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);

    if (tab === "signup") {
      if (loginVal.length < 6) {
        setLocalError("Le login doit faire au moins 6 caractères.");
        return;
      }
      if (password !== confirmPassword) {
        setLocalError("Les mots de passe ne correspondent pas.");
        return;
      }
    }

    try {
      if (tab === "login") {
        await doLogin(loginVal, password);
      } else {
        await doSignup(loginVal, password, avatarSeed, country || undefined);
      }
      reset();
      onClose();
    } catch (err) {
      setLocalError((err as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="modal-tabs">
        <button
          type="button"
          className={`modal-tab${tab === "login" ? " active" : ""}`}
          onClick={() => switchTab("login")}
        >
          Connexion
        </button>
        <button
          type="button"
          className={`modal-tab${tab === "signup" ? " active" : ""}`}
          onClick={() => switchTab("signup")}
        >
          Inscription
        </button>
      </div>

      <form className="modal-form" onSubmit={handleSubmit}>
        <div className="modal-field">
          <label>Login{tab === "signup" && <span className="modal-hint"> (min. 6 caractères)</span>}</label>
          <input
            type="text"
            value={loginVal}
            onChange={(e) => setLoginVal(e.target.value)}
            autoComplete="username"
            required
            maxLength={40}
          />
        </div>

        <div className="modal-field">
          <label>Mot de passe{tab === "signup" && <span className="modal-hint"> (min. 6 caractères)</span>}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={tab === "signup" ? "new-password" : "current-password"}
            required
            minLength={tab === "signup" ? 6 : 1}
          />
        </div>

        {tab === "signup" && (
          <>
            <div className="modal-field">
              <label>Confirmer le mot de passe</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="off"
                required
                minLength={6}
              />
            </div>

            <div className="modal-field">
              <label>Pays (optionnel)</label>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                maxLength={80}
              />
            </div>

            <div className="modal-field">
              <label>Avatar</label>
              <AvatarPicker selected={avatarSeed} onChange={setAvatarSeed} />
            </div>
          </>
        )}

        {localError && <p className="modal-error">{localError}</p>}

        <button type="submit" className="btn btn-primary modal-submit" disabled={loading}>
          {loading ? "…" : tab === "login" ? "Se connecter" : "Créer mon compte"}
        </button>
      </form>
    </Modal>
  );
}
