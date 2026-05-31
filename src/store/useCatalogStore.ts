import { create } from "zustand";
import { api } from "../api/client";
import type { ServoSpec } from "../model/servoTypes";
import type { ServoControllerSpec } from "../model/servoControllers";
import type { CommandElectronicsSpec } from "../model/commandElectronics";
import type { PeripheralSpec } from "../model/peripherals";

// Catalogue matériel en mémoire. Source synchrone unique consultée par les
// helpers (findServoType, etc.) et les écrans de sélection. Initialisé avec les
// tableaux intégrés (via setDefaults() appelé au tout début de main.tsx, avant
// le premier render → lecture synchrone jamais vide, mode démo OK), puis
// remplacé par les données serveur via hydrate().
//
// ⚠️ Ce store n'importe PAS les fichiers model/* (seulement leurs types) afin
// d'éviter toute dépendance circulaire : model/* → useCatalogStore, pas
// l'inverse. Les valeurs par défaut sont injectées depuis main.tsx.

interface CatalogState {
  servoTypes: ServoSpec[];
  servoControllers: ServoControllerSpec[];
  commandElectronics: CommandElectronicsSpec[];
  peripherals: PeripheralSpec[];
  /** true une fois la première hydratation serveur réussie. */
  loaded: boolean;
  setDefaults: (payload: Partial<CatalogPayload>) => void;
  hydrate: () => Promise<void>;
}

interface CatalogPayload {
  servoTypes: ServoSpec[];
  servoControllers: ServoControllerSpec[];
  commandElectronics: CommandElectronicsSpec[];
  peripherals: PeripheralSpec[];
}

export const useCatalogStore = create<CatalogState>((set) => ({
  servoTypes: [],
  servoControllers: [],
  commandElectronics: [],
  peripherals: [],
  loaded: false,

  // Initialise le store avec les catalogues intégrés (appelé une fois au
  // démarrage). N'écrase pas une hydratation serveur déjà effectuée.
  setDefaults: (payload) =>
    set((s) =>
      s.loaded
        ? s
        : {
            servoTypes: payload.servoTypes ?? s.servoTypes,
            servoControllers: payload.servoControllers ?? s.servoControllers,
            commandElectronics: payload.commandElectronics ?? s.commandElectronics,
            peripherals: payload.peripherals ?? s.peripherals,
          }
    ),

  hydrate: async () => {
    try {
      const data = await api.get<CatalogPayload>("/catalogs");
      set({
        servoTypes: data.servoTypes ?? [],
        servoControllers: data.servoControllers ?? [],
        commandElectronics: data.commandElectronics ?? [],
        peripherals: data.peripherals ?? [],
        loaded: true,
      });
    } catch {
      // Hors-ligne / serveur indisponible : on conserve les défauts intégrés.
    }
  },
}));
