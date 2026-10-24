"use strict";

const crypto = require("node:crypto");
const net = require("node:net");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const runtimeDirectory = path.join(__dirname, "..", ".runtime", "tor");
const bundledTor = path.join(runtimeDirectory, "usr", "bin", "tor");

function defaultTorBinary() { return existsSync(bundledTor) ? bundledTor : "tor"; }

function torEnvironment(torBinary, environment = process.env) {
  const env = { ...environment };
  for (const name of ["NEUTRON_ONION_SEED", "NEUTRON_ONION_SECRET_KEY", "NEUTRON_ONION_HOSTNAME", "NEUTRON_OPAQUE_SERVER_SETUP"]) delete env[name];
  if (torBinary === bundledTor) {
    const triplet = process.arch === "arm64" ? "aarch64-linux-gnu" : "x86_64-linux-gnu";
    env.LD_LIBRARY_PATH = [path.join(runtimeDirectory, "usr", "lib", triplet), path.join(runtimeDirectory, "lib", triplet), path.join(runtimeDirectory, "usr", "lib"), path.join(runtimeDirectory, "lib"), env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  }
  return env;
}

function base32(bytes) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567"; let bits = 0, value = 0, result = "";
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { bits -= 5; result += alphabet[(value >>> bits) & 31]; } }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

// Tor's ED25519-V3 key is the expanded scalar and PRF secret, not a seed.
// Derive both it and the public identity from one standard Ed25519 seed.
function onionIdentity(seedValue) {
  const text = String(seedValue || "").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) throw new Error("invalid_onion_seed");
  const seed = Buffer.from(text, "base64");
  if (seed.length !== 32 || seed.toString("base64") !== text) throw new Error("invalid_onion_seed");
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const publicKey = Buffer.from(crypto.createPublicKey(privateKey).export({ format: "jwk" }).x, "base64url");
  const expanded = crypto.createHash("sha512").update(seed).digest();
  expanded[0] &= 248; expanded[31] &= 63; expanded[31] |= 64;
  const version = Buffer.from([3]);
  const checksum = crypto.createHash("sha3-256").update(Buffer.concat([Buffer.from(".onion checksum"), publicKey, version])).digest().subarray(0, 2);
  const hostname = `${base32(Buffer.concat([publicKey, checksum, version]))}.onion`;
  const key = `ED25519-V3:${expanded.toString("base64")}`;
  seed.fill(0); expanded.fill(0);
  return { key, hostname };
}

// mkp224o writes a 32-byte Tor header followed by the 64-byte expanded key.
// Preserve these bytes: hashing this file as a seed would change the address.
function vanityIdentity(secretValue, hostnameValue) {
  const text = String(secretValue || "").trim();
  const hostname = String(hostnameValue || "").trim().toLowerCase();
  if (!/^[A-Za-z0-9+/]{128}$/.test(text) || !/^[a-z2-7]{56}\.onion$/.test(hostname)) throw new Error("invalid_onion_vanity_key");
  const file = Buffer.from(text, "base64");
  const header = Buffer.alloc(32); header.write("== ed25519v1-secret: type0 ==", "ascii");
  if (file.length !== 96 || file.toString("base64") !== text || !file.subarray(0, 32).equals(header)) throw new Error("invalid_onion_vanity_key");
  const key = `ED25519-V3:${file.subarray(32).toString("base64")}`;
  file.fill(0);
  return { key, hostname };
}

class TorControl {
  constructor(socket) {
    this.socket = socket; this.buffer = ""; this.lines = []; this.pending = null;
    socket.setEncoding("utf8");
    socket.on("data", chunk => this.receive(chunk));
    socket.on("error", () => this.fail());
    socket.on("close", () => this.fail());
  }
  fail() { if (this.pending) { const { reject, timer } = this.pending; this.pending = null; clearTimeout(timer); reject(new Error("tor_control_closed")); } }
  receive(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 65536) { this.socket.destroy(); return; }
    let end;
    while ((end = this.buffer.indexOf("\r\n")) >= 0) {
      const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 2);
      if (!this.pending || /^650/.test(line)) continue;
      this.lines.push(line);
      if (/^\d{3} /.test(line)) {
        const { resolve, reject, timer } = this.pending; this.pending = null; clearTimeout(timer);
        const lines = this.lines; this.lines = [];
        if (line.startsWith("250 ")) resolve(lines); else reject(new Error("tor_command_rejected"));
      }
    }
  }
  command(command) {
    if (this.pending || this.socket.destroyed) return Promise.reject(new Error("tor_control_unavailable"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.fail(); this.socket.destroy(); }, 10000);
      this.lines = []; this.pending = { resolve, reject, timer };
      this.socket.write(`${command}\r\n`);
    });
  }
  close() { this.fail(); this.socket.destroy(); }
}

