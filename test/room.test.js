"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");

function roomPage(hash, entryPin) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: ["chat", "chat-panel", "gate-error", "nickname-error", "message-error"].includes(id),
      value: "", textContent: "Enter", disabled: false,
      focus() { this.focused = true; }, addEventListener() {}
    });
    return elements.get(id);
  };
  let storedPin = entryPin;
  let requests = 0;
  const context = vm.createContext({
    window: {}, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array,
    btoa, atob, URLSearchParams,
    location: { search: `?hash=${hash}`, replace() { throw new Error("unexpected redirect"); } },
    sessionStorage: { getItem() { return storedPin; }, removeItem() { storedPin = null; } },
    document: { readyState: "complete", getElementById: get },
    addEventListener() {}, setInterval() { return 1; }, clearInterval() {},
    fetch: async () => { requests++; return { ok: true, json: async () => ({ messages: [] }) }; }
  });
  const scripts = path.join(__dirname, "../public/scripts");
  vm.runInContext(fs.readFileSync(path.join(scripts, "crypto.js"), "utf8"), context);
  context.ACMTNCrypto = context.window.ACMTNCrypto;
  vm.runInContext(fs.readFileSync(path.join(scripts, "room.js"), "utf8"), context);
  return { get, context, requests: () => requests, storedPin: () => storedPin };
}

test("direct room access requires matching PIN, then nickname before chat", async () => {
  const page = roomPage("A".repeat(43));
  const { roomHash } = await page.context.ACMTNCrypto.deriveRoom("test-room-pin");
  page.context.location.search = `?hash=${roomHash}`;
  assert.equal(page.get("room-gate").hidden, false);
  assert.equal(page.get("chat").hidden, true);
  assert.equal(page.get("chat-panel").hidden, true);
  page.get("start-chat").onclick();
  assert.equal(page.requests(), 0);
  page.get("gate-pin").value = "wrong-pin";
  await page.get("gate-enter").onclick();
  assert.equal(page.get("chat").hidden, true);
  assert.match(page.get("gate-error").textContent, /does not match/);
  page.get("gate-pin").value = "test-room-pin";
  await page.get("gate-enter").onclick();
  assert.equal(page.get("room-gate").hidden, true);
  assert.equal(page.get("chat").hidden, false);
  assert.equal(page.get("chat-panel").hidden, true);
  assert.equal(page.get("nickname").focused, true);
  assert.equal(page.get("gate-pin").value, "");
  page.get("nickname").value = "Tester";
  page.get("start-chat").onclick();
  assert.equal(page.get("nickname-panel").hidden, true);
  assert.equal(page.get("chat-panel").hidden, false);
  assert.equal(page.requests(), 1);
});

test("home PIN handoff opens the nickname stage and consumes the stored PIN", async () => {
  const setup = roomPage("A".repeat(43));
  const { roomHash } = await setup.context.ACMTNCrypto.deriveRoom("home-pin");
  const page = roomPage(roomHash, "home-pin");
  for (let i = 0; i < 100 && page.get("chat").hidden; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(page.storedPin(), null);
  assert.equal(page.get("room-gate").hidden, true);
  assert.equal(page.get("chat").hidden, false);
  assert.equal(page.get("chat-panel").hidden, true);
  assert.equal(page.requests(), 0);
});

test("hidden panels override component display styles before JavaScript runs", () => {
  const css = fs.readFileSync(path.join(__dirname, "../public/assets/css/tokens.css"), "utf8");
  assert.match(css, /\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/);
});
