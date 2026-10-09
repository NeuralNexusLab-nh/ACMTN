"use strict";

const crypto = require("node:crypto");
const express = require("express");
const path = require("node:path");
const { HandleLogin, HandleRegistration, ServerSetup } = require("@47ng/opaque-server");

const PUBLIC_DIRECTORY = path.join(__dirname, "public");
const OPAQUE_CLIENT_DIRECTORY = path.join(__dirname, "node_modules", "@47ng", "opaque-client");
const ONION_ORIGIN = "http://neutron.nxlabtwhcegzi5f65qb6ri4iv72rtdp5q7s4w457pahcohtmegjregqd.onion";
const ROOM_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_CIPHERTEXT = 32768;
const P256_PUBLIC_KEY_LENGTH = 87;
const toBase64Url = (value) => Buffer.from(value).toString("base64url");
const fromBase64Url = (value) => Buffer.from(value, "base64url");
const safeLog = () => {};
const doubleHash = (roomHash) => crypto.createHash("sha256").update(roomHash, "utf8").digest("base64url");
const isValidRoomHash = (value) => typeof value === "string" && ROOM_HASH_PATTERN.test(value);
const isEncoded = (value, min = 1, max = MAX_CIPHERTEXT) => typeof value === "string" && value.length >= min && value.length <= max && BASE64URL_PATTERN.test(value);
const roomKey = (hash) => doubleHash(hash);
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

function alternateAddress(hostname, remoteAddress) {
  const host = String(hostname || "").toLowerCase();
  const onion = host.endsWith(".onion") || ["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(remoteAddress);
  const brand = host.startsWith("neutron.") ? "acmtn" : "neutron";
  return onion ? `http://${brand}.nxlabtwhcegzi5f65qb6ri4iv72rtdp5q7s4w457pahcohtmegjregqd.onion/` : `https://${brand}.nxlabtw.com/`;
}
function opaqueSetupFromEnvironment() {
  const value = process.env.NEUTRON_OPAQUE_SERVER_SETUP;
  if (value && isEncoded(value, 32, 4096)) return ServerSetup.deserialize(fromBase64Url(value));
  safeLog("startup", { event: "Generated ephemeral OPAQUE setup; configure NEUTRON_OPAQUE_SERVER_SETUP for restart stability." });
  return new ServerSetup();
}
function p256Pair() { const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys(); return { privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey() }; }
function envelopeKey(privateKey, remoteRaw, messageHash, createdAt, purpose) {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.setPrivateKey(privateKey); const shared = ecdh.computeSecret(remoteRaw);
  const salt = crypto.createHash("sha256").update(`${messageHash}|${createdAt}`, "utf8").digest();
  return crypto.hkdfSync("sha256", shared, salt, Buffer.from(`neutron/v2/${purpose}`, "utf8"), 32);
}
function decryptEnvelope(privateKey, remoteRaw, messageHash, createdAt, purpose, nonce, ciphertext) {
  const packed = fromBase64Url(ciphertext);
  const decipher = crypto.createDecipheriv("aes-256-gcm", envelopeKey(privateKey, remoteRaw, messageHash, createdAt, purpose), fromBase64Url(nonce));
  decipher.setAuthTag(packed.subarray(-16));
  return Buffer.concat([decipher.update(packed.subarray(0, -16)), decipher.final()]);
}
function encryptEnvelope(privateKey, remoteRaw, messageHash, createdAt, purpose, plaintext) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", envelopeKey(privateKey, remoteRaw, messageHash, createdAt, purpose), nonce);
  return { nonce: toBase64Url(nonce), ciphertext: toBase64Url(Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])) };
}
function serverKeyProof(session, purpose, hash, messageHash, createdAt, publicKey) { return toBase64Url(crypto.createHmac("sha256", session.key).update(`server-${purpose}-key\n${hash}\n${messageHash}\n${createdAt}\n${publicKey}`, "utf8").digest()); }
function verifyProof(session, purpose, hash, messageHash, publicKey, proof) {
  if (!session || !isEncoded(proof, 43, 128)) return false;
  const expected = crypto.createHmac("sha256", session.key).update(`${purpose}\n${hash}\n${messageHash || ""}\n${publicKey || ""}`, "utf8").digest();
  const received = fromBase64Url(proof);
  return received.length === expected.length && crypto.timingSafeEqual(expected, received);
}
function validContent(content) { return content && Array.isArray(content.nonces) && content.nonces.length === 3 && content.nonces.every((nonce) => isEncoded(nonce, 16, 32)) && isEncoded(content.ciphertext, 17, MAX_CIPHERTEXT); }

