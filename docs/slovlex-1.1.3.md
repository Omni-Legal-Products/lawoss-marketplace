# Slov-Lex 1.1.3 acceptance

Source: `Omni-Legal-Products/mcp-slovlex` commit `bcc73f5dcc6d323600ecba72ddc61d18a77046eb` (PR #5 into `codex/lawoss-release-2026-09-05`, source version 1.3.5). Fixes from the MCP audit of 2026-10-09.

- Fix: `get_version` and `save_law_markdown` now return the whole law: body with part/title headings, then annexes ("PRÍLOHY") and footnotes ("Poznámky pod čiarou"). Previously annexes (e.g. the entire fee schedule of 145/1995, ~89 % of its text), footnotes and headings were dropped while the output claimed `MCP_WINDOW_COMPLETE: true`. Annexes that Slov-Lex publishes only as PDF are listed with their URL, not rendered. Tables are no longer padded with spaces.
- Fix: `get_paragraph` no longer attaches paragraphs of the requested law for references that belong to another law ("§ 13 Obchodného zákonníka", "§ 4 …, § 10 … a § 58 zákona č. 366/1999", "§ X zákona o …"). Ambiguous "§ N" in a sentence that cites another law is skipped; references Slov-Lex itself links are always kept.
- Fix: footnote markers are read from the HTML, so "(§ 8)" is no longer treated as footnote 8) (145/1995 § 13 no longer attaches the Administrative Procedure Act).
- Fix: rendering a paragraph no longer detaches its nodes from the document, which had hidden footnote links and pending-change markers from later checks.
- Fix: `get_explanatory_reports` with `resolve_lp` never auto-selects an amendment of the law, matches the law number on word boundaries and gives the eLegislatíva material list a 60 s timeout (it always timed out at 15 s). The output states when the original legislative process is not in the source.
- Fix: the Constitution (460/1992) renders, and `get_paragraph` reads articles ("Čl. 5").
- Fix: a paragraph that an amendment only quotes (248/2026 "§ 49a") is not returned as the amendment's own; the tool names the article and the amended law (106/2018).
- Change: `save_law_markdown` accepts `max_chars` up to 2 000 000 (default unchanged, 50 000). Tool names and input schemas are otherwise unchanged.
- Dependencies: `npm audit --omit=dev` reports 0 vulnerabilities. Non-breaking updates of `@modelcontextprotocol/sdk` (1.32.1), `undici` (7.30.0), `proxy-addr` and `ip-address`; `overrides` pins `argparse` ^2.0.1 for `mammoth`, which removes `sprintf-js` (no fixed release; it was reachable only through mammoth's CLI binary, not the server).
- Catalog skill: new pitfalls and sequences for annexes, quoted paragraphs, related references and `resolve_lp`.
- Source tests: 113 passed (17 new regression tests on trimmed real Slov-Lex and eLegislatíva captures, failing on the previous logic); 8 organization contract tests passed; TypeScript build and check passed.
- Catalog: 42 Python tests (Node 24.19), `scripts/validate.py`, `claude plugin validate --strict` and instruction mirrors passed. The Codex plugin-creator validator was not available in the preparing environment and still has to run.
- Packaged runtime smoke (stdio via `scripts/run.mjs mcp`, live Slov-Lex read, 2026-10-12): `get_version` 145/1995 returned 443 005 characters including the fee schedule; `get_paragraph` 595/2003 § 30c without its own § 13, 145/1995 § 13 without 71/1967, 248/2026 § 49a redirected to 106/2018, 460/1992 Čl. 5 returned.

Not addressed: `colspan`/`rowspan` in tables and low-severity audit findings #13–#16.

- Isolated Git-marketplace acceptance (2026-10-12, separate `CODEX_HOME` and `CLAUDE_CONFIG_DIR`): Codex installed `slovlex@lawoss` 1.1.2 from `main`, `scripts/update_plugins.py --apply` updated it to 1.1.3 from `release/slovlex-1.1.3-r2`, the installed runtime started with `scripts/run.mjs mcp` from an unrelated working directory and answered live Slov-Lex reads (145/1995 443 005 characters, 145/1995 § 13 without 71/1967, 460/1992 Čl. 5), and the same updater rolled it back to 1.1.2 from `main` (145/1995 back to 42 830 characters). Claude Code installed 1.1.3 from `release/slovlex-1.1.3-r2`; the installed skill carries the new pitfalls and the installed runtime answered the same reads.

Not run: the Codex plugin-creator validator. The installed plugin-creator (0.1.26) ships skills only and no `validate_plugin.py`.

Tests establish behavior for the captured HTML and selected live reads. They do not establish legal applicability or universal coverage of every Slov-Lex document structure.
