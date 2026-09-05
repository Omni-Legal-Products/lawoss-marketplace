# mcp-cz-agents · operator setup

This organization edition is source software, not access to a hosted LAWOSS service. Each operator owns the machine, secrets, authentication and data produced by their deployment.

## Local stdio

Use Node.js 22 and npm. From a checkout of a reviewed organization release:

```bash
npm ci
npm run build
```

The locked `better-sqlite3` dependency needs its native installation step. If your package manager blocks dependency scripts, explicitly review and allow its rebuild before starting the servers.

The repository's `.mcp.json` declares these local commands:

- `cz-ares`: `node ./packages/ares/dist/index.js`
- `cz-cnb`: `node ./packages/cnb/dist/index.js`
- `cz-sanctions`: `node ./packages/sanctions/dist/index.js`
- `cz-isir`: `node ./packages/isir/dist/index.js`
- `cz-adis`: `node ./packages/adis/dist/index.js`
- `cz-dd`: `node ./packages/dd/dist/index.js`
- `cz-realestate`: `node ./packages/realestate/dist/index.js`
- `cz-eu-registry`: `node ./packages/eu-registry/dist/index.js`

Set each command's working directory to the absolute checkout path in your MCP client. If your client does not support `cwd`, replace relative script arguments with absolute paths. Do not paste this machine-specific configuration into the repository. Plugin installation alone does not install Node dependencies or build these files.

Local stdio does not require a public port. Supply any upstream data-provider credentials separately through the local environment; server documentation lists features that require them.

## Self-hosted HTTP

All eight packages provide `packages/<package>/dist/http.js`. Package names are
`ares`, `cnb`, `sanctions`, `isir`, `adis`, `dd`, `realestate`, `eu-registry`.
Run one process per package, with its own port and private writable state directory.

Create a private `.env` (never commit it). Generate two independent secrets with
`openssl rand -hex 32` and insert the results locally:

```dotenv
LAWOSS_ACCESS_TOKEN=<your-random-operator-token>
SANDBOX_HMAC_SECRET=<a-separate-random-secret-for-ares>
HOST=127.0.0.1
PORT=3030
ALLOWED_ORIGINS=
```

From the checkout, for example:

```bash
node --env-file=.env packages/ares/dist/http.js
```

HTTP startup refuses an absent/short operator token. **Every route**, including
health, metrics, sandbox, REST and webhooks, requires `X-LAWOSS-Token` containing
that token. Missing/wrong tokens return 401 before creating an MCP session.
The existing `Authorization` header remains reserved for optional billing tokens;
the operator guard does not grant paid tiers or manufacture missing features.

Configure the MCP client with your own HTTPS URL and an `X-LAWOSS-Token` header
supplied from its private secret configuration. This is static-token self-hosting,
not an OAuth authorization server. Clients limited to OAuth-only remote connectors
need a separately administered gateway or should use local stdio.

Put a TLS reverse proxy in front of the loopback listener; preserve the custom
header, disable request-header/body logging, support streaming, and keep the
backend port unreachable externally. For a container use `HOST=0.0.0.0` **only on
your isolated backend network**. The optional Dokploy Compose template requires
your own `dokploy-network` and TLS domain routing; it has no host port bindings.
Its authenticated health probe reads the token from the environment.

An empty `ALLOWED_ORIGINS` rejects all browser Origins, while non-browser clients
without Origin can authenticate. Set an exact comma-separated browser allowlist
only if needed. Origin checks are not a substitute for the operator token.
Browser cross-origin clients and direct Stripe webhook delivery are not supported
by this token-only recipe; do not add unauthenticated exceptions to make them work.

Keep `SANCTIONS_DB`, `TOKEN_DB`, `REALESTATE_DB_PATH` and `GLEIF_CACHE_PATH` in
operator-owned persistent storage. Empty sanctions/property data does not establish
a clean result. See each package README for source refresh and credential needs.
Do not reuse another deployment's token database, grants, state or source cache.

`node scripts/smoke-http-auth.mjs` verifies all eight listeners offline: denied
anonymous/wrong-token routes plus authenticated initialize and tools/list.
It does not verify your public TLS proxy, source availability or populated datasets.
Repeat those checks through your own public hostname before accepting deployment.

## Updates and rollback

1. Record the currently running organization revision and back up operator-owned state privately.
2. Review the next release, build it in a separate checkout/image and run its tests.
3. Verify your own authentication configuration still matches the release; never overwrite secrets with example values.
4. Switch your own deployment only after its acceptance checks pass. Keep the previous revision and a compatible state backup available for rollback.

A Marketplace update changes plugin instructions/metadata. It does not update a separately cloned source checkout, restart a process, deploy an image or migrate OAuth state.

## Release status

These commands are derived from this edition's package metadata and built entrypoints. Remote TLS/proxy and authenticated end-to-end deployment acceptance are operator tasks; they have not been proven merely by the offline build/tests.
