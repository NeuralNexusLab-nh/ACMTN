"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), test = require("node:test");
const home = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
test("home loads browser crypto before the room-entry module", () => { assert.match(home, /type="module" src="\/scripts\/crypto\.js"/); assert.match(home, /type="module" src="\/scripts\/app\.js"/); assert.match(home, /Create or join a room/); });
