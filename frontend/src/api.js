const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${body}`);
  }
  return res.json();
}

export const api = {
  registerDriver: (name, vehicleType) =>
    request("/drivers", {
      method: "POST",
      body: JSON.stringify({ name, vehicle_type: vehicleType }),
    }),

  updateDriverLocation: (driverId, lat, lng, status) =>
    request(`/drivers/${driverId}/location`, {
      method: "POST",
      body: JSON.stringify({ lat, lng, status }),
    }),

  registerRider: (name) =>
    request("/riders", { method: "POST", body: JSON.stringify({ name }) }),

  requestTrip: (riderId, pickup, dropoff) =>
    request("/trips", {
      method: "POST",
      body: JSON.stringify({
        rider_id: riderId,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
      }),
    }),

  getTrip: (tripId) => request(`/trips/${tripId}`),

  startTrip: (tripId) => request(`/trips/${tripId}/start`, { method: "POST" }),
  completeTrip: (tripId) =>
    request(`/trips/${tripId}/complete`, { method: "POST" }),
  cancelTrip: (tripId) =>
    request(`/trips/${tripId}/cancel`, { method: "POST" }),
};
