---
name: disq-diskvalifikacie
description: >-
  Použi pri mennom vyhľadávaní v slovenskom verejnom Registri diskvalifikácií
  alebo pri načítaní detailu vybraného DISQ záznamu. English triggers include
  Slovak disqualification register name search and record detail.
---

# DISQ — verejný register diskvalifikácií

Použi presne dvojkrokový postup:

1. Zavolaj `disq_check` s menom. Voliteľné `dob` a `ico` sú iba vstupné pomôcky; dátum narodenia a IČO nie sú vo verejnom zdroji searchable, neposielajú sa upstream a výsledok ich označí len ako provided/ignored.
2. Pri relevantnom kandidátovi zavolaj `disq_get_detail` s nepriehľadným `registreGuid` z výsledku.

`disq_check` vracia `matches`, `no_match` alebo `incomplete`. `no_match` interpretuj iba ako úplný, validovaný nulový výsledok so `sourceValidated: true`; nie ako dôkaz totožnosti, bezúhonnosti ani spôsobilosti. Neúplný alebo orezaný zdroj je vždy `incomplete`.

Zhoda mena nie je identifikácia osoby. Menovcov odlíš nezávislými autoritatívnymi podkladmi. Všímaj si `updateDate`, `retrievedAt`, `warnings`, chýbajúce polia a Source freshness. Verejný zdroj môže byť nedostupný, neúplný alebo zmenený.

Úspešné výsledky obsahujú len dokumentované verejné polia: meno, súd, adresa, dátumy, spisové údaje a GUID potrebný pre dvojkrokový tok. Chyby majú stabilné kódy `DISQ_INPUT`, `DISQ_HTTP`, `DISQ_TIMEOUT`, `DISQ_CONTENT_TYPE` alebo `DISQ_SCHEMA`.

Výstup vždy formuluj opatrne: ide o technický výpis z verejného zdroja, nie je právnym poradenstvom. Pri právnom alebo obchodnom úkone over originálny záznam a identitu osoby.
