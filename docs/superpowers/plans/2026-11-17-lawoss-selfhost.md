# LAWOSS Self-Hosted MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let LAWOSS users deploy the catalog's reviewed MCP runtimes on their own server through an AI agent, behind a brandable OAuth login with LAWOSS as the default brand, while the local path stays unchanged.

**Architecture:** The maintainer's private authorization server gains brand packs (golden-tested so its own deployment stays byte-identical) and an export step that produces a public edition. A new public repository `lawoss-selfhost` adds an MCP hub that serves each enabled service on its own hostname by spawning the public stdio runtimes per principal, plus a server CLI and Docker Compose. A skill-only plugin in this catalog guides the user's agent through deployment with human gates.

**Tech Stack:** TypeScript on Node 24 (authorization server, existing), Node 22.14+ for runtimes, `@modelcontextprotocol/sdk` (Streamable HTTP server, stdio client), Express 5, `oidc-provider` 9, SQLite, Docker Compose, Caddy 2, Python 3 for this catalog's validators.

**Spec:** `docs/superpowers/specs/2026-11-17-lawoss-selfhost-design.md`

**Gate before any task:** the maintainer approves the spec's section 9 decisions. Phase 3 additionally needs the public repository and license decision; Phase 5 needs the policy-sentence decision. Each phase is one pull request in the repository named in its heading.

## Global Constraints

- Nothing is deployed, no DNS is changed, no repository is created or made public, and no image is published without explicit maintainer approval of that exact action.
- The private deployment's six rendered pages and its served assets stay byte-identical (golden test); its compose file is not modified.
- `AUTH_CONFIG_JSON` format unchanged; `brand` is optional and additive.
- Internal client metadata property name, backup envelope labels, adapter environment variable names: unchanged.
- The resource-server adapter is copied byte-for-byte; its SHA-256 equals the upstream copy.
- Resource URLs are `https://<service>.<base>/mcp`; the issuer is the bare origin of `auth.<base>`.
- Access token 60 minutes, refresh at most 90 days, activation link 1 hour and single use, password at least 15 characters: inherited, not re-implemented.
- Default limits: 30 calls per minute and 2 concurrent per (principal, service); 4 concurrent outbound per service; idle process stop after 10 minutes; at most 40 runtime processes in total and 8 per service (target 1–20 users, 4 vCPU, 8 GB RAM).
- Version 1 services (one hostname each): `crz`, `disq`, `eurlex`, `fs`, `judikaty`, `kalkulacky`, `orsr`, `ov`, `rpo`, `rpvs`, `ru`, `ruz`, `slovlex`, `uvo`. CZ Agents and skill-only plugins are out of scope.
- The CLI runs on the host with `sudo`; no container mounts the Docker socket; account and backup commands run as one-off containers.
- Trust root: `lawoss-selfhost` commit and image digests recorded in a reviewed commit of this catalog.
- Remote-denied tools in version 1: `manage_watchlist`, `export_decision_markdown`, `export_decision_markdown_by_reference`, `download_decision_document`, `save_law_markdown`, `save_explanatory_report_markdown`, `read_saved_markdown`, `crz_download_attachment`, `ruz_download_attachment`, `eurlex_document_export`.
- `allow-without` in version 1: `get_decision_full_text` and `get_decision_full_text_by_reference` without `savePath`, `saveToDefaultPath`; `crz_contract_to_markdown` without `save_to_dir`.
- Runtime dependencies are installed at image build into one shared read-only `LAWOSS_CACHE_DIR`; starting a runtime needs no npm and no network for dependencies.
- No secret, key, activation link or password is ever printed by the CLI; outputs are file paths with mode 0600.
- Example hosts in public files use `example.com`; only URL hosts allowed by `scripts/validate.py` appear in this catalog.
- English for code comments and repository docs; the agent skill text is Slovak with catalog localizations in sk, cs, en, de.
- Offline verification only by default; live portal calls only in the acceptance phase on a throwaway VM.

