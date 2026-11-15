"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const test = require("node:test");
const { startBzn, identitySecret } = require("../lib/bzn");
const { createApp } = require("../server");

test("BZN requires its own canonical private seed and never publishes it in status", () => {
  assert.equal(identitySecret({ secret: "" }), null);
  const secret = "bzn1." + crypto.randomBytes(32).toString("base64url");
  assert.equal(identitySecret({ secret }), secret);
  for (const secret of ["not-a-key", "bzn1." + "A".repeat(42) + "B", "bzn1." + "A".repeat(42)]) {
    const host = startBzn({ port: 3000, secret });
    assert.deepEqual(host.getStatus(), { enabled: true, state: "invalid_key", address: null, url: null });
    host.stop();
  }
  assert.equal(startBzn({ port: 3000, secret: "" }).getStatus().enabled, false);
});

test("native BZN host serves Neutron, WASM and authenticated chat through real encrypted relay rooms", { timeout: 180000 }, async () => {
  let host, client;
  const service = createApp({ getBznStatus: () => host?.getStatus() || { enabled: false } });
  const server = http.createServer(service.app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port, origin = `http://127.0.0.1:${port}`;
  try {
    const secret = "bzn1." + crypto.randomBytes(32).toString("base64url");
    host = startBzn({ port, secret });
    const deadline = Date.now() + 15000;
    while (host.getStatus().state !== "hosting" && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    const status = host.getStatus();
    assert.equal(status.state, "hosting");
    assert.match(status.address, /^[a-z2-7]{52}\.bzn$/);
    assert.ok(!JSON.stringify(status).includes(secret));
    const { identity } = await import("../lib/bzn/crypto.js");
    assert.equal((await identity(secret)).address, status.address);
    const { BznClient } = await import("../lib/bzn/protocol.js");
    const { roomFactory } = await import("../lib/bzn/room.mjs");
    client = await new BznClient(status.address, { makeRoom: roomFactory(origin, { interval: 100 }) }).connect();
    const root = `https://${status.address}`;
    const home = await client.request({ url: root + "/" });
    assert.equal(home.status, 200);
    assert.match(new TextDecoder().decode(home.body), /Browzen Access/);
    const remoteWasm = await client.request({ url: root + "/vendor/opaque/opaque-client_bg.wasm" });
    assert.equal(remoteWasm.status, 200);
    const localWasm = await (await fetch(origin + "/vendor/opaque/opaque-client_bg.wasm")).arrayBuffer();
    assert.equal(Buffer.compare(Buffer.from(remoteWasm.body), Buffer.from(localWasm)), 0);
    const module = await client.request({ url: root + "/scripts/crypto-core.mjs" });
    assert.equal(module.status, 200);
    assert.match(new TextDecoder().decode(module.body), /createNeutronClient/);
    await assert.rejects(client.request({ url: "https://example.com/" }), /another website/);

    // Send every API request through BZN, including OPAQUE and P-256 envelopes.
    const { createNeutronClient } = await import("../public/scripts/crypto-core.mjs");
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input);
      if (url.hostname !== status.address) return nativeFetch(input, options);
      const response = await client.request({ url: url.href, method: options.method || "GET", headers: options.headers || {}, body: options.body ? new TextEncoder().encode(options.body) : undefined });
      return new Response(response.status === 204 ? null : response.body, { status: response.status, headers: response.headers });
    };
    try {
      const api = createNeutronClient({ ...require("@47ng/opaque-server"), baseUrl: root });
      const room = await api.deriveRoom("bzn-chat-test-" + crypto.randomBytes(16).toString("hex"));
      await api.authenticateRoom(room);
      const hash = await api.sendMessage(room, { message: "A chat message delivered through BZN" });
      const descriptors = await (await fetch(root + "/api/room?hash=" + room.roomHash)).json();
      const descriptor = descriptors.messages.find(item => item.messageHash === hash);
      assert.ok(descriptor);
      const payload = await api.claimMessage(room, descriptor);
      assert.equal(payload.message, "A chat message delivered through BZN");
    } finally { globalThis.fetch = nativeFetch; }
  } finally {
    client?.close(); host?.stop(); service.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
