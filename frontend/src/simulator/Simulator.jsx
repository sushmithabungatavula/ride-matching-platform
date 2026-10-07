import { useEffect, useRef } from "react";
import { startSimulation } from "./engine";
import "./simulator.css";

export default function Simulator({ nav }) {
  const rootRef = useRef(null);

  useEffect(() => startSimulation(rootRef.current), []);

  return (
    <div className="sim" ref={rootRef}>
      <header>
        <div>
          <h1>Ride Matching Simulator</h1>
          <p>Nearest-driver dispatch, running entirely in your browser</p>
        </div>
        {nav}
      </header>
      <div className="layout">
        <div className="mapwrap" id="sim-mapwrap">
          <canvas id="sim-map" />
          <div className="hint" id="sim-hint">Click the map to drop a pickup</div>
          <div className="legend">
            <span style={{ "--c": "var(--avail)" }}>Available</span>
            <span style={{ "--c": "var(--enroute)" }}>En route</span>
            <span style={{ "--c": "var(--ontrip)" }}>On trip</span>
            <span style={{ "--c": "var(--rider)" }}>Rider</span>
          </div>
        </div>
        <aside>
          <div className="card">
            <h2>Controls</h2>
            <label className="ctl">
              Fleet size <input type="range" id="sim-fleet" min="5" max="80" defaultValue="35" />
              <output id="sim-fleetOut">35</output>
            </label>
            <label className="ctl">
              Search radius <input type="range" id="sim-radius" min="0.5" max="4" step="0.25" defaultValue="1.5" />
              <output id="sim-radiusOut">1.5 km</output>
            </label>
            <label className="ctl">
              Sim speed <input type="range" id="sim-speed" min="0.5" max="5" step="0.5" defaultValue="2" />
              <output id="sim-speedOut">2×</output>
            </label>
            <div className="btns">
              <button className="primary" id="sim-rush">Rush hour (20 riders)</button>
              <button id="sim-one">Random rider</button>
            </div>
          </div>
          <div className="card">
            <h2>Live stats</h2>
            <div className="stats">
              <div className="stat"><b id="sim-sReq">0</b><small>Requests</small></div>
              <div className="stat"><b id="sim-sRate">–</b><small>Match rate</small></div>
              <div className="stat"><b id="sim-sDist">–</b><small>Avg pickup</small></div>
              <div className="stat"><b id="sim-sActive">0</b><small>Active trips</small></div>
              <div className="stat"><b id="sim-sAvail">0</b><small>Available</small></div>
              <div className="stat"><b id="sim-sRace">0</b><small>Races avoided</small></div>
            </div>
          </div>
          <div className="card">
            <h2>Event stream</h2>
            <ul className="feed" id="sim-feed" />
          </div>
        </aside>
      </div>
    </div>
  );
}
