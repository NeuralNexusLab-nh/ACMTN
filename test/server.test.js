"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createApp } = require("../server");

const validHash = "A".repeat(43);
const validMessage = { v: 1, id: "a".repeat(22), nonce: "b".repeat(16), ciphertext: "c".repeat(24) };

async function withServer(options, run) {
  const service = createApp(options);
  const server = http.createServer(service.app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await run(origin, service); } finally { service.close(); await new Promise((resolve) => server.close(resolve)); }
}

test("rejects malformed room hashes and ciphertext", async () => withServer({}, async (origin) => {
  const badRoom = await fetch(`${origin}/api/room?hash=bad`);
  assert.equal(badRoom.status, 404);
  const badCiphertext = await fetch(`${origin}/api/room?hash=${validHash}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(badCiphertext.status, 400);
}));

test("returns only ciphertext and clears it after TTL", async () => withServer({ messageTtlMs: 40, cleanupIntervalMs: 5 }, async (origin, service) => {
  const response = await fetch(`${origin}/api/room?hash=${validHash}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(validMessage) });
  assert.equal(response.status, 202);
  const visible = await fetch(`${origin}/api/room?hash=${validHash}`).then((result) => result.json());
  assert.deepEqual(visible.messages, [validMessage]);
  assert.equal(Object.values(visible.messages[0]).some((value) => String(value).includes("secret")), false);
  await new Promise((resolve) => setTimeout(resolve, 70));
  const expired = await fetch(`${origin}/api/room?hash=${validHash}`).then((result) => result.json());
  assert.deepEqual(expired.messages, []);
  assert.equal(service.rooms.size, 0);
}));

test("sets anti-cache and browser-isolation headers", async () => withServer({}, async (origin) => {
  const response = await fetch(`${origin}/`);
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("onion-location"), "http://neutron.nxlabtwhcegzi5f65qb6ri4iv72rtdp5q7s4w457pahcohtmegjregqd.onion/");
}));

test("does not advertise an onion address while serving the onion host", async () => withServer({}, async (origin) => {
  const response = await new Promise((resolve, reject) => {
    const request = http.get(`${origin}/room?hash=${validHash}`, { headers: { Host: "neutron.nxlabtwhcegzi5f65qb6ri4iv72rtdp5q7s4w457pahcohtmegjregqd.onion" } }, resolve);
    request.on("error", reject);
  });
  response.resume();
  assert.equal(response.headers["onion-location"], undefined);
}));

