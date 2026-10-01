(() => {
  "use strict";
  const ROOM_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  let room;
  let nickname = "";
  const seen = new Set();
  const ownMessageIds = new Set();
  let pollTimer;

  function showError(element, message) { element.textContent = message; element.hidden = false; }
  function clearError(element) { element.textContent = ""; element.hidden = true; }
  function roomHashFromUrl() { return new URLSearchParams(location.search).get("hash") || ""; }

  function addMessage(payload) {
    const messages = document.getElementById("messages");
    const message = document.createElement("article"); message.className = `message${ownMessageIds.has(payload.messageId) ? " message-own" : ""}`;
    const meta = document.createElement("div"); meta.className = "message-meta";
    const name = document.createElement("span"); name.className = "message-name"; name.textContent = payload.nickname;
    const time = document.createElement("time"); time.dateTime = payload.timestampUtc; time.textContent = new Date(payload.timestampUtc).toISOString().replace("T", " ").replace(".000Z", " UTC");
    const body = document.createElement("div"); body.className = "message-body"; body.textContent = payload.message;
    meta.append(name, time); message.append(meta, body); messages.append(message); messages.scrollTop = messages.scrollHeight;
  }

  async function poll() {
    if (!room) return;
    try {
      const response = await fetch(`/api/room?hash=${encodeURIComponent(room.roomHash)}`, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("request failed");
      const envelope = await response.json();
      for (const message of envelope.messages || []) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        const payload = await ACMTNCrypto.decryptMessage(room.key, message);
        if (payload) addMessage(payload);
      }
    } catch { showError(document.getElementById("message-error"), "Connection lost. Retrying…"); }
  }

  function startChat() {
    if (!room || !nickname || pollTimer) return;
    document.getElementById("nickname-panel").hidden = true;
    document.getElementById("chat-panel").hidden = false;
    document.getElementById("message").focus();
    poll(); pollTimer = setInterval(poll, 2000);
  }

  async function openRoom(pin) {
    const expectedHash = roomHashFromUrl();
    if (!ACMTNCrypto.isAsciiPin(pin)) throw new Error("invalid_pin");
    const derived = await ACMTNCrypto.deriveRoom(pin);
    if (derived.roomHash !== expectedHash) throw new Error("wrong_room");
    room = derived;
    document.getElementById("room-gate").hidden = true;
    document.getElementById("chat").hidden = false;
    document.getElementById("nickname").focus();
  }

  function initialiseRoom() {
    const expectedHash = roomHashFromUrl();
    if (!ROOM_HASH_PATTERN.test(expectedHash)) { location.replace("/404.html"); return; }
    const gatePin = document.getElementById("gate-pin"); const gateError = document.getElementById("gate-error"); const gateButton = document.getElementById("gate-enter");
    let entryPin = null;
    try { entryPin = sessionStorage.getItem("acmtn:entry-pin"); sessionStorage.removeItem("acmtn:entry-pin"); } catch {}
    const enterRoom = async () => {
      if (gateButton.disabled) return;
      clearError(gateError); const original = gateButton.textContent; gateButton.disabled = true; gateButton.textContent = "Preparing…";
      try { await openRoom(gatePin.value); gatePin.value = ""; }
      catch (error) { showError(gateError, error.message === "wrong_room" ? "This PIN does not match this room." : error.message === "invalid_pin" ? "Use 1–255 ASCII characters." : "Unable to unlock this room. Check that browser encryption is available and try again."); gateButton.disabled = false; gateButton.textContent = original; }
    };
    gateButton.onclick = enterRoom;
    gatePin.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); enterRoom(); } });
    if (entryPin) { gatePin.value = entryPin; enterRoom(); }
    else gatePin.focus();
    const chooseNickname = () => {
      if (!room) return;
      const input = document.getElementById("nickname"); const error = document.getElementById("nickname-error"); clearError(error);
      if (!ACMTNCrypto.isValidNickname(input.value)) { showError(error, "Use a nickname of up to 255 characters."); return; }
      nickname = input.value.trim(); input.value = ""; startChat();
    };
    document.getElementById("start-chat").onclick = chooseNickname;
    document.getElementById("nickname").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); chooseNickname(); } });
    const sendMessage = async () => {
      if (!room || !nickname) return;
      const input = document.getElementById("message"); const error = document.getElementById("message-error"); const button = document.getElementById("send-message"); clearError(error);
      const messageText = input.value;
      if (!messageText.trim() || Array.from(messageText).length > 4000) { showError(error, "Write a message of up to 4,000 characters."); return; }
      button.disabled = true;
      try {
        const id = ACMTNCrypto.randomId();
        ownMessageIds.add(id);
        const encrypted = await ACMTNCrypto.encryptMessage(room.key, { nickname, message: messageText, timestampUtc: new Date().toISOString(), messageId: id });
        const response = await fetch(`/api/room?hash=${encodeURIComponent(room.roomHash)}`, { method: "POST", credentials: "omit", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 1, id, ...encrypted }) });
        if (!response.ok) throw new Error("send failed");
        input.value = ""; await poll();
      } catch { showError(error, "Message could not be sent. Try again."); }
      finally { button.disabled = false; input.focus(); }
    };
    document.getElementById("send-message").onclick = sendMessage;
    document.getElementById("message").addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } });
    addEventListener("pagehide", () => { if (pollTimer) clearInterval(pollTimer); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialiseRoom, { once: true });
  else initialiseRoom();
})();

