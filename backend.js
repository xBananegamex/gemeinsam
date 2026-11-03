// Einheitliche Schnittstelle für die Echtzeit-Datenbank.
// Mit Firebase-Config → Firebase Realtime Database (Spieler auf verschiedenen Geräten).
// Ohne Config → lokaler Testmodus über localStorage (nur Tabs im selben Browser).
const Backend = (() => {
  const cfg = window.FIREBASE_CONFIG || {};
  const useFirebase = !!cfg.apiKey;
  const FB_VERSION = "10.12.2";
  let db = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function init() {
    if (!useFirebase || db) return;
    await loadScript(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${FB_VERSION}/firebase-database-compat.js`);
    firebase.initializeApp(cfg);
    db = firebase.database();
  }

  // ---------- Lokaler Testmodus ----------
  const KEY = "gemeinsam-local-db";
  const listeners = [];
  const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
  const parts = p => p.split("/").filter(Boolean);

  function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function writeAll(data) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
    notify();
  }
  function getPath(obj, path) {
    return parts(path).reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, val) {
    const ks = parts(path);
    let o = obj;
    for (let i = 0; i < ks.length - 1; i++) {
      if (typeof o[ks[i]] !== "object" || o[ks[i]] === null) o[ks[i]] = {};
      o = o[ks[i]];
    }
    const last = ks[ks.length - 1];
    if (val === null || val === undefined) delete o[last];
    else o[last] = clone(val);
  }
  function notify() {
    const data = readAll();
    listeners.slice().forEach(l => l.cb(clone(getPath(data, l.path))));
  }
  window.addEventListener("storage", e => { if (e.key === KEY) notify(); });

  // ---------- Öffentliche Funktionen ----------
  return {
    mode: useFirebase ? "firebase" : "local",
    init,

    async get(path) {
      if (db) return (await db.ref(path).get()).val();
      return clone(getPath(readAll(), path));
    },

    async set(path, val) {
      if (db) return db.ref(path).set(val);
      const d = readAll(); setPath(d, path, val); writeAll(d);
    },

    // obj darf Schlüssel mit "/" enthalten, z. B. { "round/votes/abc": "xyz" }
    async update(path, obj) {
      if (db) return db.ref(path).update(obj);
      const d = readAll();
      for (const [k, v] of Object.entries(obj)) setPath(d, `${path}/${k}`, v);
      writeAll(d);
    },

    on(path, cb) {
      if (db) {
        const ref = db.ref(path);
        const handler = snap => cb(snap.val());
        ref.on("value", handler);
        return () => ref.off("value", handler);
      }
      const l = { path, cb };
      listeners.push(l);
      setTimeout(() => cb(clone(getPath(readAll(), path))));
      return () => listeners.splice(listeners.indexOf(l), 1);
    },

    // Entfernt einen Eintrag automatisch, wenn der Spieler die Seite verlässt
    onDisconnectRemove(path) {
      if (db) return db.ref(path).onDisconnect().remove();
      window.addEventListener("pagehide", () => {
        const d = readAll(); setPath(d, path, null); writeAll(d);
      });
    }
  };
})();
