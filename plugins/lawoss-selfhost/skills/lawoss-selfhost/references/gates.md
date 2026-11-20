# Brány: čo smie agent a čo potvrdí človek

Prehľad 15 krokov zo `SKILL.md`. Potvrdenie je výslovné áno človeka
v konverzácii k danému kroku; neplatí pre ďalšie kroky ani pre neskoršie
zmeny.

| # | Krok | Agent smie sám | Potvrdí alebo urobí človek |
|---|---|---|---|
| 1 | Čo sa nainštaluje, čo to stojí a čo nerobí | vysvetliť | súhlas s pokračovaním |
| 2 | Server, doména, služby a značka | navrhnúť predvolené voľby | vybrať; vlastní server aj doménu |
| 3 | Pripojenie na server | iba čítať stav (systém, Docker, voľné porty, disk, pamäť) | prístup cez SSH; každá inštalácia balíkov (Docker, `git`, `gh`) |
| 4 | Firewall | ukázať plánované pravidlá | otvorenie portov 80 a 443; firewall poskytovateľa |
| 5 | DNS | vypísať presné záznamy | záznamy vytvorí sám |
| 6 | Stiahnutie pripnutého vydania | stiahnuť, overiť commit, odtlačok záznamu a obrazy, ukázať poznámku | nič (prihlásenie `sudo gh auth login` iba vo vlastnom termináli, ak chce atestácie) |
| 7 | Generovanie tajomstiev | spustiť `init`; `.env` nečítať ani nevypisovať | nič navyše (e-mail a podmienky z kroku 9 už predtým) |
| 8 | Značka | pripraviť balík, `brand check`, náhľad | schváliť náhľad; potvrdiť právo použiť logo |
| 9 | Certifikáty | vysvetliť podmienky autority a pole e-mailu | prijať podmienky, zadať e-mail (pred krokom 7) |
| 10 | Spustenie | `docker compose … up -d`, potom `doctor` | nič; kľúče poskytovateľov zadá sám cez `set-key` |
| 11 | Prvý účet | `invite` do súboru 0600; povedať iba cestu | otvoriť súbor sám, aktivovať účet, zvoliť heslo |
| 12 | Pripojenie aplikácie | dať adresy služieb; povedať, že 0.2.0 pripojí iba aplikácie s návratom na loopback (napríklad Claude Code), nie konektor Claude desktop ani claude.ai | prihlásiť sa a udeliť súhlas v aplikácii; potvrdiť, že vidí nástroje |
| 13 | Overenie | znova `doctor`; porovnať skutočné dotazy s lokálnym pluginom | potvrdiť, že výsledky vyzerajú správne |
| 14 | Zálohy | kľúč záloh, prvá záloha, kontrola, plán po schválení | skopírovať súkromný kľúč mimo servera; schváliť plán |
| 15 | Odovzdanie | zapísať prevádzkovú poznámku bez tajomstiev | nič |

## Server s existujúcou reverznou proxy

Ak porty 80 a 443 už drží Traefik (Dokploy, Coolify alebo vlastný), platí
postup v `existing-proxy.md`. Brány sa v týchto krokoch líšia:

| # | Agent smie sám | Potvrdí alebo urobí človek |
|---|---|---|
| 2 | po pripojení prečítať dostupnú pamäť (`free -h`) a povedať, že hub môže použiť až 6 GB | zoznam služieb podľa dostupnej pamäte |
| 3 | iba čítať, kto drží porty 80 a 443, adresu servera pre proxy (`docker inspect` len s `--format` na siete) a voľné porty | dva porty, adresu `--proxy-bind` a to, že názvy nasadenia nepoužíva iná aplikácia na proxy |
| 4 | nič; firewall sa nemení, žiadny príkaz `ufw` | nič |
| 5 | vypísať rovnaké záznamy na verejnú IP adresu existujúcej proxy | záznamy vytvorí sám |
| 7 | `init` navyše s `--http-port`, `--https-port`, `--proxy-bind` | nič navyše |
| 10 | napísať a ukázať súbor presmerovania pre Traefik s presnými názvami hostiteľov (hneď po kroku 3); overiť trasu na porte 80 a spustiť až keď nevracia `404` | nainštalovať súbor presmerovania a potvrdiť to v konverzácii samostatne |
| 13 | pri zlyhaní TLS alebo HTTP najprv nechať skontrolovať súbor presmerovania; ak trasa funguje, po potvrdení reštartovať iba kontajner proxy LAWOSS | skontrolovať súbor presmerovania; prečítať chyby certifikátov vo vlastnom termináli |
| 15 | zapísať do poznámky porty, adresu a miesto súboru presmerovania | pri odstránení nasadenia odstrániť aj súbor presmerovania |

Konfiguráciu existujúcej proxy agent nikdy nemení, nepresúva ani nemaže,
Traefik, Dokploy ani Coolify nereštartuje a ich úložisko certifikátov
(`acme.json`) nečíta.

## Poradie, ktoré určuje nástroj

- `init` vyžaduje `--acme-email` a `.env` nikdy neprepíše. Doména, služby,
  e-mail a súhlas s podmienkami certifikačnej autority (krok 9) preto musia
  byť potvrdené pred krokom 7.
- `brand set` reštartuje kontajner auth. Ak sa spustí pred krokom 10, auth sa
  tým spustí skôr; je to v poriadku.
- `set-key` reštartuje hub; zmysel má po kroku 10.
- `brand preview`, `set-key` a `gh auth login` čakajú na terminál človeka
  (náhľad beží do Ctrl-C, ostatné čítajú skrytý vstup).

## Neskoršie zmeny

Rovnaké brány platia aj po odovzdaní:

| Zmena | Agent smie sám | Potvrdí človek |
|---|---|---|
| aktualizácia | ukázať poznámku k vydaniu a zmenu obrazov | áno pred `install-host-files.sh` aj `update` |
| návrat na predchádzajúce vydanie | vysvetliť, čo `rollback` vráti | áno pred `rollback` |
| pridanie alebo odobratie služby | vypísať nový záznam DNS; za existujúcou proxy aj upravený súbor presmerovania | áno pred `services add` alebo `services remove`; DNS vytvorí sám; za existujúcou proxy nainštaluje upravený súbor (pred `services add`) |
| nový účet, prístup, zablokovanie | pripraviť príkaz | áno pred `invite`, `grant`, `revoke`, `disable` |
| rotácia tajomstiev | navrhnúť správnu rotáciu | áno pred `rotate` (cookies odhlási všetkých) |
| obnova zo zálohy | `restore --dry-run` | áno pred `restore --apply` a `restore-snapshot`; súkromný kľúč dodá sám |
