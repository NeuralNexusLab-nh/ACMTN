(() => {
  "use strict";
  if (location.hostname.endsWith(".onion")) document.documentElement.classList.add("onion-access");
  const link = document.getElementById("alternate-address");
  if (!link) return;
  const brand = location.hostname.startsWith("neutron.") ? "acmtn" : "neutron";
  link.href = location.hostname.endsWith(".onion")
    ? `http://${brand}.nxlabtwhcegzi5f65qb6ri4iv72rtdp5q7s4w457pahcohtmegjregqd.onion/`
    : `https://${brand}.nxlabtw.com/`;
  fetch("/api/site", { cache: "no-store", credentials: "omit" })
    .then((response) => { if (!response.ok) throw new Error("site unavailable"); return response.json(); })
    .then((site) => {
      const allowed = ["https://acmtn.nxlabtw.com/", "https://neutron.nxlabtw.com/",
        "http://acmtn.nxlabtwhcegzi5f65qb6ri4iv72rtdp5q7s4w457pahcohtmegjregqd.onion/",
        "http://neutron.nxlabtwhcegzi5f65qb6ri4iv72rtdp5q7s4w457pahcohtmegjregqd.onion/"];
      if (allowed.includes(site.alternateAddress)) link.href = site.alternateAddress;
    }).catch(() => {});
})();
