# Prevádzka

Všetky príkazy sa spúšťajú na serveri ako
`sudo /opt/lawoss/bin/lawoss-selfhost …`. Nástroj nikdy nevypisuje
tajomstvá: iba názvy hostiteľov, riadky `PASS` a `FAIL` a cesty k súborom
0600. Pravidlá a zoznam „Nikdy nespúšťaj“ zo `SKILL.md` platia aj tu.
`lawoss-selfhost` bez argumentov vypíše všetky príkazy.
Ak `sudo` na serveri pýta heslo, spúšťa ich človek podľa odseku „Ak `sudo`
pýta heslo“ na začiatku `SKILL.md`.

## Kontrola

```sh
sudo /opt/lawoss/bin/lawoss-selfhost doctor
sudo docker compose -f /opt/lawoss/compose.yaml --env-file /opt/lawoss/.env ps
```

Logy kontajnerov (`docker compose logs`, `docker logs`) agent nečíta; ak ich
treba, číta ich človek vo vlastnom termináli.

`doctor` kontroluje DNS, TLS, metadáta prihlásenia a služieb, tvar zoznamu
povolených callbackov (riadok `PASS callbacks`), cestu hubu k auth, či obraz
hubu nesie `services.json` servera, a nástroje každej služby.
Prechod dokazuje technickú funkčnosť, nie úplnosť alebo aktuálnosť zdrojov.

## Kľúče poskytovateľov

Zadáva ich človek sám vo svojom vlastnom termináli (samostatné okno alebo SSH
spojenie, nie príkazové pole agenta ani predpona `!`); hodnota sa číta zo skrytého vstupu
a hub sa potom reštartuje. Agent hodnotu nikdy nevidí ani neposiela.

| Služba | Názov | Na čo |
|---|---|---|
| `fs` | `FS_API_KEY` | povinný kľúč Finančnej správy |
| `judikaty` | `USTAVNY_CLIENT_ID`, `USTAVNY_CLIENT_SECRET` | niektoré funkcie Ústavného súdu |
| `eurlex` | `EURLEX_WS_USERNAME`, `EURLEX_WS_PASSWORD`, `EURLEX_WS_DAILY_LIMIT` | webová služba EUR-Lex |
| `crz` | `MISTRAL_API_KEY`, `CRZ_MISTRAL_OCR`, `MISTRAL_OCR_MODEL` | OCR príloh |

```text
sudo /opt/lawoss/bin/lawoss-selfhost set-key FS_API_KEY
sudo /opt/lawoss/bin/lawoss-selfhost unset-key FS_API_KEY
```

## Účty

Každý účet je osobný. Agent pripraví príkaz a spustí ho po potvrdení.

```sh
sudo /opt/lawoss/bin/lawoss-selfhost list
sudo /opt/lawoss/bin/lawoss-selfhost invite jnovak slovlex,orsr
sudo /opt/lawoss/bin/lawoss-selfhost grant jnovak judikaty
sudo /opt/lawoss/bin/lawoss-selfhost revoke jnovak judikaty
sudo /opt/lawoss/bin/lawoss-selfhost disable jnovak
```

`invite` vypíše iba cestu `/opt/lawoss/handoff/<účet>.link`; súbor otvorí
človek sám a po aktivácii ho zmaže. Kým súbor existuje, novú pozvánku pre to
isté meno nástroj odmietne. `disable` zruší prístupy, tokeny, relácie aj
nepoužitú pozvánku; väzby účtu na služby a jeho údaje zostanú.

### Nové heslo alebo uniknutý aktivačný odkaz

Samoobslužná zmena hesla neexistuje. Ten istý účet sa obnoví novou pozvánkou;
nový účet netreba a údaje sa nestratia:

1. Agent po potvrdení zablokuje účet; prihlásenia, tokeny, relácie aj
   nepoužitá pozvánka prestanú okamžite platiť:

   ```sh
   sudo /opt/lawoss/bin/lawoss-selfhost disable jnovak
   ```

2. Človek vo vlastnom termináli zmaže starý súbor s odkazom, ak ešte existuje:

   ```text
   sudo rm -f /opt/lawoss/handoff/jnovak.link
   ```

3. Agent pošle novú pozvánku pre ten istý účet a jeho služby (`list` ich
   ukáže). Nástroj použije existujúce väzby účtu a nový odkaz platí 1 hodinu:

   ```sh
   sudo /opt/lawoss/bin/lawoss-selfhost invite jnovak slovlex,orsr
   ```

