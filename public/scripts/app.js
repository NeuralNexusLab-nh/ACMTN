(() => {
  "use strict";
  function initialiseHome() {
    document.getElementById("year").textContent = new Date().getFullYear();
    const form = document.getElementById("join-form");
    const pin = document.getElementById("room-pin");
    const error = document.getElementById("join-error");
    const button = document.getElementById("enter-room");
    const joinRoom = async () => {
      error.hidden = true;
      if (!ACMTNCrypto.isAsciiPin(pin.value)) { error.textContent = ACMTNI18n.t("invalidPin"); error.hidden = false; return; }
      button.disabled = true;
      const original = button.textContent; button.textContent = ACMTNI18n.t("deriving", "Preparing secure room…");
      try {
        const room = await ACMTNCrypto.deriveRoom(pin.value);
        sessionStorage.setItem("acmtn:entry-pin", pin.value);
        pin.value = "";
        location.assign(`/room?hash=${encodeURIComponent(room.roomHash)}`);
      } catch { error.textContent = ACMTNI18n.t("genericError"); error.hidden = false; button.disabled = false; button.textContent = original; }
    };
    button.onclick = joinRoom;
    pin.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); joinRoom(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiseHome, { once: true });
  else initialiseHome();
})();
