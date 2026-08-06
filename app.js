/* =========================================================
   Atlas — personal museum & historical site map
   No backend, no API keys. Everything lives in the browser.
   ========================================================= */

const STORAGE_KEY = "atlas_sites_v1";

/** @typedef {{
 *   id: string, name: string, city: string, country: string,
 *   lat: number, lng: number, knownFor: string[],
 *   imageUrl: string, status: "visited"|"wantToVisit", visits: string[]
 * }} Site */

/** @type {Site[]} */
let sites = loadSites();
let pendingSite = null; // site being built in the confirm panel
let activeSiteId = null; // site open in the detail modal

// ---------- Map setup ----------
const map = L.map("map", { worldCopyJump: true }).setView([30, 10], 2.5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);

function pinHtml(status, size = 34) {
  if (status === "visited") {
    return `<div class="atlas-pin-seal" style="width:${size}px;height:${size}px;">
      <img src="assets/wax-seal.png" alt="" />
      <svg class="seal-emblem" viewBox="0 0 40 40"><use href="#icon-star-mini"/></svg>
    </div>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40"><use href="#icon-compass"/></svg>`;
}

function iconFor(status) {
  return L.divIcon({
    className: "atlas-pin",
    html: pinHtml(status, 34),
    iconSize: [34, 34],
    iconAnchor: [17, 30],
    popupAnchor: [0, -28],
  });
}

// Populate the legend swatch so it matches the actual marker rendering.
document.getElementById("legend-icon-visited").innerHTML = pinHtml("visited", 20);

function renderPins() {
  markerLayer.clearLayers();
  for (const site of sites) {
    const marker = L.marker([site.lat, site.lng], { icon: iconFor(site.status) });
    marker.bindTooltip(
      `<p class="tooltip-name">${escapeHtml(site.name)}</p>
       <p class="tooltip-location">${escapeHtml(site.city)}, ${escapeHtml(site.country)}</p>
       <p class="tooltip-summary">${escapeHtml(site.knownFor[0] || "")}</p>`,
      { direction: "top", offset: [0, -6] }
    );
    marker.on("click", () => openDetailModal(site.id));
    marker.addTo(markerLayer);
  }
}

// ---------- Storage ----------
function loadSites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
function saveSites() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sites));
}

// ---------- Search (Nominatim) ----------
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");

searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;
  searchResults.innerHTML = `<button disabled>Searching&hellip;</button>`;
  searchResults.hidden = false;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const results = await res.json();
    renderSearchResults(results);
  } catch (err) {
    searchResults.innerHTML = `<button disabled>Search failed &mdash; try again</button>`;
  }
});

function renderSearchResults(results) {
  if (!results.length) {
    searchResults.innerHTML = `<button disabled>No matches found</button>`;
    return;
  }
  searchResults.innerHTML = "";
  for (const r of results) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = r.display_name;
    btn.addEventListener("click", () => handlePick(r));
    searchResults.appendChild(btn);
  }
}

async function handlePick(result) {
  searchResults.hidden = true;
  searchInput.value = "";

  const addr = result.address || {};
  const city = addr.city || addr.town || addr.village || addr.municipality || "";
  const country = addr.country || "";
  const name = result.namedetails?.name || result.display_name.split(",")[0];

  pendingSite = {
    id: crypto.randomUUID(),
    name,
    city,
    country,
    lat: parseFloat(result.lat),
    lng: parseFloat(result.lon),
    knownFor: [],
    imageUrl: "",
    imagePosition: "50% 50%",
    status: "wantToVisit",
    visits: [],
  };

  openConfirmPanel(pendingSite, { loading: true });
  const wiki = await fetchWikipediaSummary(name, city);
  pendingSite.knownFor = wiki.extract
    ? splitIntoBullets(wiki.extract)
    : ["Couldn't find a clean Wikipedia match \u2014 add a note about what this site is known for."];
  pendingSite.imageUrl = wiki.imageUrl || "";
  openConfirmPanel(pendingSite, { loading: false });
}

