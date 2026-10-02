"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), test = require("node:test");
const room = fs.readFileSync(path.join(__dirname, "..", "public", "room.html"), "utf8"), script = fs.readFileSync(path.join(__dirname, "..", "public", "scripts", "room.js"), "utf8"), css = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "css", "tokens.css"), "utf8");
test("room uses crypto module, two-second polling, and readable UTC rendering", () => { assert.match(room, /type="module" src="\/scripts\/crypto\.js"/); assert.match(script, /setInterval\(poll, 2000\)/); assert.match(script, /UTC/); assert.match(script, /message-own/); });
test("hidden panels override layout display", () => assert.match(css, /\[hidden\].*display\s*:\s*none/));
