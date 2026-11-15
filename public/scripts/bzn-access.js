"use strict";
async function showBrowzenAccess() {
  try {
    const response = await fetch("/api/bzn", { credentials: "omit", cache: "no-store" });
    if (!response.ok) return;
    const status = await response.json();
    if (!status.enabled || !/^[a-z2-7]{52}\.bzn$/.test(status.address || "")) return;
    const link = document.getElementById("browzen-access");
    link.href = `https://browzen.nxlabtw.com/?bzn=${encodeURIComponent(status.address)}`;
    link.title = status.address;
    link.hidden = false;
    return true;
  } catch {}
}
// BZN starts after Express; retry briefly without blocking room entry.
(async () => {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await showBrowzenAccess()) return;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
})();
