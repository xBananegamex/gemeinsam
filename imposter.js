// Spiel: Imposter
// Ablauf: Lobby → Wort ansehen & reihum Hinweise geben → Abstimmung → Auflösung
const ImposterGame = (() => {
  const WORDS = {
    "Tiere": ["Elefant", "Pinguin", "Giraffe", "Hamster", "Krokodil", "Eule", "Delfin", "Känguru", "Schnecke", "Fuchs"],
    "Essen": ["Pizza", "Döner", "Spaghetti", "Pfannkuchen", "Sushi", "Brezel", "Currywurst", "Eis", "Salat", "Burger"],
    "Orte": ["Strand", "Krankenhaus", "Flughafen", "Schule", "Kino", "Bahnhof", "Zoo", "Bibliothek", "Freibad", "Supermarkt"],
    "Berufe": ["Pilot", "Bäcker", "Polizist", "Lehrer", "Feuerwehrmann", "Arzt", "Koch", "Friseur", "Astronaut", "Gärtner"],
    "Gegenstände": ["Regenschirm", "Zahnbürste", "Schlüssel", "Kerze", "Brille", "Rucksack", "Uhr", "Spiegel", "Kissen", "Gitarre"],
    "Sport": ["Fußball", "Schwimmen", "Tennis", "Skifahren", "Boxen", "Basketball", "Klettern", "Reiten", "Tischtennis", "Handball"],
    "Freizeit": ["Zelten", "Videospiele", "Kochen", "Angeln", "Tanzen", "Bowling", "Karaoke", "Puzzeln", "Wandern", "Shoppen"]
  };

  let revealedRound = null; // nur lokal: hat dieser Spieler seine Karte aufgedeckt?

  const nameOf = (room, id) => (room.players && room.players[id] ? room.players[id].name : "Jemand (weg)");

  function startRound(room, ctx) {
    const ids = sortedPlayers(room.players).map(p => p.id);
    const category = pickRandom(Object.keys(WORDS));
    const word = pickRandom(WORDS[category]);
    Backend.update(ctx.path, {
      state: "playing",
      round: {
        n: ((room.round && room.round.n) || 0) + 1,
        category, word,
        imposter: pickRandom(ids),
        starter: pickRandom(ids),
        players: ids,
        showCategory: room.settings ? room.settings.showCategory !== false : true
      }
    });
  }

  function tally(room) {
    const counts = {};
    Object.values((room.round && room.round.votes) || {}).forEach(t => (counts[t] = (counts[t] || 0) + 1));
    return counts;
  }

  // ---------- Ansichten ----------
  function lobbyView(room, ctx) {
    const count = Object.keys(room.players || {}).length;
    const showCat = !room.settings || room.settings.showCategory !== false;
    return `
      <div class="panel">
        <h2>Imposter – Warteraum</h2>
        <p class="muted">Alle bekommen dasselbe geheime Wort – nur der Imposter nicht. Reihum sagt jeder ein Wort dazu. Danach wird abgestimmt, wer der Imposter ist.</p>
        <h3 class="sub">Spieler (${count})</h3>
        ${renderPlayerList(room, ctx)}
        ${ctx.isHost ? `
          <label class="check"><input type="checkbox" data-action="toggle-category" ${showCat ? "checked" : ""}> Imposter sieht die Kategorie als Hinweis</label>
          <button class="btn btn-primary big" data-action="start" ${count < 3 ? "disabled" : ""}>Spiel starten</button>
          ${count < 3 ? `<p class="muted">Mindestens 3 Spieler nötig – teile den Link oben!</p>` : ""}`
        : `<p class="muted">Warte, bis der Host das Spiel startet …</p>`}
      </div>`;
  }

  function playingView(room, ctx) {
    const r = room.round;
    const inRound = r.players.includes(ctx.pid);
    const isImposter = r.imposter === ctx.pid;
    const revealed = revealedRound === r.n;
    let card;
    if (!inRound) card = `<div class="secret-card"><p>Diese Runde läuft schon. Du bist in der nächsten dabei!</p></div>`;
    else if (!revealed) card = `<button class="secret-card hidden" data-action="reveal">Tippen, um deine Karte anzusehen</button>`;
    else if (isImposter) card = `
      <button class="secret-card imposter" data-action="hide">
        <span class="label">Du bist der</span><strong>IMPOSTER</strong>
        ${r.showCategory ? `<span class="label">Kategorie: ${escapeHtml(r.category)}</span>` : `<span class="label">Kein Hinweis – bluffe gut!</span>`}
      </button>`;
    else card = `
      <button class="secret-card word" data-action="hide">
        <span class="label">Das geheime Wort</span><strong>${escapeHtml(r.word)}</strong>
        <span class="label">Kategorie: ${escapeHtml(r.category)}</span>
      </button>`;

    return `
      <div class="panel">
        <h2>Runde ${r.n}</h2>
        ${card}
        <p class="hint"><strong>${escapeHtml(nameOf(room, r.starter))}</strong> beginnt. Reihum sagt jeder <em>ein</em> Wort zum Begriff – nicht zu offensichtlich!</p>
        ${ctx.isHost ? `<button class="btn btn-primary big" data-action="to-vote">Zur Abstimmung</button>` : `<p class="muted">Der Host startet die Abstimmung, wenn alle dran waren.</p>`}
      </div>`;
  }

  function votingView(room, ctx) {
    const r = room.round;
    const votes = r.votes || {};
    const voters = r.players.filter(id => room.players && room.players[id]);
    const done = voters.filter(id => votes[id]).length;
    const canVote = r.players.includes(ctx.pid);
    return `
      <div class="panel">
        <h2>Wer ist der Imposter?</h2>
        <p class="muted">${done}/${voters.length} haben abgestimmt</p>
        <div class="vote-grid">
          ${voters.map(id => `
            <button class="vote-btn ${votes[ctx.pid] === id ? "selected" : ""}" data-action="vote" data-target="${id}" ${!canVote || id === ctx.pid ? "disabled" : ""}>
              <i class="avatar" style="background:${room.players[id].color}"></i>${escapeHtml(nameOf(room, id))}
              ${votes[id] ? `<span class="tag">✓</span>` : ""}
            </button>`).join("")}
        </div>
        ${ctx.isHost ? `<button class="btn btn-primary big" data-action="reveal-result">Auflösen</button>` : ""}
      </div>`;
  }

  function resultView(room, ctx) {
    const r = room.round;
    const counts = tally(room);
    const max = Math.max(0, ...Object.values(counts));
    const top = Object.keys(counts).filter(id => counts[id] === max);
    const caught = max > 0 && top.length === 1 && top[0] === r.imposter;
    return `
      <div class="panel">
        <h2 class="${caught ? "win" : "lose"}">${caught ? "Imposter enttarnt!" : "Der Imposter ist entkommen!"}</h2>
        <p class="big-text">Der Imposter war <strong>${escapeHtml(nameOf(room, r.imposter))}</strong>.<br>Das Wort war <strong>${escapeHtml(r.word)}</strong>.</p>
        <h3 class="sub">Stimmen</h3>
        ${renderPlayerList(room, ctx, p => `<span class="votes">${counts[p.id] || 0} ${counts[p.id] === 1 ? "Stimme" : "Stimmen"}</span>`)}
        ${ctx.isHost ? `
          <div class="btn-row">
            <button class="btn btn-primary" data-action="start" ${Object.keys(room.players || {}).length < 3 ? "disabled" : ""}>Neue Runde</button>
            <button class="btn btn-secondary" data-action="to-lobby">Zum Warteraum</button>
          </div>` : `<p class="muted">Warte auf den Host …</p>`}
      </div>`;
  }

  return {
    render(room, ctx) {
      if (room.state === "playing" && room.round) return playingView(room, ctx);
      if (room.state === "voting" && room.round) return votingView(room, ctx);
      if (room.state === "result" && room.round) return resultView(room, ctx);
      return lobbyView(room, ctx);
    },

    onAction(action, data, room, ctx) {
      switch (action) {
        case "reveal": revealedRound = room.round.n; break;
        case "hide": revealedRound = null; break;
        case "vote": Backend.set(`${ctx.path}/round/votes/${ctx.pid}`, data.target); return;
        case "toggle-category":
          if (ctx.isHost) Backend.set(`${ctx.path}/settings/showCategory`, !(room.settings && room.settings.showCategory === false) ? false : true);
          return;
        case "start": if (ctx.isHost) startRound(room, ctx); return;
        case "to-vote": if (ctx.isHost) Backend.update(ctx.path, { state: "voting" }); return;
        case "reveal-result": if (ctx.isHost) Backend.update(ctx.path, { state: "result" }); return;
        case "to-lobby": if (ctx.isHost) Backend.update(ctx.path, { state: "lobby", round: null }); return;
      }
      // lokale Änderung → neu zeichnen
      document.getElementById("room-root").innerHTML = this.render(room, ctx);
    }
  };
})();
