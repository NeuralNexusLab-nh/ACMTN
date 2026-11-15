"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { createApp } = require("../server");

async function withServer(run) {
  const service = createApp();
  const server = http.createServer(service.app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { service.close(); await new Promise(resolve => server.close(resolve)); }
}

test("all origins can preflight APIs and read API errors, modules and WASM, while HTML stays protected", async () => withServer(async origin => {
  for (const caller of ["https://other.example", "https://another.example", "null"]) {
    for (const endpoint of ["/api/message", "/api/auth/login/start", "/api/message/claim"]) {
      const response = await fetch(origin + endpoint, {
        method: "OPTIONS", headers: { Origin: caller, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" }
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("clear-site-data"), null);
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.match(response.headers.get("access-control-allow-methods"), /POST/);
      assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type");
      assert.equal(response.headers.get("access-control-allow-credentials"), null);
    }
  }
  for (const endpoint of ["/api/room?hash=" + "A".repeat(43), "/api/room?hash=bad", "/scripts/crypto.js", "/vendor/opaque/opaque-client.js", "/vendor/opaque/opaque-client_bg.wasm"]) {
    const response = await fetch(origin + endpoint, { headers: { Origin: "https://other.example" } });
    assert.equal(response.status, endpoint.includes("hash=bad") ? 404 : 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.equal(response.headers.get("clear-site-data"), null);
    assert.match(response.headers.get("cache-control"), /no-store/);
    await response.arrayBuffer();
  }
  for (const body of ["{}", "{"]) {
    const response = await fetch(origin + "/api/message/prepare", {
      method: "POST", headers: { Origin: "https://other.example", "Content-Type": "application/json" }, body
    });
    assert.equal(response.status, body === "{}" ? 401 : 400);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(await response.json(), { error: body === "{}" ? "authentication_required" : "invalid_json" });
    assert.equal(response.headers.get("clear-site-data"), null);
  }
  const home = await fetch(origin);
  assert.equal(home.headers.get("access-control-allow-origin"), null);
  assert.equal(home.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(home.headers.get("clear-site-data"), '"cache"');
  assert.match(home.headers.get("content-security-policy"), /script-src 'self' 'wasm-unsafe-eval'/);
}));

test("exported client routes API calls to its own service and exchanges triple-encrypted application JSON", async () => withServer(async origin => {
  // Run the actual browser crypto implementation with Node Web Crypto and the same
  // OPAQUE WASM protocol. Only module loading and the browser global are adapted.
  const source = await fs.readFile(path.join(__dirname, "../public/scripts/crypto.js"), "utf8");
  assert.match(source, /from "\.\.\/vendor\/opaque\/opaque-client\.js"/);
  const previousWindow = globalThis.window;
  globalThis.window = {};
  globalThis.__integrationOpaque = require("@47ng/opaque-server");
  try {
    const adapted = source.replace(/^import .*;\r?\n/, "const { Login, Registration } = globalThis.__integrationOpaque; const initialiseOpaque = async () => {};\n")
      .replaceAll("import.meta.url", JSON.stringify(`${origin}/scripts/crypto.js`));
    const client = await import(`data:text/javascript;base64,${Buffer.from(adapted).toString("base64")}`);
    const sender = await client.deriveRoom("integration-only-PIN-not-a-real-secret");
    const receiver = await client.deriveRoom("integration-only-PIN-not-a-real-secret");
    await client.authenticateRoom(sender);
    await client.authenticateRoom(receiver);
    assert.equal(sender.roomHash, receiver.roomHash);
    assert.notEqual(sender.sessionId, receiver.sessionId);
    const data = { app: "integration", type: "event", data: { text: "中文 JSON", sequence: 1 } };
    const hash = await client.sendMessage(sender, data);
    const descriptors = await (await fetch(`${origin}/api/room?hash=${sender.roomHash}`)).json();
    assert.equal(descriptors.messages.length, 1);
    assert.equal(descriptors.messages[0].messageHash, hash);
    assert.equal(descriptors.messages[0].content, undefined);
    const received = await client.claimMessage(receiver, descriptors.messages[0]);
    assert.deepEqual(received.data, data.data);
    assert.equal(received.app, data.app);
    assert.equal(received.messageHash, hash);
    assert.equal(received.timestampUtc, descriptors.messages[0].createdAt);
    receiver.sessionKey = new Uint8Array(32);
    await assert.rejects(client.claimMessage(receiver, descriptors.messages[0]), /session_expired/);
  } finally {
    globalThis.window = previousWindow;
    delete globalThis.__integrationOpaque;
  }
}));
