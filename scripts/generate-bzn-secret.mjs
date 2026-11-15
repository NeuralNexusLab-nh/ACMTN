import { identity } from "../lib/bzn/crypto.js";
const { secret, address } = await identity();
console.log(`NEUTRON_BZN_SECRET=${secret}`);
console.log(`BZN address: ${address}`);
console.log(`Open: https://browzen.nxlabtw.com/?bzn=${address}`);