function createApp({ messageTtlMs = 15000, authTtlMs = 600000, handshakeTtlMs = 30000, opaqueRecordTtlMs = 3600000, cleanupIntervalMs = 1000 } = {}) {
  const app = express(); const rooms = new Map(); const opaqueRecords = new Map(); const registrationStates = new Map(); const loginStates = new Map(); const sessions = new Map(); const preparations = new Map();
  const opaqueSetup = opaqueSetupFromEnvironment();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.set({ "Cache-Control": "no-store, max-age=0", "Clear-Site-Data": "\"cache\"", "Content-Security-Policy": "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'", "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Resource-Policy": "same-origin", "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" });
    if (!String(request.hostname || "").endsWith(".onion")) response.set("Onion-Location", `${ONION_ORIGIN}${request.originalUrl}`); next();
  });
  app.use(express.json({ limit: "48kb", strict: true, type: "application/json" }));
  app.get("/api/site", (request, response) => response.json({ alternateAddress: alternateAddress(request.hostname, request.socket.remoteAddress) }));
  app.get("/", (_request, response) => response.sendFile(path.join(PUBLIC_DIRECTORY, "index.html")));
  app.get("/room", (request, response) => !isValidRoomHash(request.query.hash) ? response.status(404).sendFile(path.join(PUBLIC_DIRECTORY, "404.html")) : response.sendFile(path.join(PUBLIC_DIRECTORY, "room.html")));

  app.post("/api/auth/register/start", (request, response) => {
    const { hash, request: opaqueRequest } = request.body || {}; if (!isValidRoomHash(hash) || !isEncoded(opaqueRequest, 1, 4096)) return response.status(400).json({ error: "invalid_request" });
    const key = roomKey(hash); if (opaqueRecords.has(key)) return response.status(409).json({ error: "record_exists" });
    try { const handler = new HandleRegistration(opaqueSetup); const opaqueResponse = handler.start(Buffer.from(hash), fromBase64Url(opaqueRequest)); handler.free(); const nonce = randomToken(); registrationStates.set(nonce, { key, expiresAt: Date.now() + handshakeTtlMs }); safeLog("auth", { action: "OPAQUE registration started", algorithm: "OPAQUE" }); return response.json({ nonce, response: toBase64Url(opaqueResponse) }); } catch { return response.status(400).json({ error: "invalid_opaque_request" }); }
  });
  app.post("/api/auth/register/finish", (request, response) => {
    const { nonce, record } = request.body || {}; const state = registrationStates.get(nonce); if (!state || !isEncoded(record, 1, 8192)) return response.status(401).json({ error: "registration_expired" });
    try { const handler = new HandleRegistration(opaqueSetup); const passwordFile = handler.finish(fromBase64Url(record)); opaqueRecords.set(state.key, { passwordFile: Buffer.from(passwordFile), expiresAt: Date.now() + opaqueRecordTtlMs }); registrationStates.delete(nonce); safeLog("auth", { action: "OPAQUE credential record stored", storage: "RAM only", ttlMs: opaqueRecordTtlMs }); return response.status(204).send(); } catch { return response.status(400).json({ error: "invalid_opaque_record" }); }
  });
  app.post("/api/auth/login/start", (request, response) => {
    const { hash, request: opaqueRequest } = request.body || {}; const record = isValidRoomHash(hash) ? opaqueRecords.get(roomKey(hash)) : null;
    if (!record || record.expiresAt <= Date.now() || !isEncoded(opaqueRequest, 1, 4096)) return response.status(401).json({ error: "authentication_failed" });
    try { record.expiresAt = Date.now() + opaqueRecordTtlMs; const handler = new HandleLogin(opaqueSetup); const opaqueResponse = handler.start(record.passwordFile, Buffer.from(hash), fromBase64Url(opaqueRequest)); const nonce = randomToken(); loginStates.set(nonce, { key: roomKey(hash), serialized: Buffer.from(handler.serialize()), expiresAt: Date.now() + handshakeTtlMs }); handler.free(); safeLog("auth", { action: "OPAQUE login started", algorithm: "OPAQUE", recordTtlMs: opaqueRecordTtlMs }); return response.json({ nonce, response: toBase64Url(opaqueResponse) }); } catch { return response.status(401).json({ error: "authentication_failed" }); }
  });
  app.post("/api/auth/login/finish", (request, response) => {
    const { nonce, final } = request.body || {}; const state = loginStates.get(nonce); if (!state || !isEncoded(final, 1, 4096)) return response.status(401).json({ error: "authentication_expired" });
    try { const handler = HandleLogin.deserialize(state.serialized, opaqueSetup); const key = Buffer.from(handler.finish(fromBase64Url(final))); const sessionId = randomToken(); sessions.set(sessionId, { key, roomKey: state.key, expiresAt: Date.now() + authTtlMs }); loginStates.delete(nonce); safeLog("auth", { action: "OPAQUE session established", algorithm: "OPAQUE" }); return response.json({ sessionId, expiresInMs: authTtlMs }); } catch { return response.status(401).json({ error: "authentication_failed" }); }
  });
  app.get("/api/room", (request, response) => {
    if (!isValidRoomHash(request.query.hash)) return response.status(404).json({ error: "room_not_found" });
    const messages = (rooms.get(roomKey(request.query.hash)) || []).filter((message) => message.expiresAt > Date.now()).map(({ expiresAt, content, ...item }) => item); safeLog("request", { action: "Listed active message descriptors", count: messages.length, storage: "RAM only" }); return response.json({ v: 2, messages });
  });
  app.post("/api/message/prepare", (request, response) => {
    const { hash, sessionId, proof } = request.body || {}; const session = sessions.get(sessionId); if (!isValidRoomHash(hash) || !session || session.roomKey !== roomKey(hash) || !verifyProof(session, "prepare", hash, "", "", proof)) return response.status(401).json({ error: "authentication_required" });
    const messageHash = randomToken(32); const createdAt = new Date().toISOString(); const pair = p256Pair(); const publicKey = toBase64Url(pair.publicKey); preparations.set(messageHash, { roomKey: roomKey(hash), privateKey: pair.privateKey, createdAt, expiresAt: Date.now() + authTtlMs }); safeLog("crypto", { action: "Created one-time upload public key", algorithm: "P-256 ECDH + HKDF-SHA-256 + AES-256-GCM", keyOrigin: "server generated" }); return response.json({ messageHash, createdAt, publicKey, proof: serverKeyProof(session, "upload", hash, messageHash, createdAt, publicKey) });
  });
  app.post("/api/message", (request, response) => {
    const { hash, sessionId, proof, messageHash, clientPublicKey, nonce, ciphertext } = request.body || {}; const session = sessions.get(sessionId); const preparation = preparations.get(messageHash);
    if (!isValidRoomHash(hash) || !preparation || !session || session.roomKey !== preparation.roomKey || preparation.roomKey !== roomKey(hash) || !isEncoded(clientPublicKey, P256_PUBLIC_KEY_LENGTH, P256_PUBLIC_KEY_LENGTH) || !isEncoded(nonce, 16, 32) || !isEncoded(ciphertext, 17, MAX_CIPHERTEXT) || !verifyProof(session, "upload", hash, messageHash, clientPublicKey, proof)) return response.status(401).json({ error: "authentication_required" });
    try { const body = JSON.parse(decryptEnvelope(preparation.privateKey, fromBase64Url(clientPublicKey), messageHash, preparation.createdAt, "upload", nonce, ciphertext).toString("utf8")); if (!body || body.v !== 2 || body.messageHash !== messageHash || body.createdAt !== preparation.createdAt || !validContent(body.content)) throw new Error(); const active = (rooms.get(preparation.roomKey) || []).filter((item) => item.expiresAt > Date.now()); active.push({ v: 2, messageHash, createdAt: preparation.createdAt, content: body.content, expiresAt: Date.now() + messageTtlMs }); rooms.set(preparation.roomKey, active); preparations.delete(messageHash); const record = opaqueRecords.get(preparation.roomKey); if (record) record.expiresAt = Date.now() + opaqueRecordTtlMs; safeLog("storage", { action: "Stored outermost AES ciphertext and three nonces", storage: "RAM only", ttlMs: messageTtlMs, plaintext: "never received" }); return response.status(202).json({ accepted: true }); } catch { return response.status(400).json({ error: "invalid_envelope" }); }
  });
  app.post("/api/message/claim", (request, response) => {
    const { hash, sessionId, proof, messageHash, clientPublicKey } = request.body || {}; const session = sessions.get(sessionId); if (!isValidRoomHash(hash) || !session || session.roomKey !== roomKey(hash) || !isEncoded(messageHash, 43, 43) || !isEncoded(clientPublicKey, P256_PUBLIC_KEY_LENGTH, P256_PUBLIC_KEY_LENGTH) || !verifyProof(session, "download", hash, messageHash, clientPublicKey, proof)) return response.status(401).json({ error: "authentication_required" });
    const message = (rooms.get(session.roomKey) || []).find((item) => item.messageHash === messageHash && item.expiresAt > Date.now()); if (!message) return response.status(404).json({ error: "message_not_found" }); const pair = p256Pair(); const publicKey = toBase64Url(pair.publicKey); const envelope = encryptEnvelope(pair.privateKey, fromBase64Url(clientPublicKey), messageHash, message.createdAt, "download", Buffer.from(JSON.stringify({ v: 2, messageHash, createdAt: message.createdAt, content: message.content }))); safeLog("crypto", { action: "Wrapped ciphertext for authenticated recipient", algorithm: "P-256 ECDH + HKDF-SHA-256 + AES-256-GCM", keyOrigin: "server generated" }); return response.json({ v: 2, messageHash, createdAt: message.createdAt, publicKey, proof: serverKeyProof(session, "download", hash, messageHash, message.createdAt, publicKey), ...envelope });
  });
  app.use("/vendor/opaque", express.static(OPAQUE_CLIENT_DIRECTORY, { etag: false, maxAge: 0 })); app.use(express.static(PUBLIC_DIRECTORY, { etag: false, index: false, maxAge: 0 })); app.use((_request, response) => response.status(404).sendFile(path.join(PUBLIC_DIRECTORY, "404.html")));
  const cleanupTimer = setInterval(() => { const now = Date.now(); for (const [key, messages] of rooms.entries()) { const active = messages.filter((item) => item.expiresAt > now); if (active.length) rooms.set(key, active); else rooms.delete(key); } for (const map of [opaqueRecords, registrationStates, loginStates, sessions, preparations]) for (const [key, value] of map.entries()) if (value.expiresAt <= now) map.delete(key); }, cleanupIntervalMs); cleanupTimer.unref();
  return { app, rooms, opaqueRecords, close: () => { clearInterval(cleanupTimer); opaqueSetup.free(); } };
}
if (require.main === module) { const { app } = createApp(); const port = Number.parseInt(process.env.PORT || "3000", 10); app.listen(port, "0.0.0.0", () => safeLog("startup", { service: "Neutron - ACMTN", port })); }
module.exports = { createApp, doubleHash, isValidRoomHash, alternateAddress };
