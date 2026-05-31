import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { useCatalogStore } from "./store/useCatalogStore";
import { SERVO_CATALOG } from "./model/servoTypes";
import { SERVO_CONTROLLER_CATALOG } from "./model/servoControllers";
import { COMMAND_ELECTRONICS_CATALOG } from "./model/commandElectronics";
import { PERIPHERAL_CATALOG } from "./model/peripherals";

// Amorce le store catalogue avec les référentiels intégrés AVANT le premier
// render, pour garantir une lecture synchrone (les helpers findServoType, etc.
// lisent ce store). hydrate() remplacera ensuite par les données serveur.
useCatalogStore.getState().setDefaults({
  servoTypes: SERVO_CATALOG,
  servoControllers: SERVO_CONTROLLER_CATALOG,
  commandElectronics: COMMAND_ELECTRONICS_CATALOG,
  peripherals: PERIPHERAL_CATALOG,
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
