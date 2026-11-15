import initialiseOpaque, { Login, Registration } from "../vendor/opaque/opaque-client.js";
import { createNeutronClient } from "./crypto-core.mjs";

await initialiseOpaque();
const api = createNeutronClient({ Login, Registration, baseUrl: import.meta.url });
export const { deriveRoom, authenticateRoom, existingLogin, sendMessage, claimMessage, isAsciiPin } = api;
window.ACMTNCrypto = api;
window.ACMTNCryptoReady = Promise.resolve();