// ---------- Wikipedia ----------
// Titles like "Palazzo Madama" are disambiguation pages (Rome vs. Turin, etc).
// Searching with the city appended, then walking the top candidates, gets us
// to the actual article instead of the disambiguation stub.
async function fetchWikipediaSummary(name, city) {
  const query = city ? `${name} ${city}` : name;
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      query
    )}&format=json&origin=*&srlimit=3`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    const candidates = (searchData.query?.search || []).map((r) => r.title);
    if (candidates.length === 0) return {};

    let firstResult = null;
    for (const title of candidates) {
      const summary = await fetchSummaryForTitle(title);
      if (!summary) continue;
      if (!firstResult) firstResult = summary;
      if (summary.type !== "disambiguation" && summary.extract) {
        return summary;
      }
    }
    return firstResult || {};
  } catch {
    return {};
  }
}

async function fetchSummaryForTitle(title) {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      type: data.type,
      extract: data.extract || "",
      imageUrl: data.thumbnail?.source || data.originalimage?.source || "",
    };
  } catch {
    return null;
  }
}

// Break a Wikipedia extract into a few candidate "known for" lines.
function splitIntoBullets(extract) {
  const sentences = extract
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return sentences.slice(0, 5);
}

// ---------- Confirm panel ----------
const confirmPanel = document.getElementById("confirm-panel");
const confirmName = document.getElementById("confirm-name");
const confirmLocation = document.getElementById("confirm-location");
const confirmImage = document.getElementById("confirm-image");
const confirmKnownFor = document.getElementById("confirm-known-for");
const confirmImageUpload = document.getElementById("confirm-image-upload");

function openConfirmPanel(site, { loading }) {
  confirmName.textContent = site.name;
  confirmLocation.textContent = [site.city, site.country].filter(Boolean).join(", ");
  confirmImage.src = site.imageUrl || placeholderImage();
  confirmImage.alt = site.name;
  confirmImage.style.objectPosition = site.imagePosition || "50% 50%";
  confirmKnownFor.value = loading ? "Fetching from Wikipedia\u2026" : site.knownFor.join("\n");
  confirmKnownFor.disabled = loading;
  confirmPanel.hidden = false;
}

function closeConfirmPanel() {
  confirmPanel.hidden = true;
  pendingSite = null;
  confirmImageUpload.value = "";
}

document.getElementById("confirm-cancel").addEventListener("click", closeConfirmPanel);
document.querySelector("[data-close-confirm]").addEventListener("click", closeConfirmPanel);

confirmImageUpload.addEventListener("change", () => {
  const file = confirmImageUpload.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    confirmImage.src = reader.result;
    pendingSite.imageUrl = reader.result; // stored as a data URL
  };
  reader.readAsDataURL(file);
});

document.getElementById("confirm-save").addEventListener("click", () => {
  if (!pendingSite) return;
  pendingSite.knownFor = confirmKnownFor.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
  pendingSite.status = document.querySelector('input[name="status"]:checked').value;
  if (pendingSite.status === "visited" && pendingSite.visits.length === 0) {
    pendingSite.visits.push(todayISO());
  }
  sites.push(pendingSite);
  saveSites();
  renderPins();
  closeConfirmPanel();
});

// ---------- Detail modal ----------
const detailModal = document.getElementById("detail-modal");
const detailImage = document.getElementById("detail-image");
const detailName = document.getElementById("detail-name");
const detailLocation = document.getElementById("detail-location");
const detailKnownFor = document.getElementById("detail-known-for");
const detailVisits = document.getElementById("detail-visits");
const logVisitDate = document.getElementById("log-visit-date");

function openDetailModal(siteId) {
  activeSiteId = siteId;
  renderDetailModal();
  detailModal.hidden = false;
}

function renderDetailModal() {
  const site = sites.find((s) => s.id === activeSiteId);
  if (!site) return;

  detailImage.src = site.imageUrl || placeholderImage();
  detailImage.alt = site.name;
  detailImage.style.objectPosition = site.imagePosition || "50% 50%";
  detailName.textContent = site.name;
  detailLocation.textContent = [site.city, site.country].filter(Boolean).join(", ");

  detailKnownFor.innerHTML = "";
  for (const fact of site.knownFor) {
    const li = document.createElement("li");
    li.textContent = fact;
    detailKnownFor.appendChild(li);
  }

  detailVisits.innerHTML = "";
  if (site.visits.length === 0) {
    detailVisits.innerHTML = `<li class="muted" style="border:none;">Not logged yet</li>`;
  } else {
    for (const date of [...site.visits].sort().reverse()) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${formatDate(date)}</span>`;
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "remove";
      removeBtn.addEventListener("click", () => {
        site.visits = site.visits.filter((d) => d !== date);
        if (site.visits.length === 0) site.status = "wantToVisit";
        saveSites();
        renderDetailModal();
        renderPins();
      });
      li.appendChild(removeBtn);
      detailVisits.appendChild(li);
    }
  }

  logVisitDate.value = todayISO();
}