4. Človek otvorí nový súbor vo vlastnom termináli a odovzdá odkaz
   používateľovi. Ten si nastaví nové heslo (aspoň 15 znakov). Aktiváciou sa
   účet znova zapne a staré tokeny a relácie zostanú zrušené. Súbor potom
   človek zmaže.

## Služby

```sh
sudo /opt/lawoss/bin/lawoss-selfhost services add ruz
sudo /opt/lawoss/bin/lawoss-selfhost services remove ruz
```

`services add` vypíše názov hostiteľa, ktorý musí človek pridať do DNS,
a znova vytvorí všetky kontajnery. Prístupy používateľov k novej službe pridáš cez
`grant`.

Na serveri s existujúcou reverznou proxy vymenúva súbor presmerovania
presné názvy hostiteľov, preto ho treba pri každej zmene služieb upraviť. Pred
`services add` agent napíše upravený súbor s novou službou, človek potvrdí, že
jej názov nepoužíva iná aplikácia na proxy, a súbor nainštaluje; až potom
spusti `services add`, aby Caddy mohol hneď získať certifikát. Po
`services remove` agent napíše súbor bez odobratej služby a človek ho
nainštaluje. Ak sa nasadenie odstraňuje, človek odstráni z konfigurácie
existujúcej proxy aj súbor presmerovania; agent ho nemaže
(`existing-proxy.md`).

## Callbacky aplikácií

Callback je webová adresa, na ktorú sa aplikácia vráti po prihlásení. Auth
pri registrácii aplikácie prijme návrat na ten istý počítač (Claude Code) a iba
callbacky z tohto zoznamu. `init` doň predvolene zapíše callback aplikácií
Claude `claude.ai/api/mcp/auth_callback` (s `https://`), ktorý používajú
Claude desktop a claude.ai (krok 7 v `SKILL.md`).

```sh
sudo /opt/lawoss/bin/lawoss-selfhost callbacks list
sudo /opt/lawoss/bin/lawoss-selfhost callbacks add claude
sudo /opt/lawoss/bin/lawoss-selfhost callbacks remove <presná adresa z callbacks list>
```

`callbacks list` (aj samotné `callbacks`) iba vypíše povolené callbacky;
agent ho smie spustiť sám. `callbacks add claude` pridá callback aplikácií
Claude; `callbacks add <adresa>` pridá iný presný callback. Každý callback je
jedna presná adresa `https` bez zástupných znakov; zoznam má najviac 20
položiek po najviac 2048 znakov. `callbacks remove` berie presnú adresu tak,
ako ju vypíše `callbacks list` (skratka `claude` tu neplatí). Odobratie
odpojí aj konektory, ktoré sa s týmto callbackom už zaregistrovali: ich
ďalšie prihlásenie zlyhá, kým sa callback znova nepridá. Každú zmenu (`add`
aj `remove`) potvrdí človek; zmena reštartuje iba kontajner auth.

## Zálohy

Prvá záloha a kontrola (krok 14 v `SKILL.md`):

```sh
sudo /opt/lawoss/bin/lawoss-selfhost backup init-key
sudo /opt/lawoss/bin/lawoss-selfhost backup
sudo /opt/lawoss/bin/lawoss-selfhost restore --dry-run
```

`backup` vypíše priečinok `/opt/lawoss/backups/<čas>`. Záloha obsahuje
databázu auth, dáta hubu, `.env`, Caddyfile, značku a záznamy vydaní,
zašifrované verejným kľúčom. Certifikáty v nej nie sú.

Súkromný kľúč skopíruje človek na svoj počítač sám, vo svojom vlastnom
termináli (samostatné okno alebo SSH spojenie, nie príkazové pole agenta ani
predpona `!`). Agent ho nečíta, nekopíruje ani nepresúva. Kľúč sa nikdy
neodkladá do domovského priečinka SSH účtu na serveri, ktorý používa agent.

- Ak `sudo` na serveri nepýta heslo, človek na svojom počítači spustí:

  ```text
  ssh USER@SERVER "sudo cat /opt/lawoss/keys/backup-private.pem" > backup-private.pem
  ```

- Inak sa prihlási na server vo vlastnom termináli, spustí
  `sudo cat /opt/lawoss/keys/backup-private.pem` a zobrazený text vloží ako
  zabezpečenú poznámku do správcu hesiel.

