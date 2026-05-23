import { create } from "zustand";
import { api, setToken, clearToken, setUnauthorizedHandler } from "../api/client";

export interface User {
  id: string;
  login: string;
  country: string | null;
  avatarSeed: string;
  createdAt: number;
}

interface AuthState {
  user: User | null;
  status: "idle" | "loading" | "error";
  errorMsg: string | null;
  openModal: boolean;
  login: (login: string, password: string) => Promise<void>;
  signup: (login: string, password: string, avatarSeed: string, country?: string) => Promise<void>;
  logout: () => void;
  bootstrap: () => Promise<void>;
  setOpenModal: (open: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => {
  setUnauthorizedHandler(() => {
    set({ user: null, openModal: true });
  });

  return {
    user: null,
    status: "idle",
    errorMsg: null,
    openModal: false,

    login: async (login, password) => {
      set({ status: "loading", errorMsg: null });
      try {
        const { token, user } = await api.post<{ token: string; user: User }>("/auth/login", {
          login,
          password,
        });
        setToken(token);
        set({ user, status: "idle", openModal: false });
      } catch (e) {
        set({ status: "error", errorMsg: (e as Error).message });
        throw e;
      }
    },

    signup: async (login, password, avatarSeed, country) => {
      set({ status: "loading", errorMsg: null });
      try {
        const { token, user } = await api.post<{ token: string; user: User }>("/auth/signup", {
          login,
          password,
          avatarSeed,
          country: country || undefined,
        });
        setToken(token);
        set({ user, status: "idle", openModal: false });
      } catch (e) {
        set({ status: "error", errorMsg: (e as Error).message });
        throw e;
      }
    },

    logout: () => {
      clearToken();
      set({ user: null });
    },

    bootstrap: async () => {
      const token = localStorage.getItem("hexagram.token");
      if (!token) return;
      try {
        const { user } = await api.get<{ user: User }>("/auth/me");
        set({ user });
      } catch {
        clearToken();
      }
    },

    setOpenModal: (open) => set({ openModal: open }),
  };
});
