# LAWOSS self-hosted MCP servers: design

Status: **approved by the maintainer on 2026-11-17** (all ten decisions in
section 9). The license of the public repository `lawoss-selfhost` is still to
be chosen before that repository is created. Nothing in this document is
deployed, published or registered yet.

## 1. Intent

LAWOSS app users get two ways to use the MCP servers in this catalog:

1. **Local** (unchanged): the plugin starts a bundled stdio runtime on the
   user's computer.
2. **Self-hosted** (new): the user's own AI agent deploys the same reviewed
   runtimes on a server the user controls, behind an OAuth login with
   polished sign-in, activation and consent screens. The screens carry the
   LAWOSS brand by default or the user's own brand.

Why: a firm wants one installation that colleagues connect to from the
LAWOSS app (and other MCP clients) with personal accounts, without each
lawyer running Node locally, and with access that an administrator can
grant and revoke. The maintainer already operates such a setup privately;
this design makes a public, brandable equivalent that any LAWOSS user can
run on their own infrastructure.

## 2. Goals, non-goals, anti-goals

Goals

- An AI agent (Claude Code, Codex or the LAWOSS agent) can take a fresh Linux
  server from zero to working OAuth-protected MCP endpoints by following one
  skill from this catalog, with explicit human gates.
- Personal accounts, one-time activation links, per-service grants and
  immediate revocation, as in the reference authority.
- Sign-in, activation, consent, help, success and expired screens with
  configurable brand: logo, colors, fonts, texts, language and service names.
  LAWOSS is the default brand.
- The self-hosted endpoints expose the same tool names and input schemas as
  the local plugins, minus the reviewed remote-denied tools, so the usage
  skills carry over with a remote-mode section instead of a rewrite
  (section 5.8).
- Updates are pinned, reviewable and reversible.

Non-goals

- LAWOSS does not host, operate or monitor anyone's server. No LAWOSS-run
  public MCP endpoint and no LAWOSS-run authorization server.
- No billing, quotas per customer, multi-tenant SaaS or e-mail delivery.
- No background crawling, indexing or backfill jobs (for example a full court
  decision index). Self-hosted servers answer on demand only.
- No change to the local plugins, their tools or their update path.

Anti-goals (would make this a failure even if it technically works)

- Any change to the maintainer's existing private authorization deployment,
  its look, its data or its behavior.
- A secret, signing key, activation link or password passing through the
  agent's conversation, a Git repository or a log.
- A shared team password presented as personal identity.
- Users' requests or files becoming visible to other users of the same server.
- A self-hosted server that silently answers less than the local plugin does
  (missing tools must say so explicitly).

## 3. Facts this design rests on

Verified on 17 November 2026 by reading the repositories.

- Every packaged runtime in `plugins/*/runtime` is a **stdio-only** bundle.
  HTTP transport and the per-user OAuth adapter exist only in the private
  maintainer source repositories, not in any public artifact.
- The CZ Agents runtime has HTTP listeners, but they authenticate with one
  static operator bearer token. That is not personal identity and is not
  reused here.
- The public edition inherits, unchanged, the behavior of the existing
  authorization server, which is `oidc-provider` with SQLite: personal accounts, one-time activation links stored only as hashes,
  per-resource grants with a tenant value, authorization code with mandatory
  PKCE S256, dynamic registration restricted to loopback HTTP callbacks,
  opaque 60-minute access tokens checked by introspection on every request,
  rotated refresh tokens for at most 90 days with a 60-second concurrent-refresh
  grace, and request limits that do not break token refresh behind one NAT IP.
- Its page template hardcodes one brand in about a dozen places: page titles,
  headings, help texts, the account label, logo and decorative artwork,
  footer, `lang` attribute, design tokens and a self-hosted font. Service
  names already come from configuration (`resources[url].name`).
- A protected MCP server trusts exactly one issuer, publishes protected-resource
  metadata at `/.well-known/oauth-protected-resource` and requires its resource
  URL to be an HTTPS URL with the path `/mcp`.
