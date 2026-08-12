import { useState } from "react";
import { api } from "./api";

const SEATTLE = { lat: 47.6062, lng: -122.3321 };

export default function App() {
  const [driver, setDriver] = useState(null);
  const [rider, setRider] = useState(null);
  const [trip, setTrip] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  const addLog = (msg) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${msg}`, ...l]);

  const runDemo = async () => {
    setBusy(true);
    try {
      const d = await api.registerDriver("Alex Rivera", "standard");
      setDriver(d);
      addLog(`Driver registered: ${d.name}`);

      const driverLoc = { lat: SEATTLE.lat + 0.01, lng: SEATTLE.lng + 0.01 };
      await api.updateDriverLocation(d.id, driverLoc.lat, driverLoc.lng, "AVAILABLE");
      addLog(`Driver location set near pickup, status AVAILABLE`);

      const r = await api.registerRider("Jamie Chen");
      setRider(r);
      addLog(`Rider registered: ${r.name}`);

      const dropoff = { lat: SEATTLE.lat + 0.05, lng: SEATTLE.lng - 0.02 };
      const t = await api.requestTrip(r.id, SEATTLE, dropoff);
      setTrip(t);
      addLog(`Trip requested, status: ${t.status}`);
    } catch (err) {
      addLog(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const advance = async (action) => {
    if (!trip) return;
    setBusy(true);
    try {
      const fn = { start: api.startTrip, complete: api.completeTrip, cancel: api.cancelTrip }[action];
      const t = await fn(trip.id);
      setTrip(t);
      addLog(`Trip ${action}: status is now ${t.status}`);
    } catch (err) {
      addLog(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Ride Matching Dispatch</h1>
        <p>Demo console for the FastAPI + Redis + Kafka matching service.</p>
      </header>

      <section className="panel">
        <button disabled={busy} onClick={runDemo}>
          Run demo: register driver, register rider, request trip
        </button>

        {trip && (
          <div className="trip-actions">
            <button disabled={busy} onClick={() => advance("start")}>Start trip</button>
            <button disabled={busy} onClick={() => advance("complete")}>Complete trip</button>
            <button disabled={busy} onClick={() => advance("cancel")}>Cancel trip</button>
          </div>
        )}
      </section>

      <section className="grid">
        <div className="card">
          <h2>Driver</h2>
          {driver ? (
            <ul>
              <li>Name: {driver.name}</li>
              <li>Vehicle: {driver.vehicle_type}</li>
              <li>Status: {driver.status}</li>
            </ul>
          ) : (
            <p>No driver yet.</p>
          )}
        </div>

        <div className="card">
          <h2>Rider</h2>
          {rider ? (
            <ul>
              <li>Name: {rider.name}</li>
              <li>ID: {rider.id}</li>
            </ul>
          ) : (
            <p>No rider yet.</p>
          )}
        </div>

        <div className="card">
          <h2>Trip</h2>
          {trip ? (
            <ul>
              <li>Status: {trip.status}</li>
              <li>Driver assigned: {trip.driver_id ? "yes" : "no"}</li>
              <li>Pickup: {trip.pickup_lat.toFixed(4)}, {trip.pickup_lng.toFixed(4)}</li>
              <li>Dropoff: {trip.dropoff_lat.toFixed(4)}, {trip.dropoff_lng.toFixed(4)}</li>
            </ul>
          ) : (
            <p>No trip yet.</p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Event log</h2>
        <ul className="log">
          {log.map((entry, i) => (
            <li key={i}>{entry}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