## Review Focus

1. **Two clients refreshing the same token at once from different processes** (the LAWOSS app and a CLI): both stay signed in. Pinned by the inherited refresh-grace test, re-run in Task 3.1 and on the VM in Task 6.1.
2. **A user disabled while their runtime process is alive:** the next call is refused and the process is stopped, not reused. Test in Task 4.3.
3. **A runtime update that adds a tool not in the hub manifest:** the tool is hidden and denied, `doctor` reports the drift. Test in Task 4.2 and Task 4.5.
4. **A brand pack with an SVG containing script, an oversized file or a path outside the pack:** startup fails with a clear message. Test in Task 1.2.
5. **The agent's shell output accidentally containing a secret** (for example `docker compose config` expanding `.env`): the skill forbids that command and `doctor` never prints values. Pinned by the skill's forbidden-command list in Task 5.2 and a CLI output scan test in Task 4.5.

---

## Phase 1 — Private upstream authority: brand packs (no behavior change)

Repository: the maintainer's private authorization-server repository. Its own AGENTS rules and checks apply (`npm ci --ignore-scripts && npm test`, `npm audit --omit=dev --audit-level=high`, `docker build`).

### Task 1.1: Golden pages before refactor

**Files:**
- Create: `test/golden/{login,activate,consent,help,success,expired}.html`
- Create: `test/golden.test.mjs`

**Interfaces:**
- Consumes: `renderPage(o: PageOptions): string` from `src/ui.ts` (existing).
- Produces: fixture `goldenOptions: Record<PageState, PageOptions>` exported from `test/golden.test.mjs` for Task 1.2.

- [ ] **Step 1:** Write `test/golden.test.mjs` with `goldenOptions` using synthetic values (service `Ukážková služba`, client `Ukážková aplikácia`, redirect `http://127.0.0.1:19876/mcp/oauth/callback`, csrf `x`, username `kolega`, error `Nesprávne údaje.`). Freeze the year by passing a fixed `Date` via `t.mock.timers` set to 2026-11-17.
- [ ] **Step 2:** Generate the six fixtures once from the current `main` with a one-off script and commit them unchanged.
- [ ] **Step 3:** Test `golden pages are byte-identical`: `assert.equal(renderPage(goldenOptions[state]), readFileSync(fixture))` for each state. Test `served assets are byte-identical`: a fixture `test/golden/assets.sha256` with the SHA-256 of every file served under `/assets/` today; the test fetches each through the app and compares.
- [ ] **Step 4:** Run `npm test`. Expected: PASS on unchanged code.
- [ ] **Step 5:** Commit `test: freeze the six rendered pages as golden fixtures`.

### Task 1.2: Brand pack loader and default private pack

**Files:**
- Create: `src/brand.ts`, `brand/default/brand.json`
- Move: current logo, dark logo, artwork, font and tokens into `brand/default/` (served paths stay `/assets/...`)
- Modify: `src/ui.ts` (every hardcoded brand string and asset reads from `Brand`), `src/server.ts` (static asset route, startup log line, optional `config.brand`), `src/preview.ts`, `Dockerfile` (copy `brand/`)
- Test: `test/brand.test.mjs`, `test/golden.test.mjs`

**Interfaces:**
- Produces:
  - `interface Brand { productName: string; accountLabel: string; locale: "sk"|"cs"|"en"|"de"; texts: Partial<Record<PageState,[string,string]>> & { help?: string; footer?: string; adminContact?: string; topNote?: string; asideTitle?: string; asideText?: string }; assets: { logo: string; logoDark?: string; mark?: string; artwork?: string; fonts: { file: string; family: string; weight?: string }[]; tokens: string }; colors?: { primary: string; primaryDeep: string; accent: string; ink: string; surface: string; line: string }; links?: { privacy?: string; terms?: string } }`
  - `loadBrand(dir: string): Brand` — throws `Error("Invalid brand pack: <reason>")`.
  - `renderPage(o: PageOptions, brand?: Brand): string` — `brand` defaults to the loaded default pack.
  - `Config.brand?: string` — directory of the pack; absent means `brand/default`.

