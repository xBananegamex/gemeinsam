// =====================================================================
// Spiel: Imposter
// Ablauf:
//   Warteraum → Antwortrunden (reihum, mit Timer) → Diskussion/Abstimmung
//   → (falscher Spieler: setzt aus, weiter) | (Imposter: darf Wort raten) → Ergebnis
// Jederzeit ab Runde 2: Spieler können pausieren & abstimmen,
//   der Imposter kann sich outen und das Wort raten.
// =====================================================================
const ImposterGame = (() => {
  const WORDS = {
    "Tiere": ["Elefant", "Pinguin", "Giraffe", "Hamster", "Krokodil", "Eule", "Delfin", "Känguru", "Schnecke", "Fuchs", "Papagei", "Hai"],
    "Essen": ["Pizza", "Döner", "Spaghetti", "Pfannkuchen", "Sushi", "Brezel", "Currywurst", "Eis", "Salat", "Burger", "Popcorn", "Schokolade"],
    "Orte": ["Strand", "Krankenhaus", "Flughafen", "Schule", "Kino", "Bahnhof", "Zoo", "Bibliothek", "Freibad", "Supermarkt", "Friedhof", "Freizeitpark"],
    "Berufe": ["Pilot", "Bäcker", "Polizist", "Lehrer", "Feuerwehrmann", "Arzt", "Koch", "Friseur", "Astronaut", "Gärtner", "Zauberer", "Youtuber"],
    "Gegenstände": ["Regenschirm", "Zahnbürste", "Schlüssel", "Kerze", "Brille", "Rucksack", "Uhr", "Spiegel", "Kissen", "Gitarre", "Handy", "Fernbedienung"],
    "Sport": ["Fußball", "Schwimmen", "Tennis", "Skifahren", "Boxen", "Basketball", "Klettern", "Reiten", "Tischtennis", "Handball", "Golf", "Surfen"],
    "Freizeit": ["Zelten", "Videospiele", "Kochen", "Angeln", "Tanzen", "Bowling", "Karaoke", "Puzzeln", "Wandern", "Shoppen", "Grillen", "Lesen"]
  };
  const CUSTOM_CAT = "Eigene Wörter";
  const DEFAULTS = { timer: 60, minRounds: 2, showCategory: true, customWords: "", onlyCustom: false, categories: null };
  const TIMEOUT_TEXT = "⏱ keine Antwort";

  // ---------- Lokaler Zustand (nur in diesem Browser) ----------
  let cardOpen = false;
  let draft = "";
  let guessDraft = "";
  let lastRoom = null, lastCtx = null;
  let hostCooldown = 0;

  // ---------- Hilfsfunktionen ----------
  const settingsOf = room => ({ ...DEFAULTS, ...(room.settings || {}) });
  const present = (room, id) => !!(room.players && room.players[id]);
  const nameOf = (room, id) => (room.players && room.players[id] ? room.players[id].name : "Jemand (weg)");
  const colorOf = (room, id) => (room.players && room.players[id] ? room.players[id].color : "#444");
  const norm = s => String(s || "").toLowerCase().trim()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
  const parseCustom = text => [...new Set(String(text || "").split(",").map(w => w.trim()).filter(Boolean))];
  const clueOf = (round, r, id) => (round.clues && round.clues[r] ? round.clues[r][id] : undefined);
  const isOut = (round, id, r) => !!(round.out && round.out[id] === r);
  const turnEnd = timer => (timer ? Date.now() + timer * 1000 : 0);

  // Wer ist gerade dran? Erster in der Reihenfolge, der anwesend ist, nicht aussetzt und noch nichts geschrieben hat
  function currentPlayer(room, round = room.round) {
    const r = round.clueRound;
    return round.order.find(id => present(room, id) && !isOut(round, id, r) && clueOf(round, r, id) == null) || null;
  }

  function enabledCategories(s) {
    const all = Object.keys(WORDS);
    if (!s.categories) return all;
    const picked = all.filter(c => s.categories[c]);
    return picked.length ? picked : all;
  }

  function pickWord(room) {
    const s = settingsOf(room);
    const custom = parseCustom(s.customWords).map(word => ({ word, category: CUSTOM_CAT }));
    let pool = s.onlyCustom && custom.length ? custom : [
      ...custom,
      ...enabledCategories(s).flatMap(cat => WORDS[cat].map(word => ({ word, category: cat })))
    ];
    const used = room.usedWords || {};
    const fresh = pool.filter(p => !used[norm(p.word)]);
    return pickRandom(fresh.length ? fresh : pool);
  }

  // Zustand nach einer abgeschlossenen Antwortrunde
  function afterRoundComplete(round, upd) {
    const r = round.clueRound;
    if (r < round.minRounds) {
      upd["round/clueRound"] = r + 1;
      upd["round/turnEnds"] = turnEnd(round.timer);
    } else {
      upd.state = "discussion";
      upd["round/discussReason"] = "rounds";
      upd["round/votes"] = null;
    }
  }

  // ---------- Aktionen, die die Datenbank ändern ----------
  function startGame(room, ctx) {
    const s = settingsOf(room);
    const ids = sortedPlayers(room.players).map(p => p.id);
    const { word, category } = pickWord(room);
    hostCooldown = Date.now() + 1500;
    cardOpen = false; draft = ""; guessDraft = "";
    Backend.update(ctx.path, {
      state: "clues",
      [`usedWords/${norm(word) || "x"}`]: true,
      round: {
        n: ((room.round && room.round.n) || 0) + 1,
        word, category,
        imposter: pickRandom(ids),
        order: shuffle(ids),
        players: ids,
        clueRound: 1,
        timer: Number(s.timer) || 0,
        minRounds: Number(s.minRounds) || 2,
        showCategory: s.showCategory !== false,
        turnEnds: turnEnd(Number(s.timer) || 0)
      }
    });
  }

  function submitClue(room, ctx, who, text) {
    const round = room.round;
    const r = round.clueRound;
    const upd = { [`round/clues/${r}/${who}`]: text, "round/event": null };
    // Vorausberechnen, wer danach dran ist
    const sim = JSON.parse(JSON.stringify(round));
    sim.clues = sim.clues || {};
    sim.clues[r] = sim.clues[r] || {};
    sim.clues[r][who] = text;
    if (currentPlayer(room, sim)) upd["round/turnEnds"] = turnEnd(round.timer);
    else afterRoundComplete(round, upd);
    Backend.update(ctx.path, upd);
  }

  function startVote(room, ctx) {
    Backend.update(ctx.path, {
      state: "discussion",
      "round/discussReason": "pause",
      "round/pausedBy": ctx.pid,
      "round/votes": null
    });
  }

  function resolveVotes(room, ctx) {
    const round = room.round;
    const r = round.clueRound;
    const votes = round.votes || {};
    const counts = {};
    Object.entries(votes).forEach(([voter, target]) => {
      if (present(room, voter)) counts[target] = (counts[target] || 0) + 1;
    });
    const max = Math.max(0, ...Object.values(counts));
    const leaders = Object.keys(counts).filter(k => counts[k] === max);
    const target = max > 0 && leaders.length === 1 && leaders[0] !== "skip" ? leaders[0] : null;
    hostCooldown = Date.now() + 1500;

    if (target && target === round.imposter) {
      Backend.update(ctx.path, { state: "guess", "round/guessReason": "voted", "round/revealed": true });
      return;
    }

    const complete = !currentPlayer(room);
    const nextRound = complete ? r + 1 : r;
    const upd = {
      state: "clues",
      "round/clueRound": nextRound,
      "round/votes": null,
      "round/turnEnds": turnEnd(round.timer)
    };
    if (target) {
      const outRound = complete || clueOf(round, r, target) != null ? r + 1 : r;
      upd[`round/out/${target}`] = outRound;
      upd["round/event"] = `${nameOf(room, target)} war NICHT der Imposter und setzt ${outRound === nextRound ? "diese" : "die nächste"} Runde aus.`;
    } else {
      upd["round/event"] = leaders.length > 1 ? "Gleichstand – niemand wurde rausgewählt. Es geht weiter!" : "Es wurde geskippt – es geht weiter!";
    }
    Backend.update(ctx.path, upd);
  }

  function finish(ctx, winner, reason, extra = {}) {
    hostCooldown = Date.now() + 1500;
    Backend.update(ctx.path, { state: "result", "round/winner": winner, "round/reason": reason, "round/revealed": true, ...extra });
  }

  // Wird regelmäßig nur beim Host ausgeführt: Timer, fehlende Spieler, automatische Auswertung
  function hostTick() {
    const room = lastRoom, ctx = lastCtx;
    if (!room || !ctx || !ctx.isHost || !room.round || Date.now() < hostCooldown) return;
    const round = room.round;
    const active = ["clues", "discussion", "guess"].includes(room.state);
    if (active && !present(room, round.imposter)) { finish(ctx, "crew", "left"); return; }

    if (room.state === "clues") {
      const cur = currentPlayer(room);
      if (!cur) {
        hostCooldown = Date.now() + 1500;
        const upd = {};
        afterRoundComplete(round, upd);
        Backend.update(ctx.path, upd);
      } else if (round.timer && round.turnEnds && Date.now() > round.turnEnds + 800) {
        hostCooldown = Date.now() + 1500;
        submitClue(room, ctx, cur, TIMEOUT_TEXT);
      }
    }

    if (room.state === "discussion") {
      const voters = round.players.filter(id => present(room, id));
      const votes = round.votes || {};
      if (voters.length && voters.every(id => votes[id])) resolveVotes(room, ctx);
    }
  }

  // Countdown-Anzeige + Host-Tick
  setInterval(() => {
    document.querySelectorAll("[data-ends]").forEach(el => {
      const ends = Number(el.dataset.ends);
      const left = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
      el.textContent = `${left}s`;
      el.classList.toggle("urgent", left <= 10);
    });
    hostTick();
  }, 250);

  // ---------- Bausteine für die Ansicht ----------
  function playerStrip(room, ctx) {
    const round = room.round;
    const cur = room.state === "clues" ? currentPlayer(room) : null;
    return `<div class="strip">${round.order.filter(id => present(room, id)).map(id => {
      const out = round.out && round.out[id] >= round.clueRound && room.state !== "result";
      const imp = round.revealed && id === round.imposter;
      return `<div class="chip ${id === cur ? "turn" : ""} ${out ? "out" : ""} ${imp ? "imp" : ""}">
        <i class="avatar" style="background:${colorOf(room, id)}"></i>
        <span>${escapeHtml(nameOf(room, id))}${id === ctx.pid ? " (du)" : ""}</span>
        ${out ? `<small>setzt aus</small>` : ""}${imp ? `<small>Imposter</small>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  function cluesTable(room, ctx) {
    const round = room.round;
    const rounds = Math.max(1, round.clueRound);
    const cur = room.state === "clues" ? currentPlayer(room) : null;
    const ids = round.order.filter(id => present(room, id) || Object.values(round.clues || {}).some(c => c && c[id] != null));
    const head = Array.from({ length: rounds }, (_, i) => `<th>Runde ${i + 1}</th>`).join("");
    const rows = ids.map(id => {
      const imp = round.revealed && id === round.imposter;
      const cells = Array.from({ length: rounds }, (_, i) => {
        const r = i + 1;
        const c = clueOf(round, r, id);
        if (c != null) return `<td class="${c === TIMEOUT_TEXT ? "muted" : ""}">${escapeHtml(c)}</td>`;
        if (isOut(round, id, r)) return `<td class="muted">– setzt aus –</td>`;
        if (id === cur && r === round.clueRound) return `<td class="writing">schreibt …</td>`;
        return `<td class="muted"></td>`;
      }).join("");
      return `<tr class="${imp ? "imp" : ""} ${id === ctx.pid ? "me" : ""}"><th><i class="avatar" style="background:${colorOf(room, id)}"></i>${escapeHtml(nameOf(room, id))}</th>${cells}</tr>`;
    }).join("");
    return `<div class="table-wrap"><table class="clues"><thead><tr><th>Spieler</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function secretCard(room, ctx) {
    const round = room.round;
    if (!round.players.includes(ctx.pid)) return `<div class="secret-card small"><p>Dieses Spiel läuft schon – du bist beim nächsten dabei!</p></div>`;
    if (!cardOpen) return `<button class="secret-card small hidden" data-action="toggle-card">Tippen, um deine Karte anzusehen</button>`;
    if (round.imposter === ctx.pid) return `
      <button class="secret-card small imposter" data-action="toggle-card">
        <span class="label">Du bist der</span><strong>IMPOSTER</strong>
        <span class="label">${round.showCategory ? `Hinweis – Kategorie: ${escapeHtml(round.category)}` : "Kein Hinweis – bluffe gut!"}</span>
      </button>`;
    return `
      <button class="secret-card small word" data-action="toggle-card">
        <span class="label">Das geheime Wort</span><strong>${escapeHtml(round.word)}</strong>
        <span class="label">Kategorie: ${escapeHtml(round.category)}</span>
      </button>`;
  }

  function actionButtons(room, ctx) {
    const round = room.round;
    if (!round.players.includes(ctx.pid) || round.clueRound < 2) return "";
    return `<div class="btn-row">
      <button class="btn btn-secondary" data-action="start-vote">⏸ Pausieren &amp; abstimmen</button>
      ${round.imposter === ctx.pid ? `<button class="btn btn-primary" data-action="self-reveal">Ich bin der Imposter – Wort raten</button>` : ""}
    </div>`;
  }

  // ---------- Ansichten ----------
  function lobbyView(room, ctx) {
    const s = settingsOf(room);
    const count = Object.keys(room.players || {}).length;
    const custom = parseCustom(s.customWords);
    const cats = enabledCategories(s);
    const timerOpts = [[30, "30 Sekunden"], [45, "45 Sekunden"], [60, "1 Minute"], [90, "1,5 Minuten"], [120, "2 Minuten"], [0, "Ohne Zeitlimit"]];
    const settings = ctx.isHost ? `
      <h3 class="sub">Einstellungen</h3>
      <div class="settings">
        <label class="field">Zeit pro Antwort
          <select id="set-timer" data-change="setting" data-key="timer" data-type="number">
            ${timerOpts.map(([v, l]) => `<option value="${v}" ${Number(s.timer) === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
        <label class="field">Runden bis zur Diskussion
          <select id="set-rounds" data-change="setting" data-key="minRounds" data-type="number">
            ${[1, 2, 3, 4].map(v => `<option value="${v}" ${Number(s.minRounds) === v ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </label>
        <label class="check"><input type="checkbox" id="set-cat" data-change="setting" data-key="showCategory" data-type="bool" ${s.showCategory ? "checked" : ""}> Imposter bekommt die Kategorie als Hinweis</label>
        <div class="field">Kategorien
          <div class="cat-grid">${Object.keys(WORDS).map(c => `
            <label class="pill"><input type="checkbox" data-change="category" data-cat="${c}" ${cats.includes(c) ? "checked" : ""}> ${c}</label>`).join("")}
          </div>
        </div>
        <label class="field">Eigene Wörter <span class="muted">(mit Komma trennen)</span>
          <textarea id="set-words" rows="3" maxlength="3000" placeholder="z. B. Minecraft, Schulbus, Omas Kuchen" data-change="setting" data-key="customWords">${escapeHtml(s.customWords)}</textarea>
          <span class="muted small">${custom.length ? `${custom.length} eigene Wörter gespeichert` : "Wird gespeichert, sobald du aus dem Feld klickst."}</span>
        </label>
        <label class="check"><input type="checkbox" id="set-only" data-change="setting" data-key="onlyCustom" data-type="bool" ${s.onlyCustom ? "checked" : ""} ${custom.length ? "" : "disabled"}> Nur eigene Wörter verwenden</label>
      </div>
      <button class="btn btn-primary big" data-action="start" ${count < 3 ? "disabled" : ""}>Spiel starten</button>
      ${count < 3 ? `<p class="muted">Mindestens 3 Spieler nötig – teile den Link oben!</p>` : ""}`
      : `
      <h3 class="sub">Einstellungen (vom Host)</h3>
      <p class="muted">${s.timer ? `${s.timer} Sekunden pro Antwort` : "Ohne Zeitlimit"} · ${s.minRounds} Runden bis zur Diskussion · Kategorie-Hinweis ${s.showCategory ? "an" : "aus"}${custom.length ? ` · ${custom.length} eigene Wörter${s.onlyCustom ? " (nur diese)" : ""}` : ""}</p>
      <p class="muted">Warte, bis der Host das Spiel startet …</p>`;

    return `
      <div class="panel">
        <h2>Imposter – Warteraum</h2>
        <p class="muted">Alle bekommen dasselbe geheime Wort – nur der Imposter nicht. Reihum schreibt jeder ein Wort dazu. Danach wird diskutiert und abgestimmt.</p>
        <h3 class="sub">Spieler (${count})</h3>
        ${renderPlayerList(room, ctx)}
        ${settings}
      </div>`;
  }

  function cluesView(room, ctx) {
    const round = room.round;
    const cur = currentPlayer(room);
    const myTurn = cur === ctx.pid;
    const timer = round.timer && round.turnEnds ? `<span class="countdown" data-ends="${round.turnEnds}"></span>` : "";
    const turnBox = myTurn ? `
      <form class="turn-box mine" data-submit="clue">
        <div class="turn-head"><strong>Du bist dran!</strong> ${timer}</div>
        <div class="join">
          <input id="clue-input" data-input="clue" maxlength="30" placeholder="Dein Wort …" autocomplete="off" value="${escapeHtml(draft)}">
          <button class="btn btn-primary">Abschicken</button>
        </div>
      </form>` : `
      <div class="turn-box">
        <div class="turn-head">${cur ? `<span><strong>${escapeHtml(nameOf(room, cur))}</strong> schreibt …</span> ${timer}` : "Runde wird abgeschlossen …"}</div>
      </div>`;

    return `
      <div class="panel wide">
        <div class="phase-head"><h2>Runde ${round.clueRound}</h2><span class="muted">${round.clueRound <= round.minRounds ? `von ${round.minRounds} Pflichtrunden` : "Zusatzrunde"}</span></div>
        ${round.event ? `<div class="event">${escapeHtml(round.event)}</div>` : ""}
        ${playerStrip(room, ctx)}
        ${secretCard(room, ctx)}
        ${turnBox}
        ${cluesTable(room, ctx)}
        ${actionButtons(room, ctx)}
        ${round.clueRound < 2 ? `<p class="muted small">Nach Runde 1 könnt ihr pausieren und abstimmen.</p>` : ""}
      </div>`;
  }

  function discussionView(room, ctx) {
    const round = room.round;
    const votes = round.votes || {};
    const voters = round.players.filter(id => present(room, id));
    const done = voters.filter(id => votes[id]).length;
    const canVote = round.players.includes(ctx.pid);
    const pause = round.discussReason === "pause";
    const title = pause ? `${escapeHtml(nameOf(room, round.pausedBy))} hat pausiert` : "Diskussion";
    const text = pause
      ? "Diskutiert! Stimmt dann für den Imposter – oder skippt, um weiterzuspielen."
      : "Alle Pflichtrunden sind gespielt. Wählt jemanden raus – oder spielt noch eine Runde.";
    const skipLabel = pause ? "Skippen – weiterspielen" : "Noch eine Runde spielen";
    return `
      <div class="panel wide">
        <div class="phase-head"><h2>${title}</h2><span class="muted">${done}/${voters.length} haben abgestimmt</span></div>
        <p class="muted">${text} Wird ein falscher Spieler gewählt, setzt er eine Runde aus.</p>
        ${playerStrip(room, ctx)}
        ${cluesTable(room, ctx)}
        <div class="vote-grid">
          ${voters.map(id => `
            <button class="vote-btn ${votes[ctx.pid] === id ? "selected" : ""}" data-action="vote" data-target="${id}" ${!canVote || id === ctx.pid ? "disabled" : ""}>
              <i class="avatar" style="background:${colorOf(room, id)}"></i>${escapeHtml(nameOf(room, id))}
              ${votes[id] ? `<span class="tag">✓</span>` : ""}
            </button>`).join("")}
          <button class="vote-btn skip ${votes[ctx.pid] === "skip" ? "selected" : ""}" data-action="vote" data-target="skip" ${canVote ? "" : "disabled"}>⏭ ${skipLabel}</button>
        </div>
        ${secretCard(room, ctx)}
        ${round.imposter === ctx.pid ? `<div class="btn-row"><button class="btn btn-primary" data-action="self-reveal">Ich bin der Imposter – Wort raten</button></div>` : ""}
        ${ctx.isHost ? `<button class="btn btn-secondary big" data-action="resolve">Jetzt auswerten</button>` : ""}
      </div>`;
  }

  function guessView(room, ctx) {
    const round = room.round;
    const imp = escapeHtml(nameOf(room, round.imposter));
    const intro = round.guessReason === "self"
      ? `<strong class="red">${imp}</strong> hat sich als Imposter geoutet!`
      : `<strong class="red">${imp}</strong> wurde rausgewählt – und ist tatsächlich der Imposter!`;
    const box = round.imposter === ctx.pid ? `
      <form class="turn-box mine" data-submit="guess">
        <div class="turn-head"><strong>Was ist das geheime Wort?</strong></div>
        <div class="join">
          <input id="guess-input" data-input="guess" maxlength="40" placeholder="Dein Tipp …" autocomplete="off" value="${escapeHtml(guessDraft)}">
          <button class="btn btn-primary">Raten</button>
        </div>
      </form>` : `<div class="turn-box"><div class="turn-head">${imp} rät jetzt das Wort. Errät er es, gewinnt der Imposter.</div></div>`;
    return `
      <div class="panel wide">
        <h2>Letzte Chance</h2>
        <p class="big-text">${intro}</p>
        ${playerStrip(room, ctx)}
        ${box}
        ${cluesTable(room, ctx)}
      </div>`;
  }

  function resultView(room, ctx) {
    const round = room.round;
    const imp = escapeHtml(nameOf(room, round.imposter));
    const guess = round.guess ? `„${escapeHtml(round.guess)}“` : "";
    const reasons = {
      "guess-right": `${imp} hat das Wort richtig erraten: ${guess}`,
      "guess-wrong": `${imp} hat ${guess} geraten – leider falsch!`,
      "accepted": `${imp} hat ${guess} geraten – der Host hat es gelten lassen.`,
      "left": `${imp} (Imposter) hat das Spiel verlassen.`
    };
    const impWin = round.winner === "imposter";
    return `
      <div class="panel wide">
        <h2 class="${impWin ? "lose" : "win"}">${impWin ? "Der Imposter gewinnt!" : "Die Spieler gewinnen!"}</h2>
        <p class="big-text">${reasons[round.reason] || ""}<br>Das Wort war <strong>${escapeHtml(round.word)}</strong> (${escapeHtml(round.category)}). Imposter: <strong class="red">${imp}</strong></p>
        ${playerStrip(room, ctx)}
        ${cluesTable(room, ctx)}
        ${ctx.isHost ? `
          <div class="btn-row">
            <button class="btn btn-primary" data-action="start" ${Object.keys(room.players || {}).length < 3 ? "disabled" : ""}>Neues Spiel</button>
            <button class="btn btn-secondary" data-action="to-lobby">Zum Warteraum &amp; Einstellungen</button>
            ${round.reason === "guess-wrong" ? `<button class="btn btn-ghost" data-action="accept-guess">Tipp doch gelten lassen</button>` : ""}
          </div>` : `<p class="muted">Warte auf den Host …</p>`}
      </div>`;
  }

  // ---------- Schnittstelle für raum.js ----------
  return {
    render(room, ctx) {
      lastRoom = room; lastCtx = ctx;
      if (room.round && room.state === "clues") return cluesView(room, ctx);
      if (room.round && room.state === "discussion") return discussionView(room, ctx);
      if (room.round && room.state === "guess") return guessView(room, ctx);
      if (room.round && room.state === "result") return resultView(room, ctx);
      return lobbyView(room, ctx);
    },

    onAction(action, el, room, ctx) {
      const round = room.round;
      switch (action) {
        case "toggle-card": cardOpen = !cardOpen; ctx.rerender(); break;
        case "start": if (ctx.isHost) startGame(room, ctx); break;
        case "start-vote": if (room.state === "clues") startVote(room, ctx); break;
        case "vote": Backend.set(`${ctx.path}/round/votes/${ctx.pid}`, el.dataset.target); break;
        case "resolve": if (ctx.isHost) resolveVotes(room, ctx); break;
        case "self-reveal":
          if (round && round.imposter === ctx.pid && confirm("Wirklich outen? Du hast nur einen Versuch, das Wort zu erraten."))
            Backend.update(ctx.path, { state: "guess", "round/guessReason": "self", "round/revealed": true });
          break;
        case "accept-guess": if (ctx.isHost) Backend.update(ctx.path, { "round/winner": "imposter", "round/reason": "accepted" }); break;
        case "to-lobby": if (ctx.isHost) Backend.update(ctx.path, { state: "lobby" }); break;
      }
    },

    onInput(name, el) {
      if (name === "clue") draft = el.value;
      if (name === "guess") guessDraft = el.value;
    },

    onChange(name, el, room, ctx) {
      if (!ctx.isHost) return;
      if (name === "setting") {
        const t = el.dataset.type;
        const val = t === "bool" ? el.checked : t === "number" ? Number(el.value) : el.value;
        Backend.set(`${ctx.path}/settings/${el.dataset.key}`, val);
      }
      if (name === "category") {
        const cats = {};
        el.closest(".cat-grid").querySelectorAll("[data-cat]").forEach(c => (cats[c.dataset.cat] = c.checked));
        if (!Object.values(cats).some(Boolean)) { el.checked = true; return; } // mindestens eine Kategorie
        Backend.set(`${ctx.path}/settings/categories`, cats);
      }
    },

    onSubmit(name, form, room, ctx) {
      const round = room.round;
      if (name === "clue") {
        const text = draft.trim();
        if (!text || room.state !== "clues" || currentPlayer(room) !== ctx.pid) return;
        draft = "";
        submitClue(room, ctx, ctx.pid, text);
      }
      if (name === "guess") {
        const text = guessDraft.trim();
        if (!text || room.state !== "guess" || round.imposter !== ctx.pid) return;
        guessDraft = "";
        const right = norm(text) === norm(round.word);
        finish(ctx, right ? "imposter" : "crew", right ? "guess-right" : "guess-wrong", { "round/guess": text });
      }
    }
  };
})();
