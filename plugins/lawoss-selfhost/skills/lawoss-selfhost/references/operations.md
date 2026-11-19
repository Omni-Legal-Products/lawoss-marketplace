# Prevádzka

Všetky príkazy sa spúšťajú na serveri ako
`sudo /opt/lawoss/bin/lawoss-selfhost …`. Nástroj nikdy nevypisuje
tajomstvá: iba názvy hostiteľov, riadky `PASS` a `FAIL` a cesty k súborom
0600. Pravidlá a zoznam „Nikdy nespúšťaj“ zo `SKILL.md` platia aj tu.
`lawoss-selfhost` bez argumentov vypíše všetky príkazy.

## Kontrola

```sh
sudo /opt/lawoss/bin/lawoss-selfhost doctor
sudo docker compose -f /opt/lawoss/compose.yaml --env-file /opt/lawoss/.env ps
```

`doctor` kontroluje DNS, TLS, metadáta prihlásenia a služieb, cestu hubu
k auth, či obraz hubu nesie `services.json` servera, a nástroje každej služby.
Prechod dokazuje technickú funkčnosť, nie úplnosť alebo aktuálnosť zdrojov.

## Kľúče poskytovateľov

Zadáva ich človek sám vo svojom termináli; hodnota sa číta zo skrytého vstupu
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
nepoužitú pozvánku.

## Služby

```sh
sudo /opt/lawoss/bin/lawoss-selfhost services add ruz
sudo /opt/lawoss/bin/lawoss-selfhost services remove ruz
```

`services add` vypíše názov hostiteľa, ktorý musí človek pridať do DNS,
a znova vytvorí všetky kontajnery. Prístupy používateľov k novej službe pridáš cez
`grant`.

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

Súkromný kľúč skopíruje človek mimo servera sám, vo svojom termináli; agent
ho nečíta ani nekopíruje. Napríklad na serveri:

```text
sudo install -m 600 -o "$USER" /opt/lawoss/keys/backup-private.pem ~/backup-private.pem
```

na svojom počítači `scp USER@SERVER:backup-private.pem .`, uloží ho na
bezpečné miesto (napríklad do správcu hesiel) a potom na serveri zmaže obe
kópie:

```text
rm ~/backup-private.pem
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
sudo /opt/lawoss/bin/lawoss-selfhost restore --apply --record-sha256 6f96cd390968ecfee44c34057b5d61705391ffa91953791cb463d286edfcedde --private-key <cesta ku kľúču> /opt/lawoss/backups/<čas>
```

`--apply` spusti iba po potvrdení. `--record-sha256` je odtlačok záznamu toho
vydania, z ktorého záloha pochádza, ako ho pripína katalóg (pre 0.1.0 hodnota
vyššie). Funguje aj na novom serveri bez `.env`; nástroj tam musí byť
nainštalovaný (krok 6). Cesta ku kľúču musí byť absolútna. Súkromný kľúč na
server dočasne vráti človek a po obnove ho zmaže. Pri obnove na novom
serveri `init` nespúšťaj; `.env` vytvorí obnova.

## Aktualizácia

Nové vydanie prichádza iba s novým preskúmaným commitom katalógu LAWOSS, ktorý
pripne nový commit, záznam vydania a obrazy. Platia rovnaké brány:

1. Ukáž poznámku k vydaniu (pole `note` nového záznamu) a zmenu obrazov.
2. Počkaj na potvrdenie človeka.
3. Prepni repozitár na nový commit, over ho a nainštaluj súbory vydania:

   ```sh
   cd ~/lawoss-selfhost
   git fetch origin
   git checkout --detach <nový commit>
   git rev-parse HEAD
   sha256sum ~/lawoss-<verzia>.json
   sudo sh deploy/install-host-files.sh ~/lawoss-<verzia>.json <nový odtlačok> .
   ```

4. Spusti aktualizáciu a potom kontrolu:

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

- Vydanie: lawoss-selfhost 0.1.0, commit d041ee6fb116a65dde7201fb4c7d15bbb0b51256
- Odtlačok záznamu vydania: 6f96cd390968ecfee44c34057b5d61705391ffa91953791cb463d286edfcedde
- Základná doména: lawoss.example.com
- Služby: slovlex, orsr, judikaty
- Nasadené: <dátum>, správca: <meno alebo rola>
- Kontrola: sudo /opt/lawoss/bin/lawoss-selfhost doctor
- Zálohy: denne o 2.30 do /opt/lawoss/backups (cron /etc/cron.d/lawoss-backup)
- Súkromný kľúč záloh: mimo servera, <opis miesta>
- Aktualizácia: iba s novým commitom katalógu LAWOSS; poznámka, potvrdenie, install-host-files.sh, update, doctor
- Pri úniku tajomstva: zastaviť, rotate podľa skillu lawoss-selfhost, nové kľúče poskytovateľov
- Nikdy nečítať ani nevypisovať: .env, .env.previous, keys/, handoff/, snapshots/
NOTE
```