- [ ] **Step 1: Failing tests** in `test/brand.test.mjs`:
  - `rejects an asset outside the pack` (`logo: "../x.svg"` → throws `/outside the pack/`).
  - `rejects svg with script` (`<svg><script/>` → throws `/script/`); also rejects `on*=` attributes and `<foreignObject>`.
  - `rejects an asset larger than 512 KiB` and a font not ending `.woff2`.
  - `rejects non-hex color` and `rejects primary with contrast below 4.5 against white` (`#BBBBBB`).
  - `escapes all brand texts` (`productName: "<b>"` → output contains `&lt;b&gt;`).
  - `sets lang from locale` (`locale: "cs"` → `<html lang="cs">`).
- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL, golden PASS.
- [ ] **Step 3:** Implement `loadBrand` and thread `Brand` through `renderPage`; the default pack reproduces today's strings exactly. Built-in text catalogs for `cs`, `en`, `de` live in `src/brand.ts` as data.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS, golden byte-identical.
- [ ] **Step 5:** `docker build -t auth:test .` succeeds. `compose.yaml` stays untouched.
- [ ] **Step 6:** Commit `feat(auth): brand packs with the current brand as the default, pages unchanged`.

### Task 1.3: Public export

**Files:**
- Create: `scripts/export_public.py`, `scripts/test_export_public.py`, `export-exclude.txt`

**Interfaces:**
- Produces: `python3 scripts/export_public.py --commit SHA --brand-pack DIR --output DIR` writing a tree with `SOURCE_COMMIT` and `EXPORT_MANIFEST.sha256`; exit 1 with the offending path on a scan hit.

