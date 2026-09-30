"use strict";

const crypto = require("node:crypto");
const express = require("express");
const path = require("node:path");

const PUBLIC_DIRECTORY = path.join(__dirname, "public");
const ONION_ORIGIN = "http://neutron.nxlabtwhcegzi5f65qb6ri4iv72rtdp5q7s4w457pahcohtmegjregqd.onion";
const ROOM_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16}$/;
const CIPHERTEXT_PATTERN = /^[A-Za-z0-9_-]{1,16384}$/;

function doubleHash(roomHash) {
  return crypto.createHash("sha256").update(roomHash, "utf8").digest("base64url");
}

function isValidRoomHash(value) {
  return typeof value === "string" && ROOM_HASH_PATTERN.test(value);
}

function isValidMessage(message) {
  return message && typeof message === "object"
    && message.v === 1
    && typeof message.id === "string" && MESSAGE_ID_PATTERN.test(message.id)
    && typeof message.nonce === "string" && NONCE_PATTERN.test(message.nonce)
    && typeof message.ciphertext === "string" && CIPHERTEXT_PATTERN.test(message.ciphertext);
}

function createApp({ messageTtlMs = 15_000, cleanupIntervalMs = 1_000 } = {}) {
  const app = express();
  const rooms = new Map();

  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.set({
      "Cache-Control": "no-store, max-age=0",
      "Clear-Site-Data": "\"cache\"",
      "Content-Security-Policy": "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY"
    });
    if (!String(request.hostname || "").endsWith(".onion")) {
      response.set("Onion-Location", `${ONION_ORIGIN}${request.originalUrl}`);
    }
    next();
  });
  app.use(express.json({ limit: "20kb", strict: true, type: "application/json" }));

  app.get("/", (_request, response) => response.sendFile(path.join(PUBLIC_DIRECTORY, "index.html")));
  app.get("/room", (request, response) => {
    if (!isValidRoomHash(request.query.hash)) return response.status(404).sendFile(path.join(PUBLIC_DIRECTORY, "404.html"));
    return response.sendFile(path.join(PUBLIC_DIRECTORY, "room.html"));
  });

  app.get("/api/room", (request, response) => {
    if (!isValidRoomHash(request.query.hash)) return response.status(404).json({ error: "room_not_found" });
    const key = doubleHash(request.query.hash);
    const now = Date.now();
    const messages = (rooms.get(key) || [])
      .filter((message) => message.expiresAt > now)
      .map(({ expiresAt, ...message }) => message);
    return response.json({ v: 1, messages });
  });

  app.post("/api/room", (request, response) => {
    if (!isValidRoomHash(request.query.hash)) return response.status(404).json({ error: "room_not_found" });
    if (!isValidMessage(request.body)) return response.status(400).json({ error: "invalid_ciphertext" });

    const key = doubleHash(request.query.hash);
    const now = Date.now();
    const current = (rooms.get(key) || []).filter((message) => message.expiresAt > now);
    if (!current.some((message) => message.id === request.body.id)) {
      current.push({ ...request.body, expiresAt: now + messageTtlMs });
    }
    rooms.set(key, current);
    return response.status(202).json({ accepted: true });
  });

  app.use(express.static(PUBLIC_DIRECTORY, {
    etag: false,
    index: false,
    maxAge: 0
  }));
  app.use((_request, response) => response.status(404).sendFile(path.join(PUBLIC_DIRECTORY, "404.html")));

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, messages] of rooms.entries()) {
      const active = messages.filter((message) => message.expiresAt > now);
      if (active.length) rooms.set(key, active);
      else rooms.delete(key);
    }
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  return { app, rooms, close: () => clearInterval(cleanupTimer) };
}

if (require.main === module) {
  const { app } = createApp();
  const port = Number.parseInt(process.env.PORT || "3000", 10);
  app.listen(port, "0.0.0.0", () => {
    console.info(`ACMTN listening on port ${port}`);
  });
}

module.exports = { createApp, doubleHash, isValidRoomHash };

