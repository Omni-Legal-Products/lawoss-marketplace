# mcp-rpvs · operator setup

This organization edition is source software, not access to a hosted LAWOSS service. Each operator owns the machine, secrets, authentication and data produced by their deployment.

## Local stdio

Use Node.js 22 and npm. From a checkout of a reviewed organization release:

```bash
npm ci
npm run build
```

The repository's `.mcp.json` declares these local commands:

- `rpvs`: `node ./dist/server.js`

Set each command's working directory to the absolute checkout path in your MCP client. If your client does not support `cwd`, replace relative script arguments with absolute paths. Do not paste this machine-specific configuration into the repository. Plugin installation alone does not install Node dependencies or build these files.

Local stdio does not require a public port. Supply any upstream data-provider credentials separately through the local environment; server documentation lists features that require them.

## Independent remote deployment

Verified build entrypoint: `node dist/server-http.js`.

1. Build the same reviewed revision as above. Keep the application port inaccessible from the public network; allow only your reverse proxy to reach it.
2. Copy `.env.example` to an untracked `.env`, fill it with your own supported values and restrict its permissions (`chmod 600 .env`). Node does not load this file implicitly.
3. The Compose profile fixes OAuth mode and anonymous access off. Supply `MCP_DOMAIN`, the exact `MCP_TRUST_PROXY` allowlist and `OAUTH_AUTHORIZATION_PASSWORD`; persist `/data`. Run one replica. Do not reuse these values from another operator.
4. Configure your own HTTPS hostname and TLS reverse proxy. Set the server's public URL / issuer and host/origin allowlists to this hostname, using the names supported by this server. Trust only the actual proxy; never use a wildcard proxy trust setting.
5. Start the built HTTP process with explicit environment loading:

```bash
node --env-file=.env dist/server-http.js
```

Use your process supervisor for restart and log retention. For Docker/Dokploy, use the repository's deployment guide and Compose file instead: compose interpolation alone does not inject a variable unless the service declares it. Review the rendered configuration privately; it may contain secrets.

Persist OAuth state and required caches/exports in operator-owned volumes with restrictive permissions. Do not commit, package or share them. Follow the server's documented replica limit; file-backed OAuth stores must not be shared by concurrent replicas.

## Authentication acceptance check

Before allowing public access, send a valid MCP initialization request without credentials and check that it cannot create an authenticated session or expose tools/data. A generic 400, 404 or 405 is **not** evidence that authorization works.

Then authenticate using your own harness and verify initialization, `tools/list`, one read-only call, token expiry and revocation. If OAuth is enabled, also verify issuer/resource metadata and exact redirect matching. Public health or discovery routes may intentionally be unauthenticated; that must not grant MCP access.

Complete OAuth in the harness yourself. Never publish callback URLs containing authorization codes or reuse another deployment's client secrets/grants.

## Updates and rollback

1. Record the currently running organization revision and back up operator-owned state privately.
2. Review the next release, build it in a separate checkout/image and run its tests.
3. Verify your own authentication configuration still matches the release; never overwrite secrets with example values.
4. Switch your own deployment only after its acceptance checks pass. Keep the previous revision and a compatible state backup available for rollback.

A Marketplace update changes plugin instructions/metadata. It does not update a separately cloned source checkout, restart a process, deploy an image or migrate OAuth state.

## Release status

These commands are derived from this edition's package metadata and built entrypoints. Remote TLS/proxy and authenticated end-to-end deployment acceptance are operator tasks; they have not been proven merely by the offline build/tests.
