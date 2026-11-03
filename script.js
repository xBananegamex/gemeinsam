// Startseite (Lobby): Name, Raum beitreten, Raum für ein Spiel erstellen
const nameInput = document.getElementById("player-name");
const codeInput = document.getElementById("room-code");
const errorBox = document.getElementById("lobby-error");

nameInput.value = getName();
nameInput.addEventListener("input", () => setName(nameInput.value.trim()));

function requireName() {
  const name = nameInput.value.trim();
  if (!name) {
    errorBox.textContent = "Bitte gib zuerst deinen Namen ein.";
    nameInput.focus();
    return null;
  }
  setName(name);
  errorBox.textContent = "";
  return name;
}

function renderGames() {
  const list = document.getElementById("game-list");
  list.innerHTML = Object.entries(GAMES).map(([id, g]) => `
    <div class="room game ${g.ready ? "" : "soon"}">
      <span class="status ${g.ready ? "live" : "waiting"}">${g.ready ? "● SPIELBAR" : "○ BALD"}</span>
      <h3>${escapeHtml(g.name)}</h3>
      <p class="game-desc">${escapeHtml(g.desc)}</p>
      <small>${g.min}–${g.max} Spieler</small>
      <button class="btn ${g.ready ? "btn-primary" : "btn-ghost"} create-btn" data-game="${id}" ${g.ready ? "" : "disabled"}>
        ${g.ready ? "+ Raum erstellen" : "In Arbeit"}
      </button>
    </div>`).join("");
}

async function createRoom(gameId) {
  if (!requireName()) return;
  await Backend.init();
  let code;
  for (let i = 0; i < 5; i++) {
    code = randomCode();
    if (!(await Backend.get(`rooms/${code}`))) break;
  }
  await Backend.set(`rooms/${code}`, {
    game: gameId,
    host: getPlayerId(),
    state: "lobby",
    created: Date.now()
  });
  location.href = `raum.html?code=${code}`;
}

document.getElementById("game-list").addEventListener("click", e => {
  const btn = e.target.closest(".create-btn");
  if (btn && !btn.disabled) createRoom(btn.dataset.game);
});

document.getElementById("join-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (!requireName()) return;
  const code = normalizeCode(codeInput.value);
  if (!code) { errorBox.textContent = "Bitte gib einen Raumcode ein."; return; }
  await Backend.init();
  const room = await Backend.get(`rooms/${code}`);
  if (!room) { errorBox.textContent = `Raum ${code} wurde nicht gefunden.`; return; }
  location.href = `raum.html?code=${code}`;
});

// ---------- Discord ----------
function renderDiscord() {
  const box = document.getElementById("discord-box");
  if (!Discord.enabled()) { box.innerHTML = ""; return; }
  if (Discord.isLoggedIn()) {
    box.innerHTML = `<span class="discord-me">${avatarHtml({ avatar: getAvatar() })} Mit Discord angemeldet</span>
      <button class="btn btn-small btn-ghost" id="discord-logout">Abmelden</button>`;
    document.getElementById("discord-logout").onclick = () => { Discord.logout(); renderDiscord(); };
  } else {
    box.innerHTML = `<button class="btn btn-small btn-discord" id="discord-login">Mit Discord anmelden</button>`;
    document.getElementById("discord-login").onclick = () => Discord.login();
  }
}

(async () => {
  const r = await Discord.handleRedirect();
  if (r && r.error) errorBox.textContent = r.error;
  if (r && r.ok) {
    nameInput.value = getName();
    if (r.returnCode) { location.href = `raum.html?code=${r.returnCode}`; return; }
  }
  renderDiscord();
})();

renderGames();
showModeBadge();
