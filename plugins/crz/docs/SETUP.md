# Manual CRZ MCP server setup

This marketplace wrapper contains a usage skill and documentation only. The CRZ
MCP server source, runtime dependencies, and built files are **not** part of the
plugin installation.

## Source prerequisite and current release boundary

You need a separately authorized checkout of the LAWOSS CRZ server source. The
checkout root must contain at least `package.json`, `package-lock.json`, `src/`,
`.env.example`, and `docker-compose.dokploy.yml`.

The current pilot does not publish that server repository for anonymous use and
does not create a public download location. Public distribution of the server
source remains blocked until a separately authorized release makes it
accessible. If you do not already have authorized source access, stop here; the
plugin alone cannot create a working CRZ connection.

In the commands below, set `CRZ_SERVER_ROOT` to the absolute root of your
authorized checkout. Run all `npm`, Node.js, and Docker Compose commands from
that directory—not from this marketplace repo or a plugin cache:

```bash
export CRZ_SERVER_ROOT="/absolute/path/to/authorized/mcp-crz"
cd "$CRZ_SERVER_ROOT"
test -f package.json
```

## Local stdio server

The server requires Node.js 20 or newer; its CI uses Node.js 22.

```bash
cd "$CRZ_SERVER_ROOT"
node --version
npm ci
npm run build
npm test
test -f dist/index.js
```

`dist/index.js` is the stdio entrypoint. Register its absolute path manually in
the client. For Codex, add this to `~/.codex/config.toml`, substituting the real
checkout path:

```toml
[mcp_servers.crz]
command = "node"
args = ["/absolute/path/to/authorized/mcp-crz/dist/index.js"]
```

Then run `codex mcp list` and start a new Codex task. Plugin installation itself
does not perform this registration.

For a controlled loopback-only HTTP smoke test, run from the same server root:

```bash
cd "$CRZ_SERVER_ROOT"
npm run build
HOST=127.0.0.1 PORT=3000 MCP_AUTH_TOKEN="<replace-with-random-token>" npm run start:http
curl -sf http://127.0.0.1:3000/healthz
```

Do not expose this legacy bearer-mode smoke test to a network.

## Self-hosted HTTPS with OAuth

This procedure requires Docker Compose, persistent storage, a reverse proxy, a
domain you control, and TLS. Continue from the authorized server root:

```bash
cd "$CRZ_SERVER_ROOT"
cp .env.example .env
```

Replace placeholders in `.env` or, preferably, set production values in the
deployment platform's secret/config store:

```dotenv
MCP_DOMAIN=mcp.example.com
OAUTH_AUTHORIZATION_PASSWORD=<at-least-16-random-characters>
```

`mcp.example.com` is only a placeholder. Use your own HTTPS domain. Keep one
replica, persist `/data`, and allow only verified proxy IP/CIDR entries through
`MCP_TRUST_PROXY`; never use `true`, `*`, or `all`.

From the server root, build and start the supplied OAuth-first Compose profile:

```bash
cd "$CRZ_SERVER_ROOT"
docker compose -f docker-compose.dokploy.yml up -d --build
```

After the reverse proxy, domain, and TLS are configured, replace the placeholder
below with your own domain and verify:

```bash
curl -sf https://mcp.example.com/healthz
curl -sf https://mcp.example.com/.well-known/oauth-authorization-server
curl -sf https://mcp.example.com/.well-known/oauth-protected-resource/mcp
```

An anonymous MCP request must return `401` with `WWW-Authenticate`. Configure a
remote Codex client manually with your own URL:

```toml
[mcp_servers.crz]
url = "https://mcp.example.com/mcp"
```

Then run `codex mcp login crz` and complete OAuth. Never place real passwords,
tokens, or OAuth state in this marketplace, shell history, or shared files.

## Operational limits

- CRZ is an external HTML source; green offline tests do not establish current
  register freshness.
- OCR is optional, requires `MISTRAL_API_KEY`, and sends documents to an
  external provider when enabled.
- Active Streamable HTTP sessions are in memory and restart with the process.
- Heuristic clause extraction is a research aid, not legal advice.
