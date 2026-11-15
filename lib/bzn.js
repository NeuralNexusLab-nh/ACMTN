"use strict";
const { setTimeout: delay } = require("node:timers/promises");

function identitySecret({ secret = process.env.NEUTRON_BZN_SECRET } = {}) {
  if (secret) {
    if (!/^bzn1\.[A-Za-z0-9_-]{43}$/.test(secret) || Buffer.from(secret.slice(5), "base64url").toString("base64url") !== secret.slice(5)) throw Error("invalid_bzn_key");
    return secret;
  }
  return null;
}

function startBzn({ port, secret } = {}) {
  let state = { enabled: false, state: "disabled", address: null, url: null };
  let host, stopped = false;
  const abort = new AbortController();
  let key;
  try { key = identitySecret({ secret }); }
  catch { state = { ...state, enabled: true, state: "invalid_key" }; }
  if (key) {
    state = { ...state, enabled: true, state: "starting" };
    (async () => {
      let attempt = 0;
      const { BznHost } = await import("./bzn/protocol.js");
      const { roomFactory } = await import("./bzn/room.mjs");
      const { identity } = await import("./bzn/crypto.js");
      const { address } = await identity(key);
      state = { ...state, address, url: `https://browzen.nxlabtw.com/?bzn=${address}` };
      while (!stopped) {
        try {
          host = new BznHost({
            secret: key, port, makeRoom: roomFactory(`http://127.0.0.1:${port}`),
            onState: (message) => { if (!stopped && message.startsWith("Hosting")) state.state = "hosting"; }
          });
          await host.start();
          if (stopped) host.stop();
          return;
        } catch {
          host?.stop();
          if (stopped) return;
          state.state = "retrying";
          await delay(Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)), undefined, { signal: abort.signal });
        }
      }
    })().catch(() => { if (!stopped) state.state = "failed"; });
  }
  return {
    getStatus: () => ({ ...state }),
    stop: () => { stopped = true; abort.abort(); host?.stop(); key = null; state.state = "stopped"; }
  };
}
module.exports = { startBzn, identitySecret };
