import "/scripts/crypto.js";
await window.ACMTNCryptoReady;
(() => {
  "use strict";
  function initialiseHome() {
    const pin = document.getElementById("room-pin");
    const error = document.getElementById("join-error");
    const button = document.getElementById("enter-room");
    const publicLink = document.getElementById("public-room");
    const original = button.textContent;
    const resetButton = () => { button.disabled = false; button.textContent = original; publicLink.removeAttribute("aria-disabled"); };
    const joinRoom = async (roomPin = pin.value) => {
      if (button.disabled) return;
      error.hidden = true;
      if (!ACMTNCrypto.isAsciiPin(roomPin)) { error.textContent = "Use 1–255 ASCII characters."; error.hidden = false; return; }
      button.disabled = true; button.textContent = "Preparing…";
      publicLink.setAttribute("aria-disabled", "true");
      try {
        const room = await ACMTNCrypto.deriveRoom(roomPin);
        // Storage may be disabled in private browsers. Joining must still work:
        // the room page can ask for the PIN again when handoff is unavailable.
        try { sessionStorage.setItem("acmtn:entry-pin", roomPin); } catch {}
        pin.value = "";
        location.assign(`/room?hash=${encodeURIComponent(room.roomHash)}`);
      } catch {
        error.textContent = "Unable to create or join this room. Check that browser encryption is available and try again.";
        error.hidden = false;
        resetButton();
      }
    };
    button.onclick = () => joinRoom();
    publicLink.onclick = (event) => { event.preventDefault(); joinRoom("public"); };
    pin.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); joinRoom(); } });
    // Back navigation may restore this document with its pending button state.
    addEventListener("pageshow", resetButton);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiseHome, { once: true });
  else initialiseHome();
})();

