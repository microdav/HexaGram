import { create } from "zustand";
import { api } from "../api/client";
import { useCatalogStore } from "./useCatalogStore";
import type { ServoSpec } from "../model/servoTypes";
import type { ServoControllerSpec } from "../model/servoControllers";
import type { CommandElectronicsSpec } from "../model/commandElectronics";
import type { PeripheralSpec } from "../model/peripherals";

export interface AdminUser {
  id: string;
  login: string;
  country: string | null;
  avatarSeed: string;
  createdAt: number;
  isAdmin: boolean;
  isActive: boolean;
  projectCount: number;
}

/** Types de référentiels gérés par l'admin (cf. serveur). */
export type CatalogKind =
  | "servoType"
  | "servoController"
  | "commandElectronics"
  | "peripheral";

export type CatalogEntry =
  | ServoSpec
  | ServoControllerSpec
  | CommandElectronicsSpec
  | PeripheralSpec;

interface AdminState {
  users: AdminUser[];
  loading: boolean;
  // Utilisateurs
  listUsers: () => Promise<void>;
  resetPassword: (id: string, password: string) => Promise<void>;
  setUserFlags: (id: string, flags: { isAdmin?: boolean; isActive?: boolean }) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  // Référentiels
  createEntry: (kind: CatalogKind, entry: CatalogEntry) => Promise<void>;
  updateEntry: (kind: CatalogKind, id: string, entry: CatalogEntry) => Promise<void>;
  deleteEntry: (kind: CatalogKind, id: string) => Promise<void>;
}

export const useAdminStore = create<AdminState>((set) => ({
  users: [],
  loading: false,

  listUsers: async () => {
    set({ loading: true });
    try {
      const users = await api.get<AdminUser[]>("/admin/users");
      set({ users, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  resetPassword: async (id, password) => {
    await api.post(`/admin/users/${id}/reset-password`, { password });
  },

  setUserFlags: async (id, flags) => {
    const updated = await api.patch<AdminUser>(`/admin/users/${id}`, flags);
    set((s) => ({ users: s.users.map((u) => (u.id === id ? updated : u)) }));
  },

  deleteUser: async (id) => {
    await api.delete(`/admin/users/${id}`);
    set((s) => ({ users: s.users.filter((u) => u.id !== id) }));
  },

  createEntry: async (kind, entry) => {
    await api.post(`/admin/catalogs/${kind}`, entry);
    await useCatalogStore.getState().hydrate();
  },

  updateEntry: async (kind, id, entry) => {
    await api.put(`/admin/catalogs/${kind}/${encodeURIComponent(id)}`, entry);
    await useCatalogStore.getState().hydrate();
  },

  deleteEntry: async (kind, id) => {
    await api.delete(`/admin/catalogs/${kind}/${encodeURIComponent(id)}`);
    await useCatalogStore.getState().hydrate();
  },
}));
