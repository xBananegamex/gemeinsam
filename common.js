// Gemeinsame Hilfsfunktionen für alle Seiten

// Liste aller Spiele – neue Spiele hier eintragen
const GAMES = {
  imposter: { name: "Imposter", desc: "Alle kennen das geheime Wort – nur einer nicht. Findet ihn!", min: 3, max: 12, ready: true },
  codewort: { name: "Codewort", desc: "Zwei Teams, ein Wortraster und knifflige Ein-Wort-Hinweise.", min: 4, max: 12, ready: false },
  kritzeln: { name: "Kritzeln", desc: "Einer zeichnet, alle anderen raten – auf Zeit.", min: 2, max: 12, ready: false },
};

const PLAYER_COLORS = ["#ff2a3d", "#ffffff", "#ff7a85", "#b3121f", "#c9c9ce", "#ff4f9a", "#ffb3b9", "#7a7a80"];

function storageGet(store, key) { try { return store.getItem(key); } catch { return null; } }
function storageSet(store, key, val) { try { store.setItem(key, val); } catch {} }

// Eine ID pro Browser-Tab (so kann man lokal mit mehreren Tabs testen)
function getPlayerId() {
  let id = storageGet(sessionStorage, "gemeinsam-pid");
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    storageSet(sessionStorage, "gemeinsam-pid", id);
  }
  return id;
}

function getName() { return storageGet(localStorage, "gemeinsam-name") || ""; }
function setName(name) { storageSet(localStorage, "gemeinsam-name", name); }

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function normalizeCode(code) { return (code || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Spieler nach Beitrittszeit sortiert
function sortedPlayers(players) {
  return Object.entries(players || {})
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => (a.joined || 0) - (b.joined || 0));
}

// Host = gespeicherter Host, oder (falls der gegangen ist) der am längsten anwesende Spieler
function effectiveHost(room) {
  if (room.players && room.players[room.host]) return room.host;
  const list = sortedPlayers(room.players);
  return list.length ? list[0].id : null;
}

function showModeBadge() {
  if (Backend.mode !== "local") return;
  const b = document.createElement("div");
  b.className = "mode-badge";
  document.body.classList.add("has-badge");
  b.textContent = "Testmodus: Räume funktionieren nur zwischen Tabs in diesem Browser";
  document.body.appendChild(b);
}
