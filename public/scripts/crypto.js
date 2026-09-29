(() => {
  "use strict";
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const KDF_ITERATIONS = 600_000;
  const KDF_SALT = textEncoder.encode("ACMTN/PIN/v1");
  const AAD = textEncoder.encode("ACMTN/message/v1");

  function toBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  }

  function fromBase64Url(value) {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function isAsciiPin(pin) {
    return typeof pin === "string" && pin.length > 0 && pin.length <= 255 && /^[\x00-\x7F]+$/.test(pin);
  }

  function isValidNickname(nickname) {
    return typeof nickname === "string" && Array.from(nickname.trim()).length > 0 && Array.from(nickname).length <= 255;
  }

  async function sha256(value) {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", value));
  }

  async function deriveRoom(pin) {
    if (!isAsciiPin(pin)) throw new Error("invalid_pin");
    const pinKey = await crypto.subtle.importKey("raw", textEncoder.encode(pin), "PBKDF2", false, ["deriveBits"]);
    const material = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: KDF_SALT, iterations: KDF_ITERATIONS }, pinKey, 512));
    const lookupInput = new Uint8Array(textEncoder.encode("ACMTN/room-lookup/v1").length + 32);
    lookupInput.set(textEncoder.encode("ACMTN/room-lookup/v1"));
    lookupInput.set(material.slice(0, 32), textEncoder.encode("ACMTN/room-lookup/v1").length);
    const roomHash = toBase64Url(await sha256(lookupInput));
    const key = await crypto.subtle.importKey("raw", material.slice(32, 64), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    material.fill(0);
    return { roomHash, key };
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  async function encryptMessage(key, payload) {
    const nonce = randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: AAD, tagLength: 128 }, key, textEncoder.encode(JSON.stringify(payload)));
    return { nonce: toBase64Url(nonce), ciphertext: toBase64Url(new Uint8Array(ciphertext)) };
  }

  async function decryptMessage(key, message) {
    try {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(message.nonce), additionalData: AAD, tagLength: 128 }, key, fromBase64Url(message.ciphertext));
      const payload = JSON.parse(textDecoder.decode(plaintext));
      if (!payload || payload.messageId !== message.id || !isValidNickname(payload.nickname) || typeof payload.message !== "string" || typeof payload.timestampUtc !== "string") return null;
      return payload;
    } catch {
      return null;
    }
  }

  window.ACMTNCrypto = { decryptMessage, deriveRoom, encryptMessage, isAsciiPin, isValidNickname, randomId: () => toBase64Url(randomBytes(16)) };
})();
