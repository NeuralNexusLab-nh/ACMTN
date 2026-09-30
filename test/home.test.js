"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

function home(storageDenied = false) {
  const elements = new Map(["room-pin", "join-error", "enter-room"].map(id => [id, { value: "", textContent: "Enter", disabled: false, hidden: true, addEventListener() {} }]));
  const events = {};
  const destinations = [];
  const context = vm.createContext({
    document: { readyState: "complete", getElementById: id => elements.get(id) },
    ACMTNCrypto: { isAsciiPin: pin => !!pin, deriveRoom: async pin => ({ roomHash: pin + "-hash" }) },
    sessionStorage: { setItem() { if (storageDenied) throw new Error("Storage disabled"); } },
    location: { assign: url => destinations.push(url) },
    addEventListener: (event, handler) => { events[event] = handler; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/scripts/app.js"), "utf8"), context);
  return { elements, events, destinations };
}

test("same PIN joins the same room again after returning to the homepage", async () => {
  const page = home();
  for (let i = 0; i < 2; i++) {
    page.events.pageshow();
    page.elements.get("room-pin").value = "same-pin";
    await page.elements.get("enter-room").onclick();
  }
  assert.equal(page.destinations.length, 2);
  assert.equal(page.destinations[0], page.destinations[1]);
  assert.equal(page.elements.get("join-error").hidden, true);
});

test("blocked session storage does not prevent room navigation", async () => {
  const page = home(true);
  page.elements.get("room-pin").value = "same-pin";
  await page.elements.get("enter-room").onclick();
  assert.equal(page.destinations.length, 1);
  assert.equal(page.elements.get("join-error").hidden, true);
});
