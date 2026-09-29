(() => {
  "use strict";
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("year").textContent = new Date().getFullYear();
    const form = document.getElementById("join-form");
    const pin = document.getElementById("room-pin");
    const error = document.getElementById("join-error");
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); error.hidden = true;
      if (!ACMTNCrypto.isAsciiPin(pin.value)) { error.textContent = ACMTNI18n.t("invalidPin"); error.hidden = false; return; }
      const button = form.querySelector("button"); button.disabled = true;
      const original = button.textContent; button.textContent = ACMTNI18n.t("deriving", "Preparing secure room…");
      try {
        const room = await ACMTNCrypto.deriveRoom(pin.value);
        sessionStorage.setItem("acmtn:entry-pin", pin.value);
        pin.value = "";
        location.assign(`/room?hash=${encodeURIComponent(room.roomHash)}`);
      } catch { error.textContent = ACMTNI18n.t("genericError"); error.hidden = false; button.disabled = false; button.textContent = original; }
    });
  });
})();
