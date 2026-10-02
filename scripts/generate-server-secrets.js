"use strict";

const crypto = require("node:crypto");
const { ServerSetup } = require("@47ng/opaque-server");

const setup = new ServerSetup();
const opaqueSetup = Buffer.from(setup.serialize()).toString("base64url");
setup.free();
const { privateKey } = crypto.generateKeyPairSync("ed25519");
const signingKey = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
console.log(`NEUTRON_OPAQUE_SERVER_SETUP=${opaqueSetup}`);
console.log(`NEUTRON_ED25519_PRIVATE_KEY=${signingKey}`);
