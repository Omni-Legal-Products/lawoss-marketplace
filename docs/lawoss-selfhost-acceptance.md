# lawoss-selfhost acceptance (0.2.0 and 0.2.1)

Date: 2026-11-20. Releases: `Omni-Legal-Products/lawoss-selfhost` 0.2.0 (commit `29440f8af25792e42b4c764f8334ec9be239439b`, record SHA-256 `425865a7262019e6d77c7b847b9a42cdc8b0c4ae02b9358dd3ed39ccbc5f38b3`) and 0.2.1 (commit `9efec09a95c513ab88d9a1116bee96e1c6de40c1`, record SHA-256 `a8406c8ed317b666968b49dd8f1907276e7482b0a91181be003cef85478ae84b`; documentation changes only, rebuilt images). Skill: `lawoss-selfhost` from #58 (commit `6e702eb`), pinned to 0.2.0.

Environment: not a clean VM, by the maintainer's choice. The server was a shared Ubuntu 24.04 host with Docker in swarm mode, where an existing Traefik v3.6, managed by a self-hosted PaaS, already held ports 80 and 443. The deployment used the skill's existing-proxy branch:

- Caddy published on the Docker bridge gateway, ports 18080 and 18443.
- A Traefik file-provider route used TLS passthrough by SNI for the exact hosts.
- The base domain was a test subdomain (`lawoss.example.com` in this note) with a wildcard DNS record served without a CDN proxy.
- Services: slovlex, kalkulacky, judikaty. Brand: default LAWOSS.

The deployment was removed after the test.

## Installation by an agent following only the skill

A fresh agent session read only the skill and its references. Every `sudo` command was run by the human, because `sudo` asked for a password. The human also installed the Traefik file.

- Result: `doctor` 22/22 PASS. Let's Encrypt certificates were issued through the passthrough (TLS-ALPN-01).
- The first account was invited and activated, and a sign-in through Claude Code (loopback OAuth) connected.
- The agent did not read the proxy's certificate store or the environment of the proxy container. It did not change the firewall, Traefik or the PaaS.

Twenty-one gaps in the skill text were recorded. #59 closed them; its table lists each gap and its fix. Two installation problems cost the most time:

- The Traefik file was reported installed while it was missing.
- Caddy did not retry certificate issuance for about 15 minutes after the first failure. A restart of the LAWOSS proxy alone fixed it.

## Acceptance items

Run against the deployment with a small loopback OAuth client (dynamic registration, PKCE S256, MCP streamable HTTP) and Claude Code. Account A held all three services; account B held kalkulacky only.

| Item | Result |
|---|---|
| Two personal accounts, per-service grants | PASS. A signed in to three services, B to one. B's token is refused (401) by slovlex and judikaty. A token for one service is refused by another (audience). |
| `tools/list` per service equals the manifest's allowed set | PASS. slovlex 7/7, kalkulacky 6/6, judikaty 20/20; `allow-without` arguments (`savePath`, `saveToDefaultPath`) are absent from the listed schemas. |
| Denied tools return the explicit error | PASS. Three `deny-remote` tools and an unknown tool return `isError` with "Tento nástroj je dostupný len v lokálnom plugine."; passing a stripped argument returns the save refusal text. |
| Revocation takes effect on the next call | PASS. After `revoke A kalkulacky`, A's existing access token got 401 and its refresh got `invalid_grant`; A's other services and B were unaffected. `disable B` behaved the same. |
| User A cannot reach user B's process or files | PASS as designed. Each principal (account and service) runs its own runtime process with `HOME`, `TMPDIR` and working directory in its own `/data/<sha256>` directory (mode 0700), and the file-reading and file-saving tools are denied. Residual risk: all runtimes run as the same uid in the hub container, so separation is not enforced by the operating system. |
| Refresh after a client restart | PASS. A new process refreshed with the stored refresh token and the new access token worked. |
| Concurrent refresh | PASS. Two parallel refreshes with the same refresh token both returned 200 with the same new refresh token; both access tokens worked. |
| Update | PASS. `install-host-files` and `update --to 0.2.1` ran `doctor` (all PASS) and switched images; existing sign-ins kept working. The 0.2.1 record was taken from the release run's artifact and checked by SHA-256, because the catalog does not pin 0.2.1. |
| Rollback | PASS. `rollback` returned the 0.2.0 images; `doctor` all PASS; sign-ins and grants unchanged. |
| Restore from backup | PASS. Steps: `backup init-key`, `backup`, then `disable B`, `restore --dry-run` (PASS) and `restore --apply`. Restore ran `doctor` (all PASS), B was active again with its earlier tokens, A's revocation was kept, and certificates survived. |
| LAWOSS app connects to two services through loopback OAuth | Partly. The loopback flow was verified with Claude Code and the test client on all three services; the LAWOSS app itself was not tested. |

## Findings for the product

- **Claude desktop and claude.ai connectors cannot connect.** Dynamic registration accepts only loopback or pre-registered callbacks. The auth server has a `redirectUris` setting, but `lawoss-selfhost` gives operators no way to set it. Deciding whether to offer one is a contract change for the maintainer.
- **Runtimes share one uid** (see the isolation row).
- **judikaty `get_provider_health` timed out twice** at the hub's call limit on 0.2.1; `search_decisions` answered in under a second. Not checked before the update.
- **The sign-in page shows one message for a wrong password and for an account that was invited but not activated.** An activation that was not completed looked like a wrong password.

## Data sources

A passing acceptance proves technical behavior only. These live calls returned answers:

| Service | Call | What the answer shows |
|---|---|---|
| slovlex | `get_paragraph` 40/1964 § 101 | The version in force on the test date. It also said that no later version was found in Slov-Lex. |
| kalkulacky | `urok_z_omeskania` | Computed with the ECB rate 2.15 % + 8 p. b. |
| judikaty | `search_decisions` | The index the deployment reached reported 34,421 and 171,371 hits for two queries. |

The completeness of these sources and the legal correctness of the answers were not assessed here. They are reported per source in each plugin's own acceptance notes, as for the local plugins.
