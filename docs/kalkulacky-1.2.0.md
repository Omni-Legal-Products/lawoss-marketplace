# Kalkulačky 1.2.0 acceptance

Source: `Omni-Legal-Products/mcp-kalkulacky-sk` commit `5ff45d0d03887bd3a166f80f40635a508a2d1a3f` (PR #1 into `codex/lawoss-release-2026-09-05`), server version 0.2.0. It ports the fixes from the audit of 2026-10-09 (K1–K6) from the reviewed upstream and adds a lockfile-only `npm audit fix`.

- K1: ECB main refinancing rate 2.65 % from 2026-09-16 added (ECB Data Portal API, series `FM.D.U2.EUR.4F.KR.MRR_FR.LEV`); table coverage to 2026-10-12. `urok_z_omeskania` now warns whenever an ECB rate is looked up for a day after `coverage.to`, not only 60 days after it. `sadzby_info` adds `ecbVekDni` and `upozornenia[]`; the stdio server reports a table older than 14 days at start. The local runtime has no overlay refresh, so the ECB table is the one in this release.
- K2: court fee schedule as amended by Act 29/2026 Coll. (from 2026-08-17). Ids `17d`/`17e` now cite Item 17b letters a)/b). With `epodanie: true` they stay at 140 EUR and a warning names the open question under § 6(5) and the 90 EUR alternative. New ids: `17-kvalifikovane-namietky`, `17-kvalifikovany-podnet`, `17c-namietka-zaujatosti`.
- K3: the half-year method of § 3(2) Government Regulation 87/1995 (2009 – January 2013) applies only if the ECB rate changed during the delay (`alternativy[].podmienkaZmenyEcbSplnena`).
- K4: the `obchodnaVec` description refers to commercial matters (cap 50,000 EUR), not the commercial register.
- K5/K6: `trovy_exekucie` gains optional inputs `inyDovodUkonceniaVLehote` (§ 22(2), 50 % flat expenses) and `datumPlnenia` (VAT 20 % until 2024, 23 % from 2025); without them it calculates as before and warns.
- Tool names and schemas are unchanged; the new inputs are optional.
- Catalog: the kalkulacky runtime spec allows the public host `static.slov-lex.sk`, which the fee data cites as its source.
- Source tests: 217 passed in 18 files, including the catalog and diagram contracts; TypeScript check and build passed; `npm audit --omit=dev` 0 vulnerabilities. 18 new regression tests failed on the previous code; they use a captured ECB Data Portal response and a verbatim excerpt of the fee schedule from the Slov-Lex consolidated versions 20260612 and 20260817.
- Packaged runtime smoke (stdio, 2026-10-12, first start installed the locked dependencies): interest from 2026-09-21 on 100,000 EUR returned 293.42 EUR (civil) and 446.85 EUR (commercial, fixed); 2009 case returned 103.56 EUR under § 3(1) with § 3(2) flagged as not applicable; `17d` with e-filing returned 140 EUR with the warning; enforcement returned 50 EUR flat expenses with `inyDovodUkonceniaVLehote` and 636 EUR with VAT for a 2023 supply; `sadzby_info` reported coverage to 2026-10-12.

Pending before merge: Codex plugin-creator validator (not installed in the preparing environment) and isolated Git-marketplace install/update/rollback acceptance.

Tests establish behavior for the captured sources and selected cases. They do not establish legal applicability, for example the e-filing discount for Item 17b or the facts behind `inyDovodUkonceniaVLehote`. Slov-Lex HTML is informative; the binding text is the PDF.
