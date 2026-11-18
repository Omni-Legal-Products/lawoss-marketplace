# OZ 2027 — prechod · LAWOSS

Skill-only plugin pre slovenské otázky na prechod medzi Občianskym zákonníkom č. 40/1964 Zb. a zákonom č. 260/2026 Z. z. Pri konkrétnom skutku rozlišuje rozhodné právo podľa druhu otázky a dátumu; potom porovnáva iba príslušné overené ustanovenia. Podkladom je koordinačný spec 0021 (draft PR #145 v `lawOSS-like-SK-CZ`), ktorý je zatiaľ návrhom.

**Stav:** návrh na maintainer a právnu kontrolu. Plugin nie je v katalógu označený ako `AVAILABLE` a nemá záznam `inRepoSkills` v `releases.json`. Pridanie do katalógu a vydanie sú samostatný krok po schválení specu, kontrole skillu maintainerom, overení jeho slovenskej viditeľnosti v katalógu a funkčnom teste v LAWOSS.

Balík neobsahuje MCP server, runtime, prihlasovacie údaje ani zápisové nástroje. Pre úplnú prácu potrebuje dostupný oficiálny text zo Slov-Lexu: prednostne samostatne pripojený konektor, inak oficiálnu stránku `static.slov-lex.sk`. Ak text nie je dostupný, skill nesmie vydávať záver alebo citáciu za overenú. Znenie predpisov a novely treba skontrolovať pri každom použití; pred akýmkoľvek právnym výstupom rozhodujúce údaje a záver potvrdzuje advokát.

V návrhu prešli kontroly marketplace repozitára a izolovaná skúšobná inštalácia pluginu v Codexe. **Test automatického výberu skillu v LAWOSS, živého pripojenia zdroja a scenárové testy finálnej verzie zatiaľ neprebehli.** Pôvodná globálna inštalácia v produktovom draft PR #538 (`lawoss`) sa po presune distribúcie do marketplace nemá zlúčiť.
