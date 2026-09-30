# ACMTN

**Advanced Confidential Message Transfer Network** — ephemeral encrypted conversations with no accounts and no message archive.

## Privacy model

Messages are encrypted in the browser before transfer. The Express service receives only ciphertext and keeps it in RAM for at most 15 seconds. It uses no database, message file, session cookie, analytics script, or third-party asset.

The room PIN is never sent to the server. The browser derives a public room lookup hash and a separate AES-GCM message key locally. Anyone with the same PIN can read messages that have not expired and can use any nickname. This v1 protocol deliberately provides anonymity, not identity verification.

Privacy depends on a long, unique PIN. A hostile server that modifies the JavaScript delivered to a browser can capture a PIN; validate deployed releases and obtain an independent security audit before relying on ACMTN for high-risk communications.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open `http://127.0.0.1:3000`. Run tests with `npm test`.

## Deployment

Run Express behind a TLS-terminating reverse proxy for `https://neutron.nxlabtw.com`. Configure the Tor onion service to forward to the same local service. Do not enable request-body logging, analytics, a CDN that injects scripts, or persistent process snapshots. Set `PORT` if the reverse proxy uses a non-default local port.

Primary access: `https://neutron.nxlabtw.com`  
Tor access: `http://neutron.nxlabtwhcegzi5f65qb6ri4iv72rtdp5q7s4w457pahcohtmegjregqd.onion/`

Legacy access remains available at `https://acmtn.nxlabtw.com` and `http://acmtn.nxlabtwhcegzi5f65qb6ri4iv72rtdp5q7s4w457pahcohtmegjregqd.onion/`. Keep both legacy hosts routed to this same service; Neutron hosts are the primary addresses.

## License

Apache-2.0. See [LICENSE](LICENSE).

