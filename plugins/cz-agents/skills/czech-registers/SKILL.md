---
name: czech-registers
description: Použi pri práci s českými registrami, kurzami ČNB, ARES, ADIS, ISIR a európskymi firemnými údajmi.
---

# České registre

Vyber príslušný MCP podľa úlohy; český balík aktivuj iba pri práci s českými údajmi.

ARES and ČNB work without keys; ADIS always uses live SOAP. ISIR exposes a verified event feed, while unverified corporate/person screening returns an explicit error. Sanctions require a populated SANCTIONS_DB with successful refresh records no older than seven days; responses identify loaded sources. DD risk conclusions and real-estate aggregates remain unavailable until their data coverage is independently verified. EU Registry requires CH_API_KEY for GB; Poland supports exact KRS identifiers, and DE/NL use GLEIF coverage. Missing coverage never means a clean negative finding.

## Inštalácia v LAWOSS

Pribalený lokálny runtime a CLI vyžadujú Node.js 22.14+ a npm. Prvý štart nainštaluje uzamknuté závislosti; ďalšie štarty použijú vyrovnávaciu pamäť. Podrobnosti a obmedzenia sú v README pluginu.
