# Neutron - ACMTN

**Advanced Confidential Message Transfer Network** is an ephemeral, browser-encrypted chat. It has no accounts, database, message archive, analytics, cookies, or third-party assets.

## Protocol v2

The PIN never appears in an HTTP request body, URL, server log, or persistent store. A browser uses it locally to derive a room lookup hash and an in-memory root key.

1. On room entry, the browser completes an [OPAQUE](https://www.rfc-editor.org/rfc/rfc9807) registration or login with the PIN. The server keeps only the resulting OPAQUE credential record and a short session in RAM. The record expires; it is not a message archive.
2. Before sending, an authenticated client requests a random 256-bit `messageHash`, timestamp, and one-time X25519 server public key. The server signs that key with Ed25519.
3. The browser verifies the Ed25519 signature. It derives three independent AES-256-GCM keys with HKDF-SHA-256 from its local PIN root, `messageHash`, and timestamp, then encrypts the JSON payload three times.
4. The browser generates an ephemeral X25519 key pair, derives an upload key with X25519 + HKDF-SHA-256, and AES-256-GCM-encrypts the triple ciphertext for transport. An OPAQUE-session HMAC authorizes this exact upload request.
5. The server unwraps only the X25519 transport layer, validates the ciphertext shape, and keeps only the outermost AES ciphertext plus the three AES nonces in RAM for 15 seconds. It never receives the message plaintext or any AES content key.
6. Clients poll descriptors every two seconds. For an unseen `messageHash`, a client generates a fresh X25519 key pair and signs an OPAQUE-session proof bound to the room hash, message hash, and that fresh public key.
7. The server verifies the proof, encrypts the outermost ciphertext and three nonces to the fresh public key, and returns it with a signed one-time X25519 public key. The browser verifies, unwraps that transport layer, decrypts AES layers 3 → 2 → 1, renders the message, and discards the one-time private key.

Only a client with the PIN can establish an OPAQUE session and derive the three content keys. The room lookup hash is double-hashed before it becomes a RAM-map key. Message descriptors expose no message ciphertext; a hash alone cannot authorize a claim.

## Security boundaries

HTTPS protects the page and API from network interception on the clearnet; the Onion address adds Tor routing and onion-service authentication. Neither protects a visitor from a compromised server delivering altered JavaScript. Do not describe this as independently audited or suitable for life-critical communications until it has received a professional audit.

Use a long, unique, high-entropy PIN. Short or reused PINs remain vulnerable to guessing. Sender identity is intentionally anonymous: nicknames are display labels, not cryptographic identities.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run generate:secrets
npm start
```

Copy the two generated values into the service's secret environment as `NEUTRON_OPAQUE_SERVER_SETUP` and `NEUTRON_ED25519_PRIVATE_KEY`. Generate them once and preserve them across restarts; regenerating either value invalidates existing short-lived authentication state and changes the signing identity. Never commit those values or print them in production logs.

Open `http://127.0.0.1:3000`. Run automated tests with `npm test`.

## Deployment

Run Express behind a TLS-terminating reverse proxy for `https://neutron.nxlabtw.com`; configure the Tor onion service to forward to the same local service. Do not enable request-body logging, analytics, CDN script injection, persistence, process snapshots, or error reporting that captures request bodies. Preserve the two server secrets through deploys.

Primary access: `https://neutron.nxlabtw.com`  
Tor access: `http://neutron.nxlabtwhcegzi5f65qb6ri4iv72rtdp5q7s4w457pahcohtmegjregqd.onion/`

Legacy `acmtn.nxlabtw.com` and its onion hostname should route to the same service. The application emits `Onion-Location` on non-onion responses.

## License

Apache-2.0. See [LICENSE](LICENSE).
