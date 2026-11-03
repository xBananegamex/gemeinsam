// Beispiel-Räume – später durch echte Daten (z. B. Firebase/Supabase) ersetzen
const rooms = [
  { name: "Nachtschicht", players: 5, max: 8, live: true,  colors: ["#ff2a3d", "#ffffff", "#7a7a80"] },
  { name: "Chill-Lounge", players: 3, max: 10, live: true, colors: ["#ffffff", "#ff2a3d"] },
  { name: "Turnier #1",   players: 1, max: 4, live: false, colors: ["#b3121f"] },
];

function renderRooms() {
  const list = document.getElementById("room-list");
  list.innerHTML = rooms.map(r => `
    <div class="room">
      <span class="status ${r.live ? "live" : "waiting"}">${r.live ? "● LIVE" : "○ WARTET"}</span>
      <h3>${r.name}</h3>
      <small>${r.players}/${r.max} Spieler</small>
      <div class="avatars">${r.colors.map(c => `<i style="background:${c}"></i>`).join("")}</div>
    </div>`).join("");
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = n => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${pick(3)}-${pick(2)}`;
}

document.getElementById("join-form").addEventListener("submit", e => {
  e.preventDefault();
  const code = document.getElementById("room-code").value.trim();
  if (!code) return;
  alert(`Beitreten zu Raum ${code} – Funktion folgt bald!`);
});

document.getElementById("create-room").addEventListener("click", () => {
  const code = randomCode();
  rooms.unshift({ name: `Neuer Raum ${code}`, players: 1, max: 8, live: false, colors: ["#ff2a3d"] });
  renderRooms();
});

renderRooms();
