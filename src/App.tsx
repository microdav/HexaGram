import { Scene } from "./three/Scene";
import { ServoPanel } from "./ui/ServoPanel";
import { GeometryPanel } from "./ui/GeometryPanel";
import { PoseList } from "./ui/PoseList";
import { SimulationPanel } from "./ui/SimulationPanel";

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <h1>HexaGram</h1>
        <span className="subtitle">POC — hexapode 18 DOF</span>
      </header>

      <main className="layout">
        <aside className="sidebar sidebar-left">
          <SimulationPanel />
          <GeometryPanel />
          <PoseList />
        </aside>

        <section className="viewer">
          <Scene />
        </section>

        <aside className="sidebar sidebar-right">
          <ServoPanel />
        </aside>
      </main>
    </div>
  );
}