async function connectControl(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timeout = setTimeout(() => socket.destroy(new Error("timeout")), 3000);
    socket.once("error", () => { clearTimeout(timeout); reject(new Error("tor_control_connect_failed")); });
    socket.once("connect", () => { clearTimeout(timeout); resolve(new TorControl(socket)); });
  });
}

function startOnion({ seed = process.env.NEUTRON_ONION_SEED, secretKey = process.env.NEUTRON_ONION_SECRET_KEY, hostname = process.env.NEUTRON_ONION_HOSTNAME, torBinary = process.env.TOR_BINARY || defaultTorBinary(), port, offline = false } = {}) {
  const configured = Boolean(seed || secretKey || hostname);
  const status = { enabled: configured, state: configured ? "starting" : "disabled", url: null };
  let identity;
  if (configured) {
    try {
      // A configured vanity identity always takes precedence; never replace it
      // with a random seed identity if the files or hostname are invalid.
      identity = secretKey || hostname ? vanityIdentity(secretKey, hostname) : onionIdentity(seed);
    } catch { status.state = "invalid_key"; }
  }
  const abort = new AbortController(); let child, control;
  async function pause(ms) { await delay(ms, undefined, { signal: abort.signal }); }
  async function run() {
    let retry = 1000;
    while (!abort.signal.aborted) {
      let directory;
      try {
        status.state = "starting"; status.url = null;
        directory = await fs.mkdtemp(path.join(os.tmpdir(), "neutron-tor-"));
        await fs.chmod(directory, 0o700);
        const portFile = path.join(directory, "control-port"), cookieFile = path.join(directory, "control-cookie");
        const env = torEnvironment(torBinary);
        child = spawn(torBinary, ["--ignore-missing-torrc", "-f", path.join(directory, "torrc"), "--DataDirectory", directory, "--SocksPort", "0", "--ClientOnly", "1", "--ControlPort", "auto", "--ControlPortWriteToFile", portFile, "--CookieAuthentication", "1", "--CookieAuthFile", cookieFile, "--Log", "err stderr", ...(offline ? ["--DisableNetwork", "1"] : [])], { env, stdio: "ignore", windowsHide: true });
        let exited = false; let exitResolve;
        const exitedPromise = new Promise(resolve => { exitResolve = resolve; });
        child.once("error", () => { exited = true; exitResolve(); });
        child.once("exit", () => { exited = true; exitResolve(); });
        for (let attempt = 0; attempt < 120; attempt += 1) {
          if (exited || abort.signal.aborted) throw new Error("tor_stopped");
          try {
            const match = (await fs.readFile(portFile, "utf8")).match(/^PORT=127\.0\.0\.1:(\d+)/m);
            const cookie = await fs.readFile(cookieFile);
            if (match && cookie.length === 32) { control = await connectControl(Number(match[1])); await control.command(`AUTHENTICATE ${cookie.toString("hex")}`); break; }
          } catch { control?.close(); control = null; }
          await pause(250);
        }
        if (!control) throw new Error("tor_start_timeout");
        const lines = await control.command(`ADD_ONION ${identity.key} Flags=DiscardPK Port=80,127.0.0.1:${port}`);
        const serviceId = lines.find(line => line.startsWith("250-ServiceID="))?.slice(14);
        if (`${serviceId}.onion` !== identity.hostname) { status.state = "identity_mismatch"; throw new Error("onion_identity_mismatch"); }
        status.state = "connecting";
        while (!exited && !abort.signal.aborted) {
          const info = await control.command("GETINFO status/bootstrap-phase");
          const ready = info.some(line => /PROGRESS=100(?: |$)/.test(line));
          status.state = ready ? "ready" : "connecting";
          status.url = ready ? `http://${identity.hostname}` : null;
          if (ready) retry = 1000;
          await pause(5000);
        }
        control.close();
        if (!exited) { child.kill("SIGTERM"); await Promise.race([exitedPromise, delay(3000)]); }
      } catch {} finally {
        status.url = null; control?.close(); control = null;
        if (child && child.exitCode === null) { child.kill("SIGKILL"); await new Promise(resolve => { if (child.exitCode !== null || !child.pid) return resolve(); child.once("exit", resolve); setTimeout(resolve, 2000); }); }
        child = null;
        if (directory) await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
      }
      if (status.state === "identity_mismatch") break;
      if (!abort.signal.aborted) { status.state = "retrying"; await pause(retry); retry = Math.min(retry * 2, 60000); }
    }
  }
  const done = identity ? run().catch(() => {}) : Promise.resolve();
  return { getStatus: () => ({ ...status }), async stop() { abort.abort(); control?.close(); child?.kill("SIGTERM"); await done; status.url = null; status.state = "stopped"; } };
}

module.exports = { startOnion, onionIdentity, vanityIdentity, TorControl };
