(() => {
  "use strict";
  const ROOM_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
  let room;
  let nickname = "";
  const seen = new Set();
  let pollTimer;

  function showError(element, message) { element.textContent = message; element.hidden = false; }
  function clearError(element) { element.textContent = ""; element.hidden = true; }
  function roomHashFromUrl() { return new URLSearchParams(location.search).get("hash") || ""; }

  function addMessage(payload) {
    const messages = document.getElementById("messages");
    const message = document.createElement("article"); message.className = "message";
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
    } catch { showError(document.getElementById("message-error"), ACMTNI18n.t("connectionError")); }
  }

  function startChat() {
    document.getElementById("nickname-panel").hidden = true;
    document.getElementById("chat-panel").hidden = false;
    poll(); pollTimer = setInterval(poll, 3000);
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

  document.addEventListener("DOMContentLoaded", () => {
    const expectedHash = roomHashFromUrl();
    if (!ROOM_HASH_PATTERN.test(expectedHash)) { location.replace("/404.html"); return; }
    const gateForm = document.getElementById("gate-form"); const gatePin = document.getElementById("gate-pin"); const gateError = document.getElementById("gate-error");
    const entryPin = sessionStorage.getItem("acmtn:entry-pin"); sessionStorage.removeItem("acmtn:entry-pin");
    if (entryPin) { gatePin.value = entryPin; gateForm.requestSubmit(); }
    gateForm.addEventListener("submit", async (event) => {
      event.preventDefault(); clearError(gateError);
      const button = gateForm.querySelector("button"); const original = button.textContent; button.disabled = true; button.textContent = ACMTNI18n.t("deriving", "Preparing secure room…");
      try { await openRoom(gatePin.value); gatePin.value = ""; }
      catch (error) { showError(gateError, error.message === "wrong_room" ? ACMTNI18n.t("wrongPin") : ACMTNI18n.t("invalidPin")); button.disabled = false; button.textContent = original; }
    });
    document.getElementById("nickname-form").addEventListener("submit", (event) => {
      event.preventDefault(); const input = document.getElementById("nickname"); const error = document.getElementById("nickname-error"); clearError(error);
      if (!ACMTNCrypto.isValidNickname(input.value)) { showError(error, ACMTNI18n.t("invalidNickname")); return; }
      nickname = input.value.trim(); input.value = ""; startChat();
    });
    document.getElementById("message-form").addEventListener("submit", async (event) => {
      event.preventDefault(); const input = document.getElementById("message"); const error = document.getElementById("message-error"); clearError(error);
      const messageText = input.value;
      if (!messageText.trim() || Array.from(messageText).length > 4000) { showError(error, ACMTNI18n.t("invalidMessage")); return; }
      const button = event.currentTarget.querySelector("button"); button.disabled = true;
      try {
        const id = ACMTNCrypto.randomId();
        const encrypted = await ACMTNCrypto.encryptMessage(room.key, { nickname, message: messageText, timestampUtc: new Date().toISOString(), messageId: id });
        const response = await fetch(`/api/room?hash=${encodeURIComponent(room.roomHash)}`, { method: "POST", credentials: "omit", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 1, id, ...encrypted }) });
        if (!response.ok) throw new Error("send failed");
        input.value = ""; await poll();
      } catch { showError(error, ACMTNI18n.t("sendError")); }
      finally { button.disabled = false; input.focus(); }
    });
    addEventListener("pagehide", () => { if (pollTimer) clearInterval(pollTimer); });
  });
})();
