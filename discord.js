// Discord-Login (OAuth2, nur Lesen von Name + Profilbild – Scope "identify").
// Es wird KEIN Token gespeichert, nur Name und Profilbild-Adresse.
const Discord = (() => {
  const clientId = () => window.DISCORD_CLIENT_ID || "";
  // Zurück zur Startseite im selben Ordner, z. B. https://xbananegamex.github.io/gemeinsam/
  const redirectUri = () => location.origin + location.pathname.replace(/[^/]*$/, "");

  function enabled() { return !!clientId(); }

  function login(returnCode = "") {
    const state = randomId() + randomId() + (returnCode ? "." + normalizeCode(returnCode) : "");
    storageSet(sessionStorage, "gemeinsam-discord-state", state);
    const params = new URLSearchParams({
      client_id: clientId(), response_type: "token", redirect_uri: redirectUri(),
      scope: "identify", state, prompt: "none"
    });
    location.href = `https://discord.com/oauth2/authorize?${params}`;
  }

  function logout() { setAvatar(""); storageSet(localStorage, "gemeinsam-discord", ""); }
  function isLoggedIn() { return !!getAvatar() && storageGet(localStorage, "gemeinsam-discord") === "1"; }

  // Wird auf der Startseite aufgerufen, wenn Discord zurückleitet (#access_token=...)
  async function handleRedirect() {
    if (!location.hash.includes("access_token") && !location.hash.includes("error")) return null;
    const h = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search); // Token sofort aus der Adresse entfernen
    const state = h.get("state") || "";
    if (h.get("error")) return { error: "Discord-Anmeldung abgebrochen." };
    if (state !== storageGet(sessionStorage, "gemeinsam-discord-state")) return { error: "Anmeldung ungültig – bitte nochmal versuchen." };
    try {
      const res = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${h.get("access_token")}` } });
      if (!res.ok) throw new Error(res.status);
      const u = await res.json();
      const avatar = u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;
      setName(String(u.global_name || u.username).slice(0, 20));
      setAvatar(avatar);
      storageSet(localStorage, "gemeinsam-discord", "1");
      return { ok: true, returnCode: state.split(".")[1] || "" };
    } catch {
      return { error: "Discord-Profil konnte nicht geladen werden." };
    }
  }

  return { enabled, login, logout, isLoggedIn, handleRedirect };
})();