Kópiu uloží na bezpečné miesto (napríklad do správcu hesiel). Zhodu overí
porovnaním odtlačkov (`sudo sha256sum /opt/lawoss/keys/backup-private.pem` na
serveri a `shasum -a 256 backup-private.pem` u seba) a až potom kľúč zo
servera zmaže:

```text
sudo rm /opt/lawoss/keys/backup-private.pem
```

Bez súkromného kľúča sa žiadna záloha nedá obnoviť. Po jeho odstránení zo
servera treba pri kontrole alebo obnove zadať `--private-key` s cestou, kam
ho človek dočasne vráti.

Plán záloh nastav až po schválení času. Napríklad denne o 2.30:

```sh
sudo tee /etc/cron.d/lawoss-backup > /dev/null <<'CRON'
30 2 * * * root /opt/lawoss/bin/lawoss-selfhost backup >> /var/log/lawoss-backup.log 2>&1
CRON
```

Nástroj staré zálohy nemaže a zálohy na tom istom serveri nechránia pred
jeho stratou. Odporuč človeku pravidelne kopírovať priečinky
z `/opt/lawoss/backups/` mimo servera (sú zašifrované) a rozhodnúť, kedy
staré mazať.

## Obnova

```sh
sudo /opt/lawoss/bin/lawoss-selfhost restore --dry-run --private-key <cesta ku kľúču> /opt/lawoss/backups/<čas>
sudo /opt/lawoss/bin/lawoss-selfhost restore --apply --record-sha256 <odtlačok záznamu vydania zálohy> --private-key <cesta ku kľúču> /opt/lawoss/backups/<čas>
```

`--apply` spusti iba po potvrdení. `--record-sha256` je odtlačok záznamu toho
vydania, z ktorého záloha pochádza, ako ho pripína katalóg:

| Vydanie zálohy | Commit | Odtlačok záznamu (`--record-sha256`) |
|---|---|---|
| 0.3.0 (pripnuté teraz) | `60ff58dfdd6a70f3534f9fe0ff05f3344563cca6` | `329d5bd454581e2bc16de0bd54d1003fbaf4516c5b251146a4429271881ea22d` |
| 0.2.0 (predchádzajúce) | `29440f8af25792e42b4c764f8334ec9be239439b` | `425865a7262019e6d77c7b847b9a42cdc8b0c4ae02b9358dd3ed39ccbc5f38b3` |

Záloha zo staršieho vydania potrebuje záznam a odtlačok toho
vydania; zverejnené vydania a odtlačky ich záznamov sú v README repozitára
`lawoss-selfhost` (časť „Published releases“). Obnova (aj `--dry-run`)
odmietne zálohu, ktorej `.env` má neplatný zoznam callbackov. Funguje aj na
novom serveri bez `.env`; nástroj tam musí byť
nainštalovaný (krok 6). Cesta ku kľúču musí byť absolútna. Súkromný kľúč na
server dočasne vráti človek a po obnove ho zmaže. Pri obnove na novom
serveri `init` nespúšťaj; `.env` vytvorí obnova.

## Aktualizácia

Nové vydanie prichádza iba s novým preskúmaným commitom katalógu LAWOSS, ktorý
pripne nový commit, záznam vydania a obrazy. Platia rovnaké brány:

1. Nový záznam vydania vezmi z aktualizovaného katalógu: súbor
   `release/<verzia>.json` v priečinku tohto skillu. Nový commit
   a odtlačok (`recordSha256`) sú v tabuľke „Pripnuté vydanie“ aktualizovaného
   `SKILL.md`. Inde ich nehľadaj.
2. Ukáž poznámku k vydaniu (pole `note` nového záznamu) a zmenu obrazov.
3. Počkaj na potvrdenie človeka.
4. Skopíruj záznam na server bez zmeny (ako `~/lawoss-<verzia>.json`),
   prepni repozitár na nový commit a over oboje ako v kroku 6:

   ```sh
   cd ~/lawoss-selfhost
   git fetch origin
   git checkout --detach <nový commit>
   git rev-parse HEAD
   sha256sum ~/lawoss-<verzia>.json
   ```

   `git rev-parse HEAD` musí vypísať presne nový pripnutý commit
   a `sha256sum` presne nový `recordSha256` z katalógu. Ak sa niečo líši,
   zastav sa a nič neinštaluj.
