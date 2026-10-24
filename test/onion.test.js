"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const net = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
const { onionIdentity, startOnion, TorControl } = require("../lib/onion");

test("onion identity is stable and refuses malformed or non-canonical seeds", () => {
  const seed = crypto.randomBytes(32).toString("base64");
  const identity = onionIdentity(seed);
  assert.deepEqual(onionIdentity(seed), identity);
  assert.match(identity.hostname, /^[a-z2-7]{56}\.onion$/);
  assert.equal(Buffer.from(identity.key.slice("ED25519-V3:".length), "base64").length, 64);
  for (const value of ["", "bad", "a\nAUTHENTICATE", crypto.randomBytes(64).toString("base64")]) assert.throws(() => onionIdentity(value), /invalid_onion_seed/);
});

test("onion is opt-in and invalid keys are never silently replaced", async () => {
  const disabled = startOnion({ seed: "", port: 3000 });
  assert.deepEqual(disabled.getStatus(), { enabled: false, state: "disabled", url: null });
  await disabled.stop();
  const invalid = startOnion({ seed: "not-a-key", port: 3000 });
  assert.deepEqual(invalid.getStatus(), { enabled: true, state: "invalid_key", url: null });
  await invalid.stop();
});

test("control parser handles split replies and redacts Tor rejection text", async () => {
  const server = net.createServer(socket => { socket.on("data", data => { if (data.toString().startsWith("GOOD")) { socket.write("250-ServiceID=example\r"); setImmediate(() => socket.write("\n250 OK\r\n")); } else socket.write("512 secret-must-not-escape\r\n"); }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const socket = net.createConnection(server.address().port, "127.0.0.1");
  await new Promise(resolve => socket.once("connect", resolve));
  const control = new TorControl(socket);
  try {
    assert.deepEqual(await control.command("GOOD"), ["250-ServiceID=example", "250 OK"]);
    await assert.rejects(control.command("BAD"), error => error.message === "tor_command_rejected");
  } finally { control.close(); await new Promise(resolve => server.close(resolve)); }
});

test("real Tor accepts the derived key, restores the same address, and stops cleanly", { skip: !process.env.TOR_TEST_BINARY, timeout: 40000 }, async () => {
  const seed = crypto.randomBytes(32).toString("base64");
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const onion = startOnion({ seed, torBinary: process.env.TOR_TEST_BINARY, port: 3000, offline: true });
    try {
      const deadline = Date.now() + 15000;
      while (onion.getStatus().state !== "connecting" && Date.now() < deadline) await delay(100);
      // connecting is reached only after Tor's ServiceID matches our derived identity.
      assert.equal(onion.getStatus().state, "connecting");
      assert.equal(onion.getStatus().url, null);
    } finally { await onion.stop(); }
    assert.equal(onion.getStatus().state, "stopped");
  }
});