document.getElementById("log-visit-btn").addEventListener("click", () => {
  const site = sites.find((s) => s.id === activeSiteId);
  if (!site || !logVisitDate.value) return;
  if (!site.visits.includes(logVisitDate.value)) {
    site.visits.push(logVisitDate.value);
  }
  site.status = "visited";
  saveSites();
  renderDetailModal();
  renderPins();
});

document.getElementById("delete-pin-btn").addEventListener("click", () => {
  if (!activeSiteId) return;
  if (!confirm("Remove this pin? This can't be undone.")) return;
  sites = sites.filter((s) => s.id !== activeSiteId);
  saveSites();
  renderPins();
  closeDetailModal();
});

function closeDetailModal() {
  detailModal.hidden = true;
  activeSiteId = null;
}
document.querySelector("[data-close-detail]").addEventListener("click", closeDetailModal);

// ---------- Export / Import ----------
document.getElementById("export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(sites, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `atlas-sites-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

const importInput = document.getElementById("import-file");
document.getElementById("import-btn").addEventListener("click", () => importInput.click());
importInput.addEventListener("change", async () => {
  const file = importInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error("bad format");
    sites = mergeSites(sites, imported);
    saveSites();
    renderPins();
  } catch {
    alert("Couldn't read that file — expected a JSON export from Atlas.");
  } finally {
    importInput.value = "";
  }
});

function mergeSites(existing, incoming) {
  const byId = new Map(existing.map((s) => [s.id, s]));
  for (const s of incoming) byId.set(s.id, s);
  return [...byId.values()];
}

// ---------- Drag-to-reposition image crop ----------
function makeImageDraggable(imgEl, getPosition, setPosition, onDragEnd) {
  let dragging = false;
  let startX, startY, startPosX, startPosY;

  function currentPosition() {
    const [x, y] = (getPosition() || "50% 50%").split(" ").map((v) => parseFloat(v));
    return { x: isNaN(x) ? 50 : x, y: isNaN(y) ? 50 : y };
  }

  function onDown(e) {
    dragging = true;
    imgEl.classList.add("dragging");
    const point = e.touches ? e.touches[0] : e;
    startX = point.clientX;
    startY = point.clientY;
    const pos = currentPosition();
    startPosX = pos.x;
    startPosY = pos.y;
    e.preventDefault();
  }

  function onMove(e) {
    if (!dragging) return;
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - startX;
    const dy = point.clientY - startY;
    const rect = imgEl.getBoundingClientRect();
    const newX = clamp(startPosX - (dx / rect.width) * 100, 0, 100);
    const newY = clamp(startPosY - (dy / rect.height) * 100, 0, 100);
    const posStr = `${newX}% ${newY}%`;
    imgEl.style.objectPosition = posStr;
    setPosition(posStr);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    imgEl.classList.remove("dragging");
    if (onDragEnd) onDragEnd();
  }

  imgEl.addEventListener("mousedown", onDown);
  imgEl.addEventListener("touchstart", onDown, { passive: false });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("mouseup", onUp);
  window.addEventListener("touchend", onUp);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

makeImageDraggable(
  confirmImage,
  () => (pendingSite ? pendingSite.imagePosition : "50% 50%"),
  (pos) => {
    if (pendingSite) pendingSite.imagePosition = pos;
  }
);

makeImageDraggable(
  detailImage,
  () => {
    const s = sites.find((s) => s.id === activeSiteId);
    return s ? s.imagePosition : "50% 50%";
  },
  (pos) => {
    const s = sites.find((s) => s.id === activeSiteId);
    if (s) s.imagePosition = pos;
  },
  () => saveSites()
);

// ---------- Helpers ----------
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function formatDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function placeholderImage() {
  return "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="220"><rect width="100%" height="100%" fill="#e6d8b8"/><text x="50%" y="50%" font-family="Georgia" font-size="16" fill="#2b1b12" text-anchor="middle">No image yet</text></svg>`
  );
}

// ---------- Init ----------
renderPins();