- The LAWOSS app connects remote MCP with OAuth through a loopback callback
  (`127.0.0.1`, fixed port), which the authority's dynamic registration rule
  already accepts. Remote workspaces can paste the callback manually.
- Spawning these public stdio runtimes behind one OAuth-protected HTTP
  service has been done before with a four-meta-tool interface (search
  services, search tools, describe, call) instead of each service's tools.
- Tool inventory of the 14 version 1 services (109 tools, listed through each
  plugin's launcher, schemas checked for path-like parameters):
  - Tools whose purpose is writing, downloading or reading back server files,
    or keeping state: Judikáty `manage_watchlist`, `export_decision_markdown`,
    `export_decision_markdown_by_reference`, `download_decision_document`;
    Slov-Lex `save_law_markdown`, `save_explanatory_report_markdown`,
    `read_saved_markdown`; CRZ `crz_download_attachment`; RÚZ
    `ruz_download_attachment`; EUR-Lex `eurlex_document_export`.
  - Read tools with an optional save argument: Judikáty
    `get_decision_full_text` and `get_decision_full_text_by_reference`
    (`savePath`, `saveToDefaultPath`); CRZ `crz_contract_to_markdown`
    (`save_to_dir`).
  - DISQ, Finančná správa, Kalkulačky, ORSR, OV, RPO, RPVS, RU and ÚVO have no
    file parameters.
- Eight of the 14 runtimes (CRZ, DISQ, EUR-Lex, Finančná správa, OV, RPVS, RU,
  ÚVO) are not bundled: the local launcher installs their npm dependencies on
  first run into a cache under the user's home directory.
- This catalog's policy says today: "No hosted transport is permitted in
  LAWOSS" (`docs/local-runtime.md`) and "No public hosting service is
  included" (`README.md`).

## 4. Approaches considered

### 4.1 Where the authorization server comes from

| Approach | Trade-off |
|---|---|
| **A. Brand packs in the private upstream, public edition exported from a recorded commit** (proposed) | One codebase for security-critical code; the private deployment keeps its exact look through a golden test; matches this catalog's rule that sources come from an organization edition at a recorded commit. Costs an export step per release. |
| B. Make the private repository public | Fastest, but publishes private brand assets, operational notes and history. Rejected. |
| C. Write a new LAWOSS authorization server | No coupling, but duplicates the most security-sensitive code and its hard-won fixes (refresh races, rate limits behind NAT). Rejected. |
| D. Use a generic IdP (Keycloak, Authentik, Zitadel) | Mature, but heavy for a small firm, needs its own theme work to reach the same screens, and loses the one-time activation link and per-service grant model the MCP servers already rely on. Kept as a documented alternative for firms that already run one; not the default. |

*Decision 1:* approach A.

### 4.2 Self-hosted topology

| Approach | Trade-off |
|---|---|
| **A. One hub container, one HTTPS endpoint per service on its own hostname** (proposed) | Spawns the public stdio runtimes; no HTTP release needed in 15 source repositories. Each service is its own OAuth resource with the unchanged `/mcp` path rule, so per-service grants work and the adapter is reused unchanged. Native tool names keep the skills working. Needs one wildcard DNS record. |
| B. One hub endpoint with four meta-tools | One URL and the smallest context, proven in the private gateway. But tool names differ from the local plugins, so every skill needs a remote variant, and one grant covers all services. Possible later addition, not the default. |
| C. One endpoint merging all native tools | One URL, but about 35,000 schema tokens and no per-service grants; name collisions are not guaranteed absent. Rejected. |
| D. Separate HTTP container per MCP (as the private deployment) | Proven, but requires releasing HTTP mode with the OAuth adapter from every organization repository (a contract change in each), and about 15 containers on a small server. Rejected for now. |
| E. Authorization and MCP on one origin | One DNS record and certificate, but per-service resources under approach A need their own hosts anyway (the resource path must be `/mcp`), so a shared origin would only remove the `auth` host. Rejected; the wildcard record gives the same simplicity. |

*Decision 2:* approach A. Hostnames under one base the user chooses, for
example base `mcp.example.com`:

- `auth.mcp.example.com`: the authorization server (issuer, exact origin).
- `orsr.mcp.example.com`, `crz.mcp.example.com`, …: one per enabled service,
  each serving `/mcp` and its protected-resource metadata, all trusting the
  same issuer.
- DNS: one wildcard record `*.mcp.example.com` (or one record per hostname).
  Certificates: one per hostname through the ACME HTTP-01 challenge, so no DNS
  provider credentials are needed on the server.

### 4.3 What the agent receives

| Approach | Trade-off |
|---|---|
| **A. A skill-only plugin in this catalog driving a small deterministic CLI shipped in the self-host repository** (proposed) | The skill holds judgment and human gates; the CLI does the parts that must be exact (key generation, file permissions, checks), so agents do not improvise security steps. Because it depends on an organization repository, it is a regular `releases` entry with a recorded `lawoss-selfhost` commit and the full release gate, not an `inRepoSkills` exception. |
| B. A prose runbook only | Simple, but every agent improvises key generation and verification. Rejected. |
| C. A fully automatic installer script | Fast, but hides the decisions a human must make (DNS, terms of the certificate authority, who gets access). Rejected. |

*Decision 3:* approach A. The plugin is `lawoss-selfhost`, skill-only, with no
`.mcp.json` (every installation has its own URLs, so no server address can
ship in the catalog).

## 5. Design

### 5.1 Public repository

*Decision 4:* one new public organization repository, working name
`lawoss-selfhost`, containing:

- `auth/`: the exported authorization server (public edition).
- `hub/`: the MCP hub.
- `brand/lawoss/`: the default brand pack.
- `deploy/`: `compose.yaml`, a Caddy configuration template, `.env.example`
  with unmistakable placeholders.
- `cli/`: the `lawoss-selfhost` command used inside the server.
- Release records: which catalog commit the runtimes come from, image digests,
  SHA-256 manifests.

Creating the repository, choosing its license and publishing container images
are maintainer decisions (section 9).

Sources of truth (builder-check answer): `auth/` and the resource-server
adapter both come from the private authority repository through the same
export (the adapter already lives there as a standalone file); `hub/`,
`cli/`, `deploy/` and `brand/lawoss/` have no private counterpart and are
developed directly in the public repository. Implementers of Phases 1 to 3
need read access to the private authority repository; Phases 4 to 6 do not.

### 5.2 Authorization server, public edition

Source of truth stays the maintainer's private repository. Two changes land
there first, neither changing the private deployment:

1. **Brand pack.** All brand-specific output moves into a brand pack: a
   directory with `brand.json` and assets. The private repository keeps its own
   pack as the default; nothing in its configuration has to change.
2. **Public export.** A script exports a recorded commit with `git archive`,
   excludes the private brand pack, operational documents and deployment
   registry files, adds the LAWOSS brand pack, and refuses to finish if the
   sanitization scan finds a private hostname, path, identifier or secret
   pattern. The output is committed to `lawoss-selfhost/auth` with the source
   commit recorded.

`brand.json` (validated at startup; invalid packs stop the server with a
clear error):

| Field | Purpose |
|---|---|
| `productName` | Page title suffix, header alt text, log line |
| `accountLabel` | Text next to the service name, for example "LAWOSS account" |
| `locale` | `sk`, `cs`, `en` or `de`; sets `lang` and the built-in text catalog |
| `texts` | Optional overrides per page state (title, subtitle) and for help, footer and admin contact |
| `logo`, `logoDark`, `mark` | SVG files inside the pack, served as images only |
| `artwork` | Optional decorative SVG, hidden from screen readers and on mobile |
| `colors` | `primary`, `primaryDeep`, `accent`, `ink`, `surface`, `line` as hex |
| `fonts` | WOFF2 files inside the pack plus family names; no external font hosts |
| `links` | Optional privacy and terms URLs shown in the footer |

Rules:

- Text is escaped like today. Colors must be hex. A primary color that fails
  4.5:1 contrast against its button text is rejected.
- Assets are read only from inside the pack, size-limited, served with
  `X-Content-Type-Options: nosniff` and the existing strict CSP; SVG is only
  ever loaded through `<img>`, never inlined.
- The page structure, form fields, autocomplete, CSRF and accessibility
  behavior stay identical across brands. Brands change look and words, not
  the flow.
- A preview command renders all six states with synthetic values on loopback,
  so a human can approve a brand before it goes live.

Compatibility choices (no contract change for the private deployment):

| Item | Choice |
|---|---|
| Rendered pages of the private deployment | Byte-identical; enforced by a golden test of all six states rendered with the private pack |
| Configuration format (`AUTH_CONFIG_JSON`) | Unchanged; `brand` is an optional new field defaulting to the built-in pack |
| Internal client metadata property name | Unchanged (internal, invisible, renaming would orphan registered clients) |
| Backup envelope format labels | Unchanged in both editions, so the backup tooling stays one code path |
| Adapter environment variable names | Unchanged; the hub builds the adapter configuration directly, not from those variables |
| Private compose file and its healthcheck host | Untouched and excluded from the export; only the public compose file defines its own healthcheck with `${AUTH_PUBLIC_HOST}` |
| Static assets of the private deployment | Byte-identical after moving into the default pack; enforced by the golden test |

Default LAWOSS brand pack: the LAWOSS mark from the LAWOSS app repository,
colors and typography from the LAWOSS design language (IBM Plex Sans and
Mono, Instrument Serif, all under the SIL Open Font License, bundled as WOFF2
with their license files), Slovak texts, with Czech, English and German text
catalogs. The private brand's font and artwork are not redistributed.

### 5.3 MCP hub

One container, Node, no native build tools at runtime.

- **Runtimes.** The image contains the plugin runtimes from this catalog at one
  recorded commit, verified against `runtime-packages.json` and each runtime's
  SHA-256 manifest at build time and again at start. The image build runs each
  launcher once to install the non-bundled runtimes' dependencies into one
  shared cache (`LAWOSS_CACHE_DIR`), which is read-only at runtime; starting a
  runtime needs neither npm nor network for dependencies.
- **Routing.** The `Host` header selects the service. Unknown hosts get 404.
  Each enabled service is one OAuth resource
  (`https://<service>.<base>/mcp`) with its own introspection secret, using the
  unchanged resource-server adapter (exact copy, SHA-256 compared). The adapter
  keeps no per-resource module state, so one hub process creates one adapter
  instance per enabled service.
- **Services in version 1** (*builder-check call*): one hostname per runtime
  plugin: CRZ, DISQ, EUR-Lex, Finančná správa, Judikáty, Kalkulačky, ORSR,
  Obchodný vestník, RPO, RPVS, Register úpadcov, RÚZ, Slov-Lex, ÚVO. CZ Agents
  is excluded in version 1 (alpha data limitations; its real-estate server has
  an ingest component that conflicts with the no-background-jobs rule); later
  it would get one hostname per sub-server. ŽRSR and the other skill-only
  plugins have no runtime and stay as they are; the skill lists them as
  "not available on a self-hosted server".
- **Transport.** Streamable HTTP on `/mcp`; protected-resource metadata on
  both well-known paths; 401 with the `WWW-Authenticate` challenge without a
  valid token.
- **Process model.** One stdio runtime process per (principal, service),
  started on first use, stopped after 10 idle minutes, with its own working,
  temporary and state directories under the data volume. Global caps: total
  processes, processes per service, concurrent calls per process; over the cap,
  the least recently used idle process stops, otherwise the call returns a
  retryable error. Per-principal processes make per-user state (for example a
  watchlist) safe by construction. Target size (*builder-check call*): a firm
  of 1 to 20 users on a server with 4 vCPU and 8 GB RAM; defaults 40 processes
  in total and 8 per service, which keeps runtime memory under about 5 GB at
  roughly 120 MB per process. The skill states this in step 1.
- **Tool policy.** A service manifest in the hub lists every tool of every
  service as `allow`, `allow-without` (a list of arguments) or `deny-remote`.
  Version 1, from the inventory in section 3: the ten file and state tools are
  `deny-remote` (`manage_watchlist` included until its per-principal storage is
  accepted); the three read tools with save arguments are `allow-without`
  those arguments. Denied tools are absent from `tools/list` and a direct call
  returns an explicit error saying the tool is available in the local plugin
  only; `allow-without` tools are listed with those properties removed from
  the input schema, and a call that sends them is refused with the same kind
  of error. A new tool or a new path-like argument in a runtime update is
  denied until the manifest is reviewed.
- **Environment.** Each runtime receives only its own allowlisted variables
  (for example `FS_API_KEY` for Finančná správa). Missing provider keys make the
  service report its explicit prerequisite error, as locally.
- **Identity.** The verified principal from introspection selects the process.
  Client-supplied headers never do.
- **Limits.** Per principal and service: call rate (default 30 per minute) and
  concurrency (default 2). Per service across all users: outbound concurrency
  (default 4) so that public portals are not hammered from the server's single
  IP. Runtimes keep their own source throttles. All defaults are configurable
  downwards without code changes.
- **Logs.** Structured, one line per call: time, service, tool, duration,
  status, principal hash. No tool arguments, results, tokens or names.

### 5.4 Deployment shape

Docker Compose with three services on a fresh Linux host:

- `proxy`: Caddy, ports 80 and 443 only, automatic certificates per hostname.
  On the internal network it carries the `auth.<base>` hostname as an alias,
  so the hub reaches the issuer's public origin for introspection without
  leaving the host (servers without hairpin NAT would otherwise fail).
- `auth`: the authorization server, internal port only, read-only root
  filesystem, dropped capabilities, persistent `auth-data` volume.
- `hub`: the MCP hub, internal port only, same hardening, persistent
  `hub-data` volume.

Secrets live in `/opt/lawoss/.env` (mode 0600, owned by root) and are
generated on the server by the CLI. Images are referenced by digest.

### 5.5 CLI on the server

`lawoss-selfhost` is a host-side command installed to `/opt/lawoss/bin` and
run with `sudo` by the operator's agent. It is the only way the skill touches
secrets. Privilege model (*builder-check call*): the host command writes
`/opt/lawoss/.env` and drives Docker Compose; account commands run as one-off
`docker compose run --rm auth node dist/admin.js …` containers with only the
`auth-data` volume mounted; backups and snapshots run as one-off containers
with the volumes mounted read-only. No container ever gets the Docker socket,
and the long-running `auth` and `hub` containers stay read-only. No admin
HTTP API is added.

| Command | Effect |
|---|---|
| `init --base BASE --services LIST --brand PACK` | Generates cookie keys, signing keys and one introspection secret per service; writes `.env` (0600); prints only the list of hostnames to create in DNS |
| `brand check PACK` / `brand preview` | Validates a pack; preview on loopback for an SSH tunnel |
| `invite USER SERVICES` | Creates the account with a one-time activation link (1 hour, single use) for the first service and grants the remaining ones; the tenant value is the account name, so every person is their own tenant. The one-off container writes the link into `/opt/lawoss/handoff` (a 0700 host directory bind-mounted only for this command); the host command then sets the file to root-owned 0600 and prints only its path |
| `grant`, `revoke`, `disable`, `list` | Account and grant administration |
| `doctor` | Checks DNS, certificates, issuer metadata, each resource's metadata and 401 challenge, and an in-container stdio `tools/list` per service compared with the manifest; prints pass or fail per check, never secrets |
| `backup` / `restore --dry-run` | Encrypted backup of both volumes and the configuration; the backup key goes to a 0600 file the human must copy elsewhere |
| `update --to RELEASE` / `rollback` | Shows the release note and digest change, snapshots volumes, switches digests, runs `doctor`, rolls back on failure |

### 5.6 The agent skill

`plugins/lawoss-selfhost/skills/lawoss-selfhost/SKILL.md`, Slovak with the
standard four localizations in catalog metadata. Steps and gates:

| # | Step | Agent may do alone | Human must confirm or do |
|---|---|---|---|
| 1 | Explain what will be installed, what it costs in resources, what it does not do | Yes | Agree to proceed |
| 2 | Choose server, base domain, services, brand | Propose defaults | Choose; own the server and domain |
| 3 | Connect to the server | Read-only inspection (OS, Docker, free ports, disk, memory) | Provide SSH access; approve any package installation (Docker) |
| 4 | Firewall | Show the planned rules | Approve opening 80 and 443 |
| 5 | DNS | Print the exact records to create | Create them (DNS changes are the human's) |
| 6 | Fetch the pinned release | Download, verify the repository commit and image digests against the release record pinned in this catalog, show the release note | — |
| 7 | Generate secrets | Run `init`; never read or print `.env` | — |
| 8 | Brand | Build a pack from the user's logo and colors; run `brand check` and the preview | Approve the preview; confirm the right to use the logo |
| 9 | Certificates | Explain the certificate authority's terms and the contact e-mail field | Accept the terms and supply the e-mail |
| 10 | Start | `docker compose up -d`, then `doctor` | — |
| 11 | First account | Run `invite` into a 0600 file; tell the human the file path | Open the file themselves (`cat` in their own terminal), activate the account, choose the password |
| 12 | Connect the app | Give the per-service URLs | Sign in and consent in the LAWOSS app; confirm that tools are listed |
| 13 | Verify | Re-run `doctor`; ask the human for one real query per enabled service and compare with the local plugin | Confirm results look right |
| 14 | Backups | Configure the backup schedule | Copy the backup key off the server; approve the schedule |
| 15 | Hand over | Write a short operations note on the server (no secrets) | — |

Rules the skill states at every step:

- Never print, paste, summarize or store `.env`, keys, activation links or
  passwords. If one appears in output by mistake, stop and tell the human to
  rotate it.
- Never touch DNS, firewall, packages, certificates or accounts without the
  confirmation in the table.
- `doctor` passing proves the deployment works technically, not that the
  data sources are complete; the skill says so.
- Updates follow the same gates: show the note, confirm, `update`, `doctor`.

### 5.7 Security boundaries

- **Secrets:** generated on the server, 0600, never in Git, never in the
  conversation, never in logs. `.env.example` uses obvious placeholders.
- **Accounts:** personal only; activation by one-time link; disabling or a
  password change revokes grants, tokens and browser sessions (existing
  behavior).
- **Isolation:** per-principal processes and directories; identity from
  introspection only; file-writing tools denied remotely; no shared on-disk
  state between principals.
- **Portals:** per-service outbound concurrency and per-user call rates as
  above; no background jobs; the skill explains that the public sources see
  the server's IP and that the operator is responsible for respecting their
  terms.
- **Supply chain:** runtimes only from a recorded catalog commit with
  SHA-256 manifests; images by digest; updates explicit. Trust root
  (*builder-check call*): the `lawoss-selfhost` commit and image digests
  recorded in a reviewed commit of this catalog. Images are built by the
  organization's CI and carry GitHub build provenance attestations, which the
  CLI verifies when `gh` is available; no maintainer-held signing key is
  introduced.
- **Exposure:** only the proxy listens publicly; containers read-only with
  dropped capabilities and resource limits.
- **Brand misuse:** the skill asks for confirmation that the user may use the
  logo and names; the default LAWOSS pack is for LAWOSS users only.

### 5.8 Usage skills for self-hosted users

Today the usage skills ship only inside the runtime plugins, next to their
local `.mcp.json`, and some of them call remote-denied tools or the local CLI
(`node scripts/run.mjs`): CRZ, Judikáty, ORSR, RÚZ, RPO and Slov-Lex.
Installing a runtime plugin only for its skill would start local Node, which
self-hosting is meant to avoid, and would duplicate every tool.

| Approach | Trade-off |
|---|---|
| **A. One skill-only plugin `lawoss-remote-skills` with remote editions of all usage skills** (proposed) | One install next to the remote connections; no local server; each skill is generated from the local skill plus a remote-mode section (no CLI, list of denied tools, what to do instead). Local plugins stay byte-identical. A generator and a test keep the two editions in step. |
| B. Add a remote-mode section to each local skill and tell users to disable the plugin's local server | No new catalog entry, but changes 15 local plugins and depends on every harness allowing a plugin's server to be disabled. |
| C. One skill-only remote wrapper per service | Mirrors the local catalog, but doubles the catalog to about 30 entries. |

*Decision 9:* approach A. It is a new catalog entry and a release
dependency of the self-host plugin, so it needs the same approval as the
other catalog changes.

## 6. Contract changes

| Change | Where | Kind |
|---|---|---|
| Replace "No hosted transport is permitted in LAWOSS" with: LAWOSS hosts nothing; operators may self-host the reviewed runtimes through `lawoss-selfhost` | `docs/local-runtime.md`, `README.md`, `docs/distribution-model.html` | Catalog policy (maintainer approval) |
| New skill-only plugin `lawoss-selfhost` as a regular `releases` entry recording its `lawoss-selfhost` commit | `releases.json`, both catalogs, `lawoss-catalog.json`, validator | Additive catalog entry |
| New skill-only plugin `lawoss-remote-skills` (generated from the local skills, `inRepoSkills`) | same | Additive catalog entry |
| Remote tool set is a reviewed subset of the local one; denied tools return an explicit error | `lawoss-selfhost` hub manifest and docs | New contract for the remote edition only; local unchanged |
| Optional `brand` field in the authorization configuration | Private upstream and public edition | Additive, default keeps current output |
| None for the local plugins, their tools, schemas, launcher or update path | — | — |

## 7. What is left to the builder

- Hub internals: HTTP framework, process supervisor, exact cap defaults within
  the stated ranges, log format details.
- CLI language and packaging, as long as it runs inside the published image.
- The exact export exclusion list, given the rule that the scan must pass.
- Caddy configuration details, health-check intervals, resource limits.
- How the default LAWOSS screens look within the brand system, approved by the
  maintainer through the preview.

## 8. Acceptance

- Golden test: the private deployment's six pages render byte-identically
  before and after the brand refactor.
- Public export scan finds no private hostname, path, identifier or secret.
- End-to-end on a clean throwaway VM, run by an agent following only the
  skill: two personal accounts, per-service grants, revocation takes effect on
  the next call, user A cannot reach user B's process or files, denied tools
  return the explicit error, `tools/list` per service equals the manifest's
  allowed set, refresh after a client restart works, update and rollback work,
  restore from backup works.
- LAWOSS app connects to two services through its loopback OAuth flow.
- A passing acceptance proves technical behavior only; data coverage and legal
  correctness of answers are reported separately per source, as for the local
  plugins.

## 9. Decisions for the maintainer

1. Approach A for the authorization server (brand packs in the private
   upstream, public edition exported from a recorded commit).
2. Topology A: hub with one hostname per service under one wildcard record.
3. Skill plus deterministic CLI; the skill is a skill-only catalog plugin.
4. Creating the public repository `lawoss-selfhost`, its license, and
   publishing container images to a public registry.
5. Changing the catalog policy sentences listed in section 6.
6. Tools denied remotely in version 1 (section 5.3).
7. Default limits toward public portals (section 5.3).
8. The LAWOSS project itself does not register `auth.lawoss.app` or run any
   endpoint; a hosted LAWOSS offer would be a separate decision.
9. Usage skills for self-hosted users through one generated skill-only plugin
   `lawoss-remote-skills` (section 5.8).
10. The public edition keeps three internal identifiers inherited from the
    private upstream unchanged (client metadata property, backup envelope
    labels, adapter variable names). They carry the upstream's name; renaming
    them in the public edition only would split the code.

The memory figure (about 120 MB per process) and the 40-process cap are
estimates; acceptance measures them on the target server size.

Calls made by the author after the builder check, for review while reading:
adapter and hub sources of truth (5.1), version 1 service list and target
size (5.3), host-side CLI privilege model without a Docker socket in any
container (5.5), trust root in a reviewed catalog commit with CI provenance
attestations (5.7), and the self-host plugin as a regular release entry rather
than an `inRepoSkills` exception (4.3, 6).
