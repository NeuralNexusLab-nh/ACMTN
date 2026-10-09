"use strict";

const { ServerSetup } = require("@47ng/opaque-server");

const setup = new ServerSetup();
const opaqueSetup = Buffer.from(setup.serialize()).toString("base64url");
setup.free();
console.log(`NEUTRON_OPAQUE_SERVER_SETUP=${opaqueSetup}`);
