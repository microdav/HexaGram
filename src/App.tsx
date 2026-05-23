import { useState } from "react";
import { Scene } from "./three/Scene";
import { ServoPanel } from "./ui/ServoPanel";
import { GeometryPanel } from "./ui/GeometryPanel";
import { PoseList } from "./ui/PoseList";
import { SimulationPanel } from "./ui/SimulationPanel";
import { MirrorPanel } from "./ui/MirrorPanel";

export default function App() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const layoutClass = `layout${leftOpen ? "" : " left-collapsed"}${rightOpen ? "" : " right-collapsed"}`;
  return (
    <div className="app">
      <header className="topbar">
        <h1>HexaGram</h1>
        <span className="subtitle">POC — hexapode 18 DOF</span>
      </header>

      <main className={layoutClass}>
        <aside className={`sidebar sidebar-left${leftOpen ? "" : " collapsed"}`}>
          <SimulationPanel />
          <GeometryPanel />
          <PoseList />
        </aside>
        <button
          type="button"
          className={`sidebar-handle handle-left${leftOpen ? "" : " collapsed"}`}
          onClick={() => setLeftOpen((v) => !v)}
          aria-label={leftOpen ? "Fermer le panneau gauche" : "Ouvrir le panneau gauche"}
          title={leftOpen ? "Fermer le panneau gauche" : "Ouvrir le panneau gauche"}
        >
          {leftOpen ? "‹" : "›"}
        </button>

        <section className="viewer">
          <Scene />
        </section>

        <button
          type="button"
          className={`sidebar-handle handle-right${rightOpen ? "" : " collapsed"}`}
          onClick={() => setRightOpen((v) => !v)}
          aria-label={rightOpen ? "Fermer le panneau droit" : "Ouvrir le panneau droit"}
          title={rightOpen ? "Fermer le panneau droit" : "Ouvrir le panneau droit"}
        >
          {rightOpen ? "›" : "‹"}
        </button>
        <aside className={`sidebar sidebar-right${rightOpen ? "" : " collapsed"}`}>
          <MirrorPanel />
          <ServoPanel />
        </aside>
      </main>
    </div>
  );
}
