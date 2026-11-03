// =====================================================================
// Kamera & Mikro per WebRTC (direkt von Gerät zu Gerät).
// Firebase wird nur zum "Verbindungsaufbau" genutzt (Angebot/Antwort/ICE).
// Jeder, der seine Kamera an hat, baut zu jedem anderen Spieler eine
// eigene Verbindung auf (nur senden). Pfad: rooms/{code}/rtc/{kameraSitzung}/{empfängerSitzung}
// =====================================================================
const Cam = (() => {
  const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

  let base = "", pid = "", mySess = "";
  let room = null;
  let statusOf = () => ({});
  let localStream = null, camSid = null;
  const outgoing = {};  // empfängerSitzung → Verbindung
  const incoming = {};  // senderId → Verbindung
  const tiles = {};     // spielerId → DOM-Element

  const bar = () => document.getElementById("cam-bar");

  // ---------- Hilfen ----------
  function addIce(conn, cands) {
    Object.entries(cands || {}).forEach(([k, c]) => {
      if (conn.seen.has(k) || !c) return;
      conn.seen.add(k);
      if (conn.pc.remoteDescription) conn.pc.addIceCandidate(c).catch(() => {});
      else conn.pending.push(c);
    });
  }
  function flush(conn) {
    conn.pending.splice(0).forEach(c => conn.pc.addIceCandidate(c).catch(() => {}));
  }
  const iceJson = c => JSON.parse(JSON.stringify(c.toJSON ? c.toJSON() : c));

  // ---------- Senden (eigene Kamera an andere) ----------
  function openOut(recvSess) {
    const pc = new RTCPeerConnection(ICE);
    const conn = { pc, unsub: [], seen: new Set(), pending: [] };
    outgoing[recvSess] = conn;
    const path = `${base}/rtc/${camSid}/${recvSess}`;
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    pc.onicecandidate = e => { if (e.candidate) Backend.set(`${path}/iceS/${randomId()}`, iceJson(e.candidate)); };
    pc.createOffer()
      .then(o => pc.setLocalDescription(o))
      .then(() => Backend.set(`${path}/offer`, { type: pc.localDescription.type, sdp: pc.localDescription.sdp }))
      .catch(err => console.warn("Angebot fehlgeschlagen", err));
    conn.unsub.push(Backend.on(`${path}/answer`, async ans => {
      if (!ans || pc.remoteDescription || conn.answering) return;
      conn.answering = true;
      try { await pc.setRemoteDescription(ans); flush(conn); } catch (err) { console.warn(err); }
    }));
    conn.unsub.push(Backend.on(`${path}/iceR`, c => addIce(conn, c)));
  }
  function closeOut(recvSess) {
    const conn = outgoing[recvSess];
    if (!conn) return;
    conn.unsub.forEach(f => f());
    conn.pc.close();
    delete outgoing[recvSess];
    if (camSid) Backend.set(`${base}/rtc/${camSid}/${recvSess}`, null);
  }

  // ---------- Empfangen (Kameras der anderen) ----------
  function openIn(senderId, sid) {
    const pc = new RTCPeerConnection(ICE);
    const conn = { pc, sid, unsub: [], seen: new Set(), pending: [], stream: null };
    incoming[senderId] = conn;
    const path = `${base}/rtc/${sid}/${mySess}`;
    pc.ontrack = e => { conn.stream = e.streams[0] || new MediaStream([e.track]); renderTiles(); };
    pc.onicecandidate = e => { if (e.candidate) Backend.set(`${path}/iceR/${randomId()}`, iceJson(e.candidate)); };
    conn.unsub.push(Backend.on(`${path}/offer`, async offer => {
      if (!offer || pc.remoteDescription || conn.answering) return;
      conn.answering = true;
      try {
        await pc.setRemoteDescription(offer);
        flush(conn);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        Backend.set(`${path}/answer`, { type: ans.type, sdp: ans.sdp });
      } catch (err) { console.warn("Antwort fehlgeschlagen", err); }
    }));
    conn.unsub.push(Backend.on(`${path}/iceS`, c => addIce(conn, c)));
  }
  function closeIn(senderId) {
    const conn = incoming[senderId];
    if (!conn) return;
    conn.unsub.forEach(f => f());
    conn.pc.close();
    delete incoming[senderId];
  }

  // ---------- Steuerung ----------
  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alert("Dein Browser unterstützt keine Kamera."); return; }
    const video = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 20 } };
    try { localStream = await navigator.mediaDevices.getUserMedia({ video, audio: true }); }
    catch {
      try { localStream = await navigator.mediaDevices.getUserMedia({ video }); }
      catch (err) { alert("Kamera konnte nicht gestartet werden: " + err.message); return; }
    }
    camSid = randomId();
    Backend.onDisconnectRemove(`${base}/rtc/${camSid}`);
    await Backend.update(`${base}/players/${pid}`, { cam: camSid, mic: localStream.getAudioTracks().length > 0, video: true });
    update(room);
  }

  async function stop() {
    Object.keys(outgoing).forEach(closeOut);
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    const old = camSid;
    camSid = null;
    await Backend.update(`${base}/players/${pid}`, { cam: null, mic: null, video: null });
    if (old) Backend.set(`${base}/rtc/${old}`, null);
    update(room);
  }

  function toggleTrack(kind) {
    const t = localStream && (kind === "mic" ? localStream.getAudioTracks()[0] : localStream.getVideoTracks()[0]);
    if (!t) return;
    t.enabled = !t.enabled;
    Backend.update(`${base}/players/${pid}`, { [kind === "mic" ? "mic" : "video"]: t.enabled });
  }

  // ---------- Anzeige ----------
  function renderControls() {
    const box = document.getElementById("cam-controls");
    if (!box) return;
    const a = localStream && localStream.getAudioTracks()[0];
    const v = localStream && localStream.getVideoTracks()[0];
    box.innerHTML = !localStream
      ? `<button class="btn btn-small btn-secondary" data-cam="start">📷 Kamera &amp; Mikro an</button>`
      : `${a ? `<button class="btn btn-small ${a.enabled ? "btn-ghost" : "btn-primary"}" data-cam="mic">${a.enabled ? "🎤 Mikro an" : "🔇 Stumm"}</button>` : ""}
         <button class="btn btn-small ${v && v.enabled ? "btn-ghost" : "btn-primary"}" data-cam="video">${v && v.enabled ? "📷 Bild an" : "🚫 Bild aus"}</button>
         <button class="btn btn-small btn-ghost" data-cam="stop">⏹ Beenden</button>`;
  }

  function renderTiles() {
    const el = bar();
    if (!el || !room) return;
    const players = room.players || {};
    const show = {};
    if (localStream) show[pid] = localStream;
    Object.entries(incoming).forEach(([id, c]) => { if (c.stream && players[id]) show[id] = c.stream; });

    // Entfernen, was nicht mehr da ist
    Object.keys(tiles).forEach(id => { if (!show[id]) { tiles[id].remove(); delete tiles[id]; } });

    sortedPlayers(players).forEach(p => {
      const stream = show[p.id];
      if (!stream) return;
      let t = tiles[p.id];
      if (!t) {
        t = document.createElement("div");
        t.className = "cam-tile";
        t.innerHTML = `<video autoplay playsinline></video><div class="cam-off"></div><span class="cam-name"></span>`;
        tiles[p.id] = t;
      }
      el.appendChild(t); // hält die Reihenfolge
      const video = t.querySelector("video");
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        video.muted = p.id === pid; // eigenes Mikro nicht hören
        video.play().catch(() => {});
      }
      const st = statusOf(room, p.id) || {};
      t.classList.toggle("me", p.id === pid);
      t.classList.toggle("out", !!st.out);
      t.classList.toggle("imp", !!st.imp);
      t.classList.toggle("novideo", p.video === false);
      t.querySelector(".cam-off").innerHTML = avatarHtml(p);
      t.querySelector(".cam-name").textContent = `${p.mic === false ? "🔇 " : ""}${p.name}${p.id === pid ? " (du)" : ""}${st.out ? " · setzt aus" : ""}`;
    });
    el.classList.toggle("empty", Object.keys(show).length === 0);
  }

  // Bei jeder Änderung im Raum aufrufen
  function update(r) {
    room = r;
    if (!room) return;
    const players = room.players || {};

    if (localStream && camSid) {
      const want = new Set(Object.entries(players).filter(([id, p]) => id !== pid && p.sess).map(([, p]) => p.sess));
      Object.keys(outgoing).forEach(s => { if (!want.has(s)) closeOut(s); });
      want.forEach(s => { if (!outgoing[s]) openOut(s); });
    }

    Object.entries(players).forEach(([id, p]) => {
      if (id === pid) return;
      const cur = incoming[id];
      if (p.cam && (!cur || cur.sid !== p.cam)) { if (cur) closeIn(id); openIn(id, p.cam); }
      else if (!p.cam && cur) closeIn(id);
    });
    Object.keys(incoming).forEach(id => { if (!players[id]) closeIn(id); });

    renderControls();
    renderTiles();
  }

  function init(code, playerId, sess, statusFn) {
    base = `rooms/${code}`; pid = playerId; mySess = sess;
    if (statusFn) statusOf = statusFn;
    document.getElementById("cam-controls").addEventListener("click", e => {
      const b = e.target.closest("[data-cam]");
      if (!b) return;
      const a = b.dataset.cam;
      if (a === "start") start();
      if (a === "stop") stop();
      if (a === "mic" || a === "video") { toggleTrack(a); renderControls(); }
    });
    renderControls();
  }

  return { init, update };
})();
