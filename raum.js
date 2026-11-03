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

// ---------- Ereignisse an das Spielmodul weiterleiten ----------
// data-action="x"  → Klick      → mod.onAction("x", element, room, ctx)
// data-change="x"  → Änderung   → mod.onChange("x", element, room, ctx)
// data-input="x"   → Tippen     → mod.onInput("x", element, room, ctx)
// data-submit="x"  → Formular   → mod.onSubmit("x", form, room, ctx)
let currentRoom = null;
let ctx = null;
const mod = () => currentRoom && GAME_MODULES[currentRoom.game];

root.addEventListener("click", e => {
  const el = e.target.closest("[data-action]");
  if (el && !el.disabled && mod() && mod().onAction) mod().onAction(el.dataset.action, el, currentRoom, ctx);
});
root.addEventListener("change", e => {
  const el = e.target.closest("[data-change]");
  if (el && mod() && mod().onChange) mod().onChange(el.dataset.change, el, currentRoom, ctx);
});
root.addEventListener("input", e => {
  const el = e.target.closest("[data-input]");
  if (el && mod() && mod().onInput) mod().onInput(el.dataset.input, el, currentRoom, ctx);
});
root.addEventListener("submit", e => {
  const form = e.target.closest("[data-submit]");
  if (!form) return;
  e.preventDefault();
  if (mod() && mod().onSubmit) mod().onSubmit(form.dataset.submit, form, currentRoom, ctx);
});

// Neu zeichnen, ohne dass ein gerade genutztes Eingabefeld seinen Inhalt/Fokus verliert
function draw(html) {
  const active = document.activeElement;
  const keep = active && active.id && root.contains(active)
    ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd }
    : null;
  root.innerHTML = html;
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      if (typeof keep.value === "string" && el.value !== undefined && el.type !== "checkbox") el.value = keep.value;
      el.focus();
      try { if (keep.start != null) el.setSelectionRange(keep.start, keep.end); } catch {}
    }
  }
}

function rerender() {
  if (!currentRoom || !ctx) return;
  const m = mod();
  draw(m ? m.render(currentRoom, ctx) : `<div class="panel">Unbekanntes Spiel.</div>`);
}

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
    ctx = { pid, code, isHost: host === pid, host, path: `rooms/${code}`, rerender };
    rerender();
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
