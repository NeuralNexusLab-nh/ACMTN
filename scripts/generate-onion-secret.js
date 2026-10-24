"use strict";
const { randomBytes } = require("node:crypto");
const { onionIdentity } = require("../lib/onion");
const seed = randomBytes(32).toString("base64");
const { hostname } = onionIdentity(seed);
process.stdout.write(`NEUTRON_ONION_SEED=${seed}\n\nOnion address: http://${hostname}/\n`);
