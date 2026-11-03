// Raumseite: Beitreten, Spielerliste, und Übergabe an das jeweilige Spiel
const GAME_MODULES = { imposter: ImposterGame };

const root = document.getElementById("room-root");
const code = normalizeCode(new URLSearchParams(location.search).get("code"));
const pid = getPlayerId();
document.getElementById("room-code-label").textContent = code || "–";

document.getElementById("copy-link").addEventListener("click", async e => {
  const link = `${location.origin}${location.pathname}?code=${code}`;
  try { await navigator.clipboard.writeText(link); e.target.textContent = "Kopiert!"; }
  catch { prompt("Link zum Raum:", link); }
  setTimeout(() => (e.target.textContent = "Link kopieren"), 1500);
});

function askName() {
  return new Promise(resolve => {
    root.innerHTML = `
      <div class="panel narrow">
        <h2>Wie heißt du?</h2>
        <form id="name-form" class="join">
          <input id="name-input" maxlength="20" placeholder="Dein Name" autocomplete="off" required>
          <button class="btn btn-primary">Beitreten</button>
        </form>
      </div>`;
    const input = document.getElementById("name-input");
    input.focus();
    document.getElementById("name-form").addEventListener("submit", e => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      setName(name);
      resolve(name);
    });
  });
}

// Event-Weiterleitung: Buttons mit data-action werden ans Spielmodul gegeben
let currentRoom = null;
let ctx = null;
root.addEventListener("click", e => {
  const el = e.target.closest("[data-action]");
  if (!el || !currentRoom || !ctx) return;
  const mod = GAME_MODULES[currentRoom.game];
  if (mod && mod.onAction) mod.onAction(el.dataset.action, el.dataset, currentRoom, ctx);
});

async function start() {
  if (!code) { root.innerHTML = `<div class="panel narrow"><h2>Kein Raumcode</h2><a class="btn btn-primary" href="./">Zur Lobby</a></div>`; return; }
  await Backend.init();
  showModeBadge();

  const room = await Backend.get(`rooms/${code}`);
  if (!room) {
    root.innerHTML = `<div class="panel narrow"><h2>Raum ${escapeHtml(code)} existiert nicht</h2><p class="muted">Vielleicht ist er abgelaufen oder der Code ist falsch.</p><a class="btn btn-primary" href="./">Zur Lobby</a></div>`;
    return;
  }

  const name = getName() || (await askName());
  const players = room.players || {};
  const color = PLAYER_COLORS[Object.keys(players).filter(id => id !== pid).length % PLAYER_COLORS.length];
  await Backend.set(`rooms/${code}/players/${pid}`, {
    name, color, joined: (players[pid] && players[pid].joined) || Date.now()
  });
  Backend.onDisconnectRemove(`rooms/${code}/players/${pid}`);

  Backend.on(`rooms/${code}`, data => {
    if (!data) { root.innerHTML = `<div class="panel narrow"><h2>Der Raum wurde geschlossen</h2><a class="btn btn-primary" href="./">Zur Lobby</a></div>`; return; }
    currentRoom = data;
    const host = effectiveHost(data);
    ctx = { pid, code, isHost: host === pid, host, path: `rooms/${code}` };
    const mod = GAME_MODULES[data.game];
    root.innerHTML = mod ? mod.render(data, ctx) : `<div class="panel">Unbekanntes Spiel.</div>`;
  });
}

// Spielerliste als HTML (von Spielmodulen nutzbar)
function renderPlayerList(room, ctx, extra = () => "") {
  const host = effectiveHost(room);
  return `<ul class="player-list">${sortedPlayers(room.players).map(p => `
    <li class="${p.id === ctx.pid ? "me" : ""}">
      <i class="avatar" style="background:${p.color}"></i>
      <span>${escapeHtml(p.name)}${p.id === ctx.pid ? " (du)" : ""}</span>
      ${p.id === host ? `<span class="tag">Host</span>` : ""}
      ${extra(p)}
    </li>`).join("")}</ul>`;
}

start();
