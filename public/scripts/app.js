(() => {
  "use strict";
  function initialiseHome() {
    const pin = document.getElementById("room-pin");
    const error = document.getElementById("join-error");
    const button = document.getElementById("enter-room");
    const joinRoom = async () => {
      error.hidden = true;
      if (!ACMTNCrypto.isAsciiPin(pin.value)) { error.textContent = "Use 1–255 ASCII characters."; error.hidden = false; return; }
      button.disabled = true;
      const original = button.textContent; button.textContent = "Preparing…";
      try {
        const room = await ACMTNCrypto.deriveRoom(pin.value);
        sessionStorage.setItem("acmtn:entry-pin", pin.value);
        pin.value = "";
        location.assign(`/room?hash=${encodeURIComponent(room.roomHash)}`);
      } catch { error.textContent = "Unable to create this room. Try again."; error.hidden = false; button.disabled = false; button.textContent = original; }
    };
    button.onclick = joinRoom;
    pin.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); joinRoom(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiseHome, { once: true });
  else initialiseHome();
})();
