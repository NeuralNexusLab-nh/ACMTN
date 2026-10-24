(() => {
  const link = document.getElementById("onion-access");
  if (!link || location.hostname.endsWith(".onion")) return;
  let timer;
  const refresh = async () => {
    try {
      const response = await fetch("/api/onion", { cache: "no-store", credentials: "omit" });
      if (!response.ok) return;
      const onion = await response.json();
      const ready = onion.state === "ready" && /^http:\/\/[a-z2-7]{56}\.onion$/.test(onion.url);
      link.hidden = !ready;
      if (ready) link.href = `${onion.url}/`;
      if (onion.enabled && onion.state !== "invalid_key") timer = setTimeout(refresh, ready ? 60000 : 15000);
    } catch { link.hidden = true; timer = setTimeout(refresh, 15000); }
  };
  refresh();
  addEventListener("pagehide", () => clearTimeout(timer));
  addEventListener("pageshow", event => { if (event.persisted) { clearTimeout(timer); refresh(); } });
})();
