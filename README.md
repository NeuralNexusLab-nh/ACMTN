# Neutron - ACMTN

**Advanced Confidential Message Transfer Network** is an ephemeral, browser-encrypted chat. It has no accounts, database, message archive, analytics, cookies, or third-party assets.

## Protocol v2

The PIN never appears in an HTTP request body, URL, server log, or persistent store. A browser uses it locally to derive a room lookup hash and an in-memory root key.

1. On room entry, the browser completes an [OPAQUE](https://www.rfc-editor.org/rfc/rfc9807) registration or login with the PIN. The server keeps only the resulting OPAQUE credential record and a short session in RAM. The record expires; it is not a message archive.
2. Before sending, an authenticated client requests a random 256-bit `messageHash`, timestamp, and one-time P-256 ECDH server public key. The server binds that exact key to the authenticated OPAQUE session with an HMAC-SHA-256 proof.
3. The browser verifies that proof. It derives three independent AES-256-GCM keys with HKDF-SHA-256 from its local PIN root, `messageHash`, and timestamp, then encrypts the JSON payload three times.
4. The browser generates an ephemeral P-256 ECDH key pair, derives an upload key with P-256 ECDH + HKDF-SHA-256, and AES-256-GCM-encrypts the triple ciphertext for transport. An OPAQUE-session HMAC authorizes this exact upload request.
5. The server unwraps only the P-256 transport layer, validates the ciphertext shape, and keeps only the outermost AES ciphertext plus the three AES nonces in RAM for 15 seconds. It never receives the message plaintext or any AES content key.
6. Clients poll descriptors every two seconds. For an unseen `messageHash`, a client generates a fresh P-256 ECDH key pair and proves its OPAQUE session for that exact public key.
7. The server verifies the proof, encrypts the outermost ciphertext and three nonces to the fresh public key, and returns it with an HMAC-bound one-time P-256 public key. The browser verifies, unwraps that transport layer, decrypts AES layers 3 → 2 → 1, renders the message, and discards the one-time private key.

Only a client with the PIN can establish an OPAQUE session and derive the three content keys. The room lookup hash is double-hashed before it becomes a RAM-map key. Message descriptors expose no message ciphertext; a hash alone cannot authorize a claim.

## Security boundaries

HTTPS protects the page and API from network interception. It does not protect a visitor from a compromised server delivering altered JavaScript. Do not describe this as independently audited or suitable for life-critical communications until it has received a professional audit.

Use a long, unique, high-entropy PIN. Short or reused PINs remain vulnerable to guessing. Sender identity is intentionally anonymous: messages contain no account, nickname, or persistent identifier.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm run generate:secrets
npm start
```

Copy the generated value into the service's secret environment as `NEUTRON_OPAQUE_SERVER_SETUP`. Generate it once and preserve it across restarts; regenerating it invalidates existing short-lived authentication state. An unreadable value is ignored and a fresh RAM-only setup is used so the service remains available; replace the environment value with a newly generated one. Never commit that value or print it in production logs.

Open `http://127.0.0.1:3000`. Run automated tests with `npm test`.

## Deployment

Run Express behind a TLS-terminating reverse proxy for `https://neutron.nxlabtw.com`. Do not enable request-body logging, analytics, CDN script injection, persistence, process snapshots, or error reporting that captures request bodies. Preserve the OPAQUE server secret through deploys.

Production access: `https://neutron.nxlabtw.com`

### Onion access on the same Render Web Service

The Dockerfile installs Node.js and Tor in one container. `node server.js` starts Express first, then manages one Tor child process. It does not create a second Render service, background worker, relay node, or public SOCKS proxy. HTTP continues to work while Tor connects or restarts. Tor uses additional memory and bandwidth within the same instance.

1. Generate a secret locally with `npm run generate:onion`. This prints `NEUTRON_ONION_SEED` and its corresponding v3 onion address. Only this explicit local generation command prints the secret; the running server never does.
2. In the **existing** Render Web Service, add `NEUTRON_ONION_SEED` with the generated Base64 value only (no variable name, quotes, or line breaks). Keep the same value across deployments. It is a 32-byte Ed25519 seed, not the chat OPAQUE setup or a Tor `hs_ed25519_secret_key` file.
3. In that same service, open **Settings → Build → Source → Edit**, select the current repository/branch, and change Runtime to **Docker**. Use the root `Dockerfile`, with its default command `node server.js`. Do not create another service or Blueprint. Retain existing environment variables, custom domain, and Free instance plan. Render supplies `PORT`; Express listens on `0.0.0.0:$PORT`, and Tor forwards onion port 80 to `127.0.0.1:$PORT`.
4. Set the service health check to `/healthz`. Check `/api/onion` for `starting`, `connecting`, `ready`, `retrying`, `invalid_key`, or `identity_mismatch`. Only the public URL and status are exposed. Missing identity settings disable Tor; an invalid identity does not generate a replacement.

The homepage **Onion Access** link and clearnet `Onion-Location` header always point to the fixed vanity address `http://ntrn6cdbm4n5knrezi5xv7arfy5lvowosfo4x7pw4ftlgv5bui54qvqd.onion/`. Configure the matching vanity key and hostname below. The header preserves the requested path and query; onion requests do not receive it. The link remains visible during Tor restarts. `/api/onion` separately reports the running service state and verified URL. Bootstrap completion does not guarantee immediate descriptor propagation or reachability from every Tor client; verify the link in Tor Browser after deployment. The relay's chat storage and encryption are shared across both addresses, but browsers keep their local page state separately by origin.

`server.js` derives Tor's expanded ED25519-V3 key from the seed and registers the service over a cookie-authenticated, loopback-only control connection using `ADD_ONION ... Flags=DiscardPK`. The private key is not passed on the command line or persisted in a hidden-service directory. Temporary Tor network state and the control cookie use a private ephemeral directory, removed on orderly shutdown. No persistent disk is required. Rotate the seed only when intentionally changing the onion address.

Render Free instance hours are per service instance, not per process: two processes inside this container do not create a second allocation of hours. A single instance running continuously for 31 days uses 744 hours. Free services remain subject to Render's sleep, resource, and traffic limits; onion traffic is not a reliable wake-up mechanism. Keep any availability monitoring pointed at the HTTPS endpoint.

To generate the seed without checking out this repository, run this in PowerShell or a terminal with Node.js:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))"
```

Paste the output into the `NEUTRON_ONION_SEED` value. The server derives the public onion address; retrieve it from `/api/onion` after startup. Never paste the seed into chat, GitHub, or the public website. For an existing or vanity address, use the key-file environment variables below instead of generating a new seed.

### Import an existing mkp224o vanity address

Keep `hostname`, `hs_ed25519_public_key`, and `hs_ed25519_secret_key` from the generated directory as a private local backup. Configure these variables in the **same existing Render service**:

| Variable | Value |
| --- | --- |
| `NEUTRON_ONION_SECRET_KEY` | Standard Base64 encoding of the entire binary `hs_ed25519_secret_key` file, including its Tor header. |
| `NEUTRON_ONION_HOSTNAME` | The single address from the `hostname` file, such as `neutron...onion`, without a scheme or slash. |

In PowerShell, encode the file locally (replace the example path with the exact file path):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('D:\your-onion-folder\hs_ed25519_secret_key'))
```

The output is the secret value: paste it directly into Render, not into chat or GitHub. Do not open or copy the binary file as text, and do not paste this value into `NEUTRON_ONION_SEED`. Remove the seed variable when using vanity keys. Vanity settings take precedence if both are configured; invalid or incomplete vanity settings never fall back to a different identity.

No upload of these files, persistent disk, additional service, or stored public-key file is required. On startup, Node validates the file's 96-byte length and 32-byte Tor header, extracts its existing 64-byte expanded private key unchanged, and sends it to the local Tor control socket. It compares Tor's returned ServiceID with `NEUTRON_ONION_HOSTNAME` before advertising any URL. A mismatch disables further onion startup attempts until restart with corrected settings; HTTPS continues to work. The private material is excluded from the child process environment, command line, public API, and runtime logs. The same configuration restores the same vanity address after redeploys.

Tests can use an installed Tor executable without publishing an onion service: set `TOR_TEST_BINARY` to its path before `npm test`. The integration test runs Tor with networking disabled and verifies two independent launches accept the derived key and return the same expected ServiceID. Docker/container deployment and public Tor reachability should also be checked in the target environment.

## License

Apache-2.0. See [LICENSE](LICENSE).