5. Nainštaluj súbory vydania:

   ```sh
   sudo sh deploy/install-host-files.sh ~/lawoss-<verzia>.json <nový odtlačok> .
   ```

6. Spusti aktualizáciu a potom kontrolu:

   ```sh
   sudo /opt/lawoss/bin/lawoss-selfhost update --to <verzia> --record ~/lawoss-<verzia>.json --record-sha256 <nový odtlačok>
   sudo /opt/lawoss/bin/lawoss-selfhost doctor
   ```

`update` si pred zmenou urobí snímku (`/opt/lawoss/snapshots/<čas>`), prepne
obrazy, spustí server a `doctor`. Ak zlyhá, vráti `.env`, Caddyfile aj súbory
vydania a spustí staré vydanie. Návrat po úspešnej aktualizácii, len po
potvrdení, jedným z dvoch spôsobov. `rollback` vráti súbory a obrazy
predchádzajúceho vydania; tajomstvá vymenené medzitým ostanú:

```sh
sudo /opt/lawoss/bin/lawoss-selfhost rollback
```

`restore-snapshot` vráti stav presne zo snímky vrátane dát (zmeny od snímky
sa stratia):

```sh
sudo /opt/lawoss/bin/lawoss-selfhost restore-snapshot /opt/lawoss/snapshots/<čas>
```

Snímky obsahujú `.env` nešifrovane; ich obsah nikdy nečítaj.

Po aktualizácii z vydania 0.2.0 je `callbacks list` prázdny, lebo 0.2.0
callbacky nezapisovalo; Claude desktop a claude.ai sa preto zatiaľ nepripoja.
Ak ich človek chce povoliť, po jeho potvrdení spusti `callbacks add claude`
(časť „Callbacky aplikácií“).

## Rotácia tajomstiev

```sh
sudo /opt/lawoss/bin/lawoss-selfhost rotate introspection
sudo /opt/lawoss/bin/lawoss-selfhost rotate cookies
sudo /opt/lawoss/bin/lawoss-selfhost rotate signing
```

Kedy ktorú použiť, je v tabuľke v časti „Nikdy nespúšťaj“ v `SKILL.md`.
`rotate cookies` spustený dvakrát odhlási všetkých; `rotate signing` ponechá
predchádzajúci kľúč, kým nevypršia ním podpísané tokeny (60 minút). Pri
podozrení na napadnutú službu: `rotate introspection` a nové kľúče
poskytovateľov.

## Prevádzková poznámka

Vzor pre `/opt/lawoss/PREVADZKA.md` (krok 15). Nepíš doň tajomstvá, heslá,
odkazy ani zoznam používateľov.

```sh
sudo tee /opt/lawoss/PREVADZKA.md > /dev/null <<'NOTE'
# Vlastný server LAWOSS: prevádzka

- Vydanie: lawoss-selfhost 0.3.0, commit 60ff58dfdd6a70f3534f9fe0ff05f3344563cca6
- Odtlačok záznamu vydania: 329d5bd454581e2bc16de0bd54d1003fbaf4516c5b251146a4429271881ea22d
- Základná doména: lawoss.example.com
- Služby: slovlex, orsr, judikaty
- Nasadené: <dátum>, správca: <meno alebo rola>
- Kontrola: sudo /opt/lawoss/bin/lawoss-selfhost doctor
- Callbacky aplikácií: <povolené konektory Claude áno/nie>; zmena iba po potvrdení cez callbacks
- Zálohy: denne o 2.30 do /opt/lawoss/backups (cron /etc/cron.d/lawoss-backup)
- Súkromný kľúč záloh: mimo servera, <opis miesta>
- Za existujúcou proxy (iba ak platí): porty <HTTP>/<HTTPS> na <HOST_ADDR>, súbor presmerovania: <kde ho človek uložil>; pri odstránení nasadenia ho odstrániť
- Aktualizácia: iba s novým commitom katalógu LAWOSS; poznámka, potvrdenie, install-host-files.sh, update, doctor
- Pri úniku tajomstva: zastaviť, rotate podľa skillu lawoss-selfhost, nové kľúče poskytovateľov
- Nikdy nečítať ani nevypisovať: .env, .env.previous, keys/, handoff/, snapshots/, backup-private.pem, logy kontajnerov
NOTE
```
