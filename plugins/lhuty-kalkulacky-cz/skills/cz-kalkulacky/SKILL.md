---
name: cz-kalkulacky
description: Výpočet českých soudních poplatků, mimosmluvní odměny a náhrad advokáta podle advokátního tarifu a zákonného úroku z prodlení. Sazby se vždy načítají z aktuálního znění předpisu v e-Sbírce, nikdy z paměti. Použij při návrhu petitu, nákladů řízení nebo vyúčtování. Výsledek je návrh k ověření advokátem. Plugin obsahuje jen skill, bez MCP.
---

Tento plugin nepřipojuje MCP, neobsahuje runtime ani přihlašovací údaje.

# Právní kalkulačky ČR

## Zásady

1. **Sazby nikdy z paměti.** Před každým výpočtem načti platné znění
   ustanovení skillem `cz-predpisy-esbirka` ke dni, který je pro výpočet
   rozhodný (den podání návrhu, den úkonu, první den pololetí prodlení).
   Sazebníky se mění novelami.
2. **Počítej kódem**, ne odhadem. Mezivýsledky a použité sazby vypiš, aby
   výpočet šel zkontrolovat.
3. Ke každé částce uveď ustanovení, ze kterého vychází, a datum znění.
4. Výstup označ jako návrh k ověření advokátem. Osvobození od poplatku,
   snížení odměny a zvláštní sazby posuzuje člověk.

## Soudní poplatky (zák. č. 549/1991 Sb.)

1. Základ poplatku urči podle § 6. Příslušenství se do základu nepočítá,
   pokud není samostatným předmětem řízení.
2. Položku sazebníku najdi v příloze zákona. V e-Sbírce mají fragmenty ELI
   `/prilohy/priloha_0/pol_{číslo}`, například položka 1 (peněžité plnění)
   nebo položka 2 (elektronický platební rozkaz).
3. Vznik poplatkové povinnosti a splatnost načti z § 4 a § 7, osvobození
   z § 11, zaokrouhlení z textu zákona. Neodhaduj je.
4. Uveď variantu pro běžný návrh i pro elektronický platební rozkaz, pokud
   připadá v úvahu.

## Advokátní tarif (vyhl. č. 177/1996 Sb.)

1. **Tarifní hodnota:** § 8 (peněžité plnění bez příslušenství, opětující se
   plnění a zvláštní případy) a § 9 (náhradní tarifní hodnoty).
2. **Sazba za úkon:** § 7. U bagatelních sporů podle § 14b zkontroluj, zda
   jsou splněny všechny podmínky odst. 1. Pak se úkony do podání návrhu
   včetně počítají podle § 14b a celková odměna je omezena tarifní hodnotou.
3. **Počet úkonů:** § 11 (celé a poloviční úkony). Seznam úkonů sestav z
   obsahu spisu a nech ho potvrdit člověkem.
4. **Paušální náhrada hotových výdajů:** § 13 odst. 4 (u § 14b jeho
   odst. 6).
5. **DPH:** připočti jen tehdy, je-li advokát plátcem. Sazbu ověř.

## Úrok z prodlení (nař. vl. č. 351/2013 Sb.)

1. Podle § 2 odst. 1 je roční výše úroku repo sazba ČNB platná **první den
   kalendářního pololetí, v němž došlo k prodlení**, zvýšená o 8 procentních
   bodů. Sazba se po celou dobu prodlení nemění.
2. Repo sazbu zjisti z veřejných údajů ČNB nebo nástrojem pluginu
   `cz-agents`. Uveď zdroj a datum, ke kterému sazba platí.
3. Výživné pro nezletilé dítě má zvláštní režim (§ 2 odst. 2). Ověř jeho
   aktuální znění.
4. Úrok počítej za dny prodlení od prvního dne po splatnosti. Použitý počet
   dní v roce uveď ve výstupu výslovně, aby šel výpočet zkontrolovat.

Ustanovení § 4, § 6, § 7 a § 11 a příloha zák. č. 549/1991 Sb., § 7, § 8,
§ 9, § 11, § 13 a § 14b vyhl.
č. 177/1996 Sb. a § 2 nař. vl. č. 351/2013 Sb. byla načtena z e-Sbírky
22. 10. 2026. Sazby z nich v tomto skillu záměrně nejsou, aby nezastaraly.