- [ ] **Step 1: Failing tests:** `excludes compose.yaml`, `excludes the default private pack`, `excludes listed docs and deploy files`, `fails on a private hostname` (fixture file with a hostname from a deny list read from an untracked local file, so the deny list itself is never committed), `fails on a user path`, `fails on a PEM header`, `writes SOURCE_COMMIT equal to --commit`, `replaces brand/default with the given pack`.
- [ ] **Step 2:** Run `python3 -m unittest scripts/test_export_public.py`. Expected: FAIL.
- [ ] **Step 3:** Implement with `git archive SHA` into a temp dir, apply `export-exclude.txt`, copy the pack to `brand/default`, run the scan (same patterns as this catalog's `scripts/validate.py` plus the local deny list).
- [ ] **Step 4:** Tests PASS; run against `HEAD` with a placeholder pack. Expected: exit 0.
- [ ] **Step 5:** Commit `feat(release): export a sanitized public edition from a recorded commit`.

## Phase 2 — LAWOSS brand pack and screen approval

Repository: `lawoss-selfhost` once created (Phase 3 gate); until then a branch in the private repository under `brand/lawoss/`, never deployed.

### Task 2.1: LAWOSS pack

**Files:**
- Create: `brand/lawoss/brand.json`, `brand/lawoss/logo.svg`, `brand/lawoss/logo-dark.svg`, `brand/lawoss/mark.svg`, `brand/lawoss/tokens.css`, `brand/lawoss/fonts/{IBMPlexSans-Variable,IBMPlexMono-Regular,InstrumentSerif-Regular}.woff2`, `brand/lawoss/fonts/OFL.txt`

- [ ] **Step 1:** Take the mark from the LAWOSS app repository's `lawoss/brand/lawoss-mark.svg`; colors from `docs/distribution-model.html` (`#f4f1ea` surface, `#0a0e14` ink, `#42586e` line/secondary) and the mark's gold as accent; Slovak texts with "LAWOSS" as `productName` and "účet LAWOSS" as `accountLabel`.
- [ ] **Step 2:** `loadBrand("brand/lawoss")` succeeds; contrast test passes.
- [ ] **Step 3:** Render all six states with `npm run build && node dist/preview.js` using the pack; save desktop and mobile screenshots to `brand/lawoss/preview/`.
- [ ] **Step 4:** Maintainer approves the screenshots (human gate). Commit `feat(brand): LAWOSS default brand pack`.

## Phase 3 — Public repository `lawoss-selfhost`: authorization edition

Gate: maintainer creates the organization repository and picks the license. Passed on 2026-11-18: `Omni-Legal-Products/lawoss-selfhost`, AGPL-3.0, `main` holds only `LICENSE`. The export (Step 1) and the first push to `main` each need their own maintainer consent; work lands through pull requests.

### Task 3.1: First export and CI

**Files:**
- Create (by export): `auth/**`, `auth/SOURCE_COMMIT`
- Create: `README.md`, `AGENTS.md` = `CLAUDE.md`, `LICENSE`, `SECURITY.md`, `.github/workflows/ci.yml`, `deploy/.env.example`

- [ ] **Step 1:** Run the Phase 1 export from the approved commit with `brand/lawoss`.
- [ ] **Step 2:** CI runs `npm ci --ignore-scripts`, `npm test` (includes refresh-grace, rate-limit and bootstrap tests), `npm audit --omit=dev --audit-level=high`, `docker build`.
- [ ] **Step 3:** Expected: CI green; `cmp AGENTS.md CLAUDE.md` passes.
- [ ] **Step 4:** Commit `feat: public authorization edition exported from <SHA>`.

## Phase 4 — Public repository `lawoss-selfhost`: hub, CLI, compose

### Task 4.1: Service manifest and runtime bundle

**Files:**
- Create: `hub/services.json`, `hub/src/manifest.ts`, `hub/scripts/fetch-runtimes.mjs`, `hub/test/manifest.test.mjs`

**Interfaces:**
- Produces:
  - `services.json`: `{ catalogCommit: string, services: Record<ServiceId, { plugin: string; server?: string; tools: Record<string, "allow"|"deny-remote">; env: string[]; stateEnv?: string }> }`
  - `loadManifest(path: string): Manifest`; `type ServiceId = string` (lowercase DNS label).
  - `fetch-runtimes.mjs --catalog-commit SHA --out DIR` copies `plugins/<p>/{runtime,runtime-config.json,scripts/run.mjs}` from this catalog at that commit and verifies every runtime's manifest SHA-256.

- [ ] **Step 1: Failing tests:** `rejects a service id that is not a DNS label`, `rejects duplicate tool policy keys`, `every Global Constraints denied tool is deny-remote`, `allow-without entries equal the Global Constraints list`, `every tool reported by each runtime has a policy entry`, `service ids equal the Global Constraints version 1 list`, `fetch fails when a runtime file digest differs`.
- [ ] **Step 2–4:** Implement, run `npm test` in `hub/`, expect PASS.
- [ ] **Step 5:** Commit `feat(hub): reviewed service manifest and verified runtime bundle`.

### Task 4.2: Host-routed MCP endpoint with tool policy

**Files:**
- Create: `hub/src/server.ts`, `hub/src/routing.ts`, `hub/src/policy.ts`, `hub/src/resource-auth.ts` (byte-for-byte adapter copy; CI compares its SHA-256 with the recorded upstream digest), `hub/test/routing.test.mjs`, `hub/test/policy.test.mjs`

**Interfaces:**
- Consumes: `createSharedAuth(config: SharedAuthConfig)`, `runWithIdentity`, `principalKey` from the adapter; `Manifest`.
- Produces: `createHub(opts: { base: string; issuer: string; manifest: Manifest; secrets: Record<ServiceId,string>; pool: ProcessPool }): express.Express`.

- [ ] **Step 1: Failing tests** (adapter with `allowHttpForTests`, fake introspection):
  - `unknown host returns 404`.
  - `metadata on both well-known paths names the issuer and https://<id>.<base>/mcp`.
  - `missing token returns 401 with WWW-Authenticate challenge`.
  - `token for orsr is refused on crz host` (audience mismatch).
  - `tools/list hides deny-remote tools and tools absent from the manifest`.
  - `calling a deny-remote tool returns isError with text "Tento nástroj je dostupný len v lokálnom plugine."`.
  - `allow-without tool is listed without savePath and saveToDefaultPath in its input schema`.
  - `allow-without tool called with savePath returns isError with text "Ukladanie súborov na server nie je dostupné; výsledok dostanete v odpovedi."` and the runtime is not called.
- [ ] **Step 2–4:** Implement; `npm test`; PASS.
- [ ] **Step 5:** Commit `feat(hub): one OAuth resource per service host with reviewed tool policy`.

### Task 4.3: Per-principal process pool and limits

**Files:**
- Create: `hub/src/pool.ts`, `hub/src/limits.ts`, `hub/test/pool.test.mjs`, `hub/test/limits.test.mjs`, `hub/test/fixtures/echo-runtime.mjs`

**Interfaces:**
- Produces:
  - `class ProcessPool { constructor(opts: { runtimesDir: string; dataDir: string; maxTotal: number; maxPerService: number; idleMs: number; envFor(id: ServiceId): Record<string,string> }); client(principal: string, id: ServiceId): Promise<Client>; stopPrincipal(principal: string): Promise<void>; size(): number }`
  - `class Limits { constructor(opts: { ratePerMinute: number; perPrincipalConcurrency: number; perServiceConcurrency: number }); run<T>(principal: string, id: ServiceId, fn: () => Promise<T>): Promise<T> }` — over limit throws `RetryableError`.

- [ ] **Step 1: Failing tests:**
  - `two principals get different processes and different working directories`.
  - `a principal cannot read a file the other principal's process wrote` (echo runtime writes to its state dir; second principal's process lists its own dir: empty).
  - `idle process stops after idleMs` (fake timers, 10 minutes default).
  - `maxTotal evicts the least recently used idle process`.
  - `31st call within a minute is refused`; `third concurrent call for one principal is refused`; `fifth concurrent call across principals for one service waits or is refused`.
  - `env contains only allowlisted keys plus PATH, HOME, TMPDIR, LAWOSS_CACHE_DIR`.
  - `runtime starts with PATH lacking npm and network disabled` (warm shared cache from the image build; run for one non-bundled runtime, CRZ).
  - `disabled principal: introspection inactive → stopPrincipal called and request 401` (Review Focus 2).
- [ ] **Step 2–4:** Implement (stdio client from the SDK, `cwd`, `HOME`, `TMPDIR` and the manifest's `stateEnv` set to `dataDir/<sha256(principal)>/<id>/`); PASS.
- [ ] **Step 5:** Commit `feat(hub): per-principal runtimes with call and concurrency limits`.

### Task 4.4: Compose, proxy and images

**Files:**
- Create: `deploy/compose.yaml`, `deploy/Caddyfile.template`, `hub/Dockerfile`, `deploy/test/compose.test.py`

- [ ] **Step 1: Failing tests** (`deploy/test/compose.test.py`, parses YAML): only `proxy` publishes ports and only 80 and 443; `auth` and `hub` have `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, memory and pids limits; images are referenced as `name@sha256:`; no literal secret values; healthcheck host is `${AUTH_PUBLIC_HOST}`; no service mounts `/var/run/docker.sock`; `proxy` has the network alias `${AUTH_PUBLIC_HOST}` so the hub introspects without hairpin NAT.
- [ ] **Step 2–4:** Implement; `python3 -m unittest deploy/test/compose.test.py`; PASS; `docker compose -f deploy/compose.yaml config -q` with `.env.example` exits 0.
- [ ] **Step 5:** Commit `feat(deploy): hardened compose with automatic per-host certificates`.

### Task 4.5: Server CLI

**Files:**
- Create: `cli/lawoss-selfhost.mjs` (installed to `/opt/lawoss/bin`, runs on the host with `sudo`), `cli/commands/{init,brand,invite,admin,doctor,backup,update}.mjs`, `cli/test/*.test.mjs`

**Interfaces:**
- Consumes: the authorization server's existing `admin.js` commands and `scripts/backup.mjs`; `Manifest`.
- Produces: the commands in spec section 5.5 with exit code 0 on success, 1 on failure, 2 on usage errors.

- [ ] **Step 1: Failing tests:**
  - `account commands run as docker compose run --rm auth node dist/admin.js with only auth-data mounted` (assert the composed argument vector with a fake runner).
  - `init writes .env with mode 0600 and prints only hostnames` (stdout contains `auth.<base>` and `<id>.<base>` lines and nothing matching `/[A-Za-z0-9_-]{32,}/`).
  - `init refuses to overwrite an existing .env`.
  - `invite USER orsr,crz runs invite for orsr with tenant USER, then grant-resource for crz with tenant USER` (fake runner).
  - `invite leaves a root-owned 0600 file in /opt/lawoss/handoff and prints only its path`; `invite refuses when the account already has a pending file`.
  - `doctor never prints values from .env` (run against fixtures with known secrets; assert none appears in stdout or stderr) (Review Focus 5).
  - `doctor reports manifest drift when a runtime lists a tool absent from services.json` (Review Focus 3).
  - `update refuses a release whose digest is not in the signed release record`; `update rolls back when doctor fails after switch`.
- [ ] **Step 2–4:** Implement; PASS.
- [ ] **Step 5:** Commit `feat(cli): deterministic init, invite, doctor, backup and update`.

## Phase 5 — This catalog: policy and the skill-only plugin

Repository: `lawoss-marketplace`. Gate: maintainer approves the policy sentences. Checks: `python3 -m unittest discover -s tests -v`, `python3 scripts/validate.py`, `claude plugin validate --strict .`, Codex isolated install acceptance, `cmp AGENTS.md CLAUDE.md`.

### Task 5.1: Policy wording

**Files:**
- Modify: `docs/local-runtime.md` (Scope paragraph), `README.md` (Distribution boundary last paragraph), `docs/distribution-model.html` (note), `tests/test_marketplace.py`

- [ ] **Step 1: Failing test** `test_policy_names_selfhost_and_no_lawoss_hosting`: README contains "LAWOSS does not host or operate" and "lawoss-selfhost"; no file contains "No hosted transport is permitted".
- [ ] **Step 2–4:** Edit the three documents with the approved sentences; tests PASS.
- [ ] **Step 5:** Commit `docs: self-hosting through lawoss-selfhost; LAWOSS hosts nothing`.

### Task 5.2: `lawoss-selfhost` skill-only plugin

**Files:**
- Create: `plugins/lawoss-selfhost/{README.md,.claude-plugin/plugin.json,.codex-plugin/plugin.json}`, `plugins/lawoss-selfhost/skills/lawoss-selfhost/SKILL.md`, `plugins/lawoss-selfhost/skills/lawoss-selfhost/references/{gates.md,dns-and-tls.md,brand.md,operations.md}`
- Modify: `.agents/plugins/marketplace.json`, `.claude-plugin/marketplace.json` (via `scripts/sync_claude.py`), `lawoss-catalog.json` (category General, sk/cs/en/de titles), `releases.json` (regular `releases` entry: repository `Omni-Legal-Products/lawoss-selfhost`, recorded commit, `distribution: "selfhost-skill"`), `scripts/validate.py` (accept that distribution: skill-only wrapper with a recorded source), `tests/test_marketplace.py`

- [ ] **Step 1: Failing tests:** `test_selfhost_is_skill_only` (no `.mcp.json`, no `runtime`, no `scripts`), `test_selfhost_skill_lists_all_fifteen_gates` (SKILL.md contains the 15 step headings of spec 5.6), `test_selfhost_skill_forbids_secret_commands` (contains a "Nikdy nespúšťaj" list including `cat .env`, `docker compose config`, `env`, `printenv`).
- [ ] **Step 2–4:** Write the skill from spec 5.6 (Slovak; each step has "Agent smie sám" and "Potvrdí človek"); pin the `lawoss-selfhost` release by commit and digest; run all checks; PASS.
- [ ] **Step 5:** Maintainer review of the skill text (required by the `inRepoSkills` exception). Commit `feat: lawoss-selfhost skill for agent-guided self-hosting`.

### Task 5.3: `lawoss-remote-skills` generated plugin

**Files:**
- Create: `scripts/build_remote_skills.py`, `tests/test_remote_skills.py`, `plugins/lawoss-remote-skills/{README.md,.claude-plugin/plugin.json,.codex-plugin/plugin.json}`, `plugins/lawoss-remote-skills/skills/<skill>/SKILL.md` (generated, one per version 1 service)
- Modify: both catalogs, `lawoss-catalog.json`, `releases.json` (`inRepoSkills`)

**Interfaces:**
- Produces: `python3 scripts/build_remote_skills.py [--check]` copies each local usage skill, removes the local CLI section, appends a Slovak "Vzdialený režim" section listing that service's remote-denied tools and the local alternative; `--check` exits 1 if the committed output differs.

- [ ] **Step 1: Failing tests:** `remote skills exist for every version 1 service`, `remote skill text contains no scripts/run.mjs`, `remote skill names every denied tool of its service`, `generated output is up to date` (`--check` exits 0), `local skills are unchanged` (digest of `plugins/*/skills` outside `lawoss-remote-skills` equals `main`).
- [ ] **Step 2–4:** Implement and generate; run all catalog checks; PASS.
- [ ] **Step 5:** Maintainer review of the generated text. Commit `feat: remote editions of usage skills for self-hosted servers`.

## Phase 6 — Acceptance on a throwaway VM

### Task 6.1: End-to-end run by an agent

**Files:**
- Create: `docs/lawoss-selfhost-acceptance.md` in this catalog (results only, no hostnames beyond `example.com` placeholders, no secrets).

- [ ] **Step 1:** A fresh agent session with only the skill installed deploys onto a new VM with a test domain; the human performs every gated step.
- [ ] **Step 2:** Verify and record each spec section 8 item: two accounts, grants, revocation on next call, cross-user isolation, denied-tool error, `tools/list` equals the allowed set, LAWOSS app loopback connect to two services, refresh after client restart, concurrent refresh (Review Focus 1), update, rollback, backup restore.
- [ ] **Step 3:** Record data-source results separately per service (technical pass is not coverage or legal correctness).
- [ ] **Step 4:** Destroy the VM and test DNS records; commit the acceptance note.

## Execution order and pull requests

| PR | Repository | Contract change |
|---|---|---|
| 1 This spec and plan | lawoss-marketplace | none (docs) |
| 2 Tasks 1.1–1.2 | private authority | none (golden test) |
| 3 Task 1.3 | private authority | none |
| 4 Phase 2 | private authority branch | none (screens approved by maintainer) |
| 5 Phase 3 | lawoss-selfhost (new, public) | new public artifact (maintainer gate) |
| 6–10 Tasks 4.1–4.5 | lawoss-selfhost | remote tool subset (new contract, remote only) |
| 11 Task 5.1 | lawoss-marketplace | catalog policy (maintainer gate) |
| 12 Task 5.2 | lawoss-marketplace | additive catalog entry, validator accepts `selfhost-skill` |
| 12b Task 5.3 | lawoss-marketplace | additive catalog entry |
| 13 Phase 6 | lawoss-marketplace | none |

PRs 2–4 and 6–9 can proceed in parallel once their gates pass; PR 5 must precede 6–10; PR 12 needs a released `lawoss-selfhost` commit to pin.
