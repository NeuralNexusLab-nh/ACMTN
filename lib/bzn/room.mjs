import opaque from "@47ng/opaque-server";
import { createNeutronClient } from "../../public/scripts/crypto-core.mjs";

// The same Web Crypto protocol as the browser, with the Node OPAQUE binding.
export function roomFactory(origin, { interval = 900, onError = () => {} } = {}) {
  const api = createNeutronClient({ ...opaque, baseUrl: origin });
  return pin => new RelayRoom(pin, api, origin, interval, onError);
}

class RelayRoom {
  constructor(pin, api, origin, interval, onError) {
    Object.assign(this, { pin, api, origin, interval, onError });
    this.closed = false;
    this.seen = new Set();
    this.tail = Promise.resolve();
    this.abort = new AbortController();
  }
  async start(onMessage) {
    this.room = await this.api.deriveRoom(this.pin);
    await this.api.authenticateRoom(this.room);
    this.pin = "";
    if (this.closed) { this.dispose(); throw Error("Room closed."); }
    this.onMessage = onMessage;
    this.loop();
    return this;
  }
  async auth() {
    if (!this.room || this.closed) throw Error("Room closed.");
    if (!this.authenticating && Date.now() >= this.room.sessionExpiresAt) {
      this.authenticating = this.api.authenticateRoom(this.room).finally(() => { this.authenticating = null; });
    }
    if (this.authenticating) await this.authenticating;
  }
  send(payload) {
    const job = this.tail.then(async () => {
      await this.auth();
      if (new TextEncoder().encode(JSON.stringify(payload)).length > 8000) throw Error("BZN packet too large.");
      try { return await this.api.sendMessage(this.room, payload); }
      catch (error) {
        if (error.message === "session_expired" && this.room) this.room.sessionExpiresAt = 0;
        throw error;
      }
    });
    this.tail = job.catch(() => {});
    return job;
  }
  async loop() {
    while (!this.closed) {
      try {
        await this.auth();
        const response = await fetch(new URL(`/api/room?hash=${this.room.roomHash}`, this.origin), {
          credentials: "omit", cache: "no-store",
          signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(12000)])
        });
        if (!response.ok) throw Error("Relay unavailable.");
        const { messages } = await response.json();
        if (!Array.isArray(messages)) throw Error("Invalid relay response.");
        for (const descriptor of messages.slice(0, 96)) {
          if (this.closed) break;
          if (this.seen.has(descriptor.messageHash)) continue;
          try {
            const payload = await this.api.claimMessage(this.room, descriptor);
            if (!payload) continue;
            this.seen.add(descriptor.messageHash);
            if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value);
            Promise.resolve(this.onMessage(payload)).catch(this.onError);
          } catch (error) {
            if (error.message === "session_expired" && this.room) this.room.sessionExpiresAt = 0;
            else if (error.message === "claim_failed") this.seen.add(descriptor.messageHash);
          }
        }
      } catch (error) { if (!this.closed) this.onError(error); }
      if (!this.closed) await new Promise(resolve => { this.wake = resolve; this.timer = setTimeout(resolve, this.interval); });
    }
    this.dispose();
  }
  dispose() {
    if (this.room) { this.room.sessionKey?.fill(0); this.room.pin = ""; this.room.rootKey = null; }
    this.room = null;
    this.pin = "";
  }
  close() {
    this.closed = true;
    this.abort.abort();
    clearTimeout(this.timer);
    this.wake?.();
  }
}
