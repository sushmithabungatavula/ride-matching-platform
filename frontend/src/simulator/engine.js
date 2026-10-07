// Browser-only port of the dispatch flow in backend/app/matching.py.
// Redis GEOSEARCH -> radius scan over in-memory drivers, Postgres
// FOR UPDATE SKIP LOCKED -> re-check driver status at claim time,
// Kafka topics -> the on-screen event stream.

export function startSimulation(root) {
  const W = 10, H = 7, GRID = 0.5;           // world in km, street spacing
  const BASE_KMH = 30;                        // driver speed
  const SIM_SECONDS_PER_REAL = 20;            // time compression at 1×
  const SEARCH_MS = 700, CLAIM_MS = 450;      // animation phases (real time)

  const $ = (id) => root.querySelector("#sim-" + id);
  const ac = new AbortController();
  const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });
  const timers = new Set();
  let rafId = 0;

  const canvas = $("map");
  const ctx = canvas.getContext("2d");
  const wrap = $("mapwrap");
  const hint = $("hint");
  const feed = $("feed");
  feed.innerHTML = "";

  let colors = {};
  const readColors = () => {
    const cs = getComputedStyle(root);
    for (const k of ["map","street","street-major","park","water","avail","enroute","ontrip","rider","danger","text","panel","muted"])
      colors[k] = cs.getPropertyValue("--" + k).trim();
  };
  readColors();
  on(matchMedia("(prefers-color-scheme: dark)"), "change", readColors);

  let scale = 1, offX = 0, offY = 0, dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = wrap.getBoundingClientRect();
    const h = window.innerWidth <= 860
      ? Math.max(240, r.width * H / W)
      : Math.max(420, Math.min(window.innerHeight - 150, r.width * H / W));
    wrap.style.height = h + "px";
    canvas.width = r.width * dpr; canvas.height = h * dpr;
    scale = Math.min(r.width / W, h / H);
    offX = (r.width - W * scale) / 2; offY = (h - H * scale) / 2;
  }
  on(window, "resize", resize);
  const sx = (x) => offX + x * scale, sy = (y) => offY + y * scale;

  const snap = (v, max) => Math.max(0, Math.min(max, Math.round(v / GRID) * GRID));
  const onGrid = (v) => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-6;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const randPt = () => ({ x: snap(Math.random() * W, W), y: snap(Math.random() * H, H) });
  const nearPt = (p, r) => ({ x: snap(p.x + (Math.random() * 2 - 1) * r, W), y: snap(p.y + (Math.random() * 2 - 1) * r, H) });

  // Manhattan route along streets to an intersection
  function route(from, to) {
    const pts = [];
    if (onGrid(from.y) && !onGrid(from.x)) { pts.push({ x: to.x, y: from.y }); pts.push({ x: to.x, y: to.y }); }
    else if (onGrid(from.x) && !onGrid(from.y)) { pts.push({ x: from.x, y: to.y }); pts.push({ x: to.x, y: to.y }); }
    else if (Math.random() < 0.5) { pts.push({ x: to.x, y: from.y }); pts.push(to); }
    else { pts.push({ x: from.x, y: to.y }); pts.push(to); }
    return pts;
  }

  // ---- state ----
  let drivers = [], requests = [], nextDriver = 1, nextRider = 1;
  let pendingPickup = null;
  const stats = { req: 0, matched: 0, unmatched: 0, pickupSum: 0, races: 0 };

  function addDriver() {
    const p = randPt();
    drivers.push({ id: "D" + String(nextDriver++).padStart(2, "0"), x: p.x, y: p.y, status: "AVAILABLE", path: [], req: null, flash: 0 });
  }
  function setFleet(n) {
    while (drivers.length < n) addDriver();
    while (drivers.length > n) {
      const i = drivers.findIndex((d) => d.status === "AVAILABLE");
      if (i < 0) break;
      drivers.splice(i, 1);
    }
  }

  function log(topic, html, cls = "") {
    const li = document.createElement("li");
    const t = new Date().toLocaleTimeString([], { hour12: false });
    li.innerHTML = `<span class="t">${t}</span><span class="topic">${topic}</span><span class="${cls}">${html}</span>`;
    feed.prepend(li);
    while (feed.children.length > 80) feed.lastChild.remove();
  }

  function requestTrip(pickup, dropoff) {
    const id = "R" + String(nextRider++).padStart(3, "0");
    const r = { id, pickup, dropoff, state: "searching", t0: performance.now(), candidates: [], driver: null, fade: 0 };
    requests.push(r);
    stats.req++;
    log("trip.events", `${id} requested at (${pickup.x.toFixed(1)}, ${pickup.y.toFixed(1)})`);
  }

  function radiusKm() { return parseFloat($("radius").value); }

  function updateRequest(r, now) {
    const age = now - r.t0;
    if (r.state === "searching" && age >= SEARCH_MS) {
      // GEOSEARCH snapshot: nearest available drivers within radius
      const R = radiusKm();
      r.candidates = drivers
        .filter((d) => d.status === "AVAILABLE" && dist(d, r.pickup) <= R)
        .map((d) => ({ d, km: dist(d, r.pickup) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 10);
      r.state = "claiming";
      r.t1 = now;
    } else if (r.state === "claiming" && now - r.t1 >= CLAIM_MS) {
      // Claim closest still-AVAILABLE driver (SELECT ... FOR UPDATE SKIP LOCKED)
      let skipped = 0;
      for (const c of r.candidates) {
        if (!drivers.includes(c.d)) continue;
        if (c.d.status !== "AVAILABLE") { skipped++; continue; }
        const d = c.d;
        d.status = "EN_ROUTE"; d.req = r; d.path = route(d, r.pickup); d.flash = 1;
        r.driver = d; r.state = "waiting";
        stats.matched++; stats.pickupSum += c.km;
        if (skipped) { stats.races += skipped; log("trip.events", `${r.id} skipped ${skipped} already-claimed driver${skipped > 1 ? "s" : ""}`, "warn"); }
        log("trip.events", `${r.id} matched ${d.id}, ${c.km.toFixed(2)} km away`, "ok");
        return;
      }
      if (skipped) stats.races += skipped;
      r.state = "unmatched"; r.t2 = now; stats.unmatched++;
      log("trip.events", `${r.id} unmatched, no driver within ${radiusKm()} km`, "bad");
    }
  }

  function moveDriver(d, km) {
    while (km > 1e-9 && d.path.length) {
      const t = d.path[0];
      const seg = Math.abs(t.x - d.x) + Math.abs(t.y - d.y);
      if (seg <= km) { d.x = t.x; d.y = t.y; d.path.shift(); km -= seg; }
      else {
        if (t.x !== d.x) d.x += Math.sign(t.x - d.x) * km;
        else d.y += Math.sign(t.y - d.y) * km;
        km = 0;
      }
    }
    if (d.path.length) return;
    const r = d.req;
    if (d.status === "EN_ROUTE" && r) {
      d.status = "ON_TRIP"; r.state = "riding"; d.path = route(d, r.dropoff);
      log("trip.events", `${d.id} picked up ${r.id}`);
    } else if (d.status === "ON_TRIP" && r) {
      d.status = "AVAILABLE"; r.state = "done"; r.t2 = performance.now(); d.req = null;
      log("trip.events", `${r.id} completed, ${d.id} available again`, "ok");
    } else if (d.status === "AVAILABLE" && Math.random() < 0.02) {
      d.path = route(d, nearPt(d, 2));
    }
  }

  // ---- input ----
  on(canvas, "click", (e) => {
    const b = canvas.getBoundingClientRect();
    const x = (e.clientX - b.left - offX) / scale, y = (e.clientY - b.top - offY) / scale;
    if (x < 0 || y < 0 || x > W || y > H) return;
    const p = { x: snap(x, W), y: snap(y, H) };
    if (!pendingPickup) { pendingPickup = p; hint.textContent = "Now click to set the dropoff (Esc to cancel)"; }
    else {
      if (p.x === pendingPickup.x && p.y === pendingPickup.y) return;
      requestTrip(pendingPickup, p); pendingPickup = null; hint.textContent = "Click the map to drop a pickup";
    }
  });
  on(window, "keydown", (e) => {
    if (e.key === "Escape" && pendingPickup) { pendingPickup = null; hint.textContent = "Click the map to drop a pickup"; }
  });
  const bindRange = (id, fmt, fn) => {
    const el = $(id), out = $(id + "Out");
    on(el, "input", () => { out.textContent = fmt(el.value); fn && fn(+el.value); });
  };
  bindRange("fleet", (v) => v, setFleet);
  bindRange("radius", (v) => v + " km");
  bindRange("speed", (v) => v + "×");
  on($("rush"), "click", () => {
    const hot = randPt();
    log("trip.events", "Rush hour: 20 requests incoming", "warn");
    for (let i = 0; i < 20; i++) {
      const t = setTimeout(() => { timers.delete(t); requestTrip(nearPt(hot, 1.5), randPt()); }, i * 60);
      timers.add(t);
    }
  });
  on($("one"), "click", () => requestTrip(randPt(), randPt()));

  // ---- drawing ----
  function drawMap() {
    ctx.fillStyle = colors.map; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = colors.water; ctx.fillRect(sx(0), sy(0), 1.2 * scale, H * scale);
    ctx.fillStyle = colors.park; ctx.fillRect(sx(6.5), sy(1), 1.5 * scale, 1.5 * scale);
    ctx.fillRect(sx(3), sy(4.5), 1 * scale, 1.5 * scale);
    for (let i = 0; i * GRID <= W + 1e-9; i++) {
      ctx.strokeStyle = i % 4 === 0 ? colors["street-major"] : colors.street;
      ctx.lineWidth = i % 4 === 0 ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(sx(i * GRID), sy(0)); ctx.lineTo(sx(i * GRID), sy(H)); ctx.stroke();
    }
    for (let j = 0; j * GRID <= H + 1e-9; j++) {
      ctx.strokeStyle = j % 4 === 0 ? colors["street-major"] : colors.street;
      ctx.lineWidth = j % 4 === 0 ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(sx(0), sy(j * GRID)); ctx.lineTo(sx(W), sy(j * GRID)); ctx.stroke();
    }
  }
  function pathLine(d, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(sx(d.x), sy(d.y));
    for (const p of d.path) ctx.lineTo(sx(p.x), sy(p.y));
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  function pin(p, color, size = 7) {
    ctx.fillStyle = color; ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.y) - size * 1.2, size, Math.PI * 0.8, Math.PI * 2.2);
    ctx.lineTo(sx(p.x), sy(p.y)); ctx.closePath(); ctx.fill();
    ctx.fillStyle = colors.panel; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y) - size * 1.2, size * 0.4, 0, Math.PI * 2); ctx.fill();
  }
  function flag(p, color) {
    ctx.fillStyle = color; ctx.fillRect(sx(p.x) - 4, sy(p.y) - 4, 8, 8);
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap();
    const R = radiusKm();

    for (const r of requests) {
      if (r.state === "searching") {
        const k = Math.max(0, Math.min(1, (now - r.t0) / SEARCH_MS));
        ctx.strokeStyle = colors.rider; ctx.fillStyle = colors.rider;
        ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.arc(sx(r.pickup.x), sy(r.pickup.y), R * scale * k, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.7; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
      } else if (r.state === "claiming") {
        ctx.strokeStyle = colors.rider; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(sx(r.pickup.x), sy(r.pickup.y), R * scale, 0, Math.PI * 2); ctx.stroke();
        r.candidates.forEach((c, i) => {
          ctx.globalAlpha = i === 0 ? 0.9 : 0.35; ctx.lineWidth = i === 0 ? 2 : 1;
          ctx.beginPath(); ctx.moveTo(sx(r.pickup.x), sy(r.pickup.y)); ctx.lineTo(sx(c.d.x), sy(c.d.y)); ctx.stroke();
        });
        ctx.globalAlpha = 1;
      } else if (r.state === "unmatched") {
        const k = Math.min(1, (now - r.t2) / 1800);
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = colors.danger; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx(r.pickup.x), sy(r.pickup.y), R * scale, 0, Math.PI * 2); ctx.stroke();
        pin(r.pickup, colors.danger); ctx.globalAlpha = 1;
      }
    }
    for (const d of drivers) {
      if (d.status === "EN_ROUTE") pathLine(d, colors.enroute);
      if (d.status === "ON_TRIP") pathLine(d, colors.ontrip);
    }
    for (const r of requests) {
      if (r.state === "searching" || r.state === "claiming" || r.state === "waiting") {
        const pulse = 1 + 0.15 * Math.sin(now / 180);
        pin(r.pickup, colors.rider, 7 * pulse);
      }
      if (r.state === "riding" || r.state === "waiting") flag(r.dropoff, r.state === "riding" ? colors.ontrip : colors.enroute);
      if (r.state === "done") {
        const k = Math.min(1, (now - r.t2) / 1200);
        ctx.globalAlpha = 1 - k; flag(r.dropoff, colors.avail); ctx.globalAlpha = 1;
      }
    }
    for (const d of drivers) {
      const c = d.status === "AVAILABLE" ? colors.avail : d.status === "EN_ROUTE" ? colors.enroute : colors.ontrip;
      if (d.flash > 0) {
        ctx.strokeStyle = c; ctx.globalAlpha = d.flash; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx(d.x), sy(d.y), 6 + (1 - d.flash) * 16, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = c; ctx.strokeStyle = colors.panel; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx(d.x), sy(d.y), 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    if (pendingPickup) {
      pin(pendingPickup, colors.rider, 8);
      ctx.strokeStyle = colors.rider; ctx.setLineDash([3, 4]); ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.arc(sx(pendingPickup.x), sy(pendingPickup.y), R * scale, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }

  function updateStats() {
    const decided = stats.matched + stats.unmatched;
    $("sReq").textContent = stats.req;
    $("sRate").textContent = decided ? Math.round((stats.matched / decided) * 100) + "%" : "–";
    $("sDist").textContent = stats.matched ? (stats.pickupSum / stats.matched).toFixed(2) + " km" : "–";
    $("sActive").textContent = drivers.filter((d) => d.status !== "AVAILABLE").length;
    $("sAvail").textContent = drivers.filter((d) => d.status === "AVAILABLE").length;
    $("sRace").textContent = stats.races;
  }

  let last = performance.now(), statTimer = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const km = (BASE_KMH / 3600) * SIM_SECONDS_PER_REAL * parseFloat($("speed").value) * dt;
    for (const r of requests) updateRequest(r, now);
    for (const d of drivers) { moveDriver(d, km); d.flash = Math.max(0, d.flash - dt * 1.5); }
    requests = requests.filter((r) => !((r.state === "done" && now - r.t2 > 1200) || (r.state === "unmatched" && now - r.t2 > 1800)));
    draw(now);
    if ((statTimer += dt) > 0.25) { statTimer = 0; updateStats(); }
    rafId = requestAnimationFrame(frame);
  }

  resize();
  setFleet(35);
  drivers.forEach((d) => (d.path = route(d, nearPt(d, 2))));
  log("driver.locations", "35 drivers online, geo index ready", "ok");
  rafId = requestAnimationFrame(frame);

  return () => {
    ac.abort();
    cancelAnimationFrame(rafId);
    timers.forEach(clearTimeout);
  };
}
