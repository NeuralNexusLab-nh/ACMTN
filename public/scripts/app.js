(() => {
  "use strict";
  function initialiseHome() {
    const pin = document.getElementById("room-pin");
    const error = document.getElementById("join-error");
    const button = document.getElementById("enter-room");
    const original = button.textContent;
    const resetButton = () => { button.disabled = false; button.textContent = original; };
    const joinRoom = async () => {
      if (button.disabled) return;
      error.hidden = true;
      if (!ACMTNCrypto.isAsciiPin(pin.value)) { error.textContent = "Use 1–255 ASCII characters."; error.hidden = false; return; }
      button.disabled = true; button.textContent = "Preparing…";
      try {
        const room = await ACMTNCrypto.deriveRoom(pin.value);
        // Storage may be disabled in private browsers. Joining must still work:
        // the room page can ask for the PIN again when handoff is unavailable.
        try { sessionStorage.setItem("acmtn:entry-pin", pin.value); } catch {}
        pin.value = "";
        location.assign(`/room?hash=${encodeURIComponent(room.roomHash)}`);
      } catch {
        error.textContent = "Unable to create or join this room. Check that browser encryption is available and try again.";
        error.hidden = false;
        resetButton();
      }
    };
    button.onclick = joinRoom;
    pin.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); joinRoom(); } });
    // Back navigation may restore this document with its pending button state.
    addEventListener("pageshow", resetButton);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiseHome, { once: true });
  else initialiseHome();
})();

