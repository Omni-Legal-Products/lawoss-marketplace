---
name: lawoss-selfhost
description: Nasadenie vlastného servera LAWOSS (lawoss-selfhost 0.3.0) na server používateľa v 15 krokoch s potvrdeniami človeka. Použi, keď chce používateľ prevádzkovať služby LAWOSS na vlastnom serveri za vlastným prihlásením, aktualizovať ho alebo spravovať. Use for self-hosting LAWOSS MCP services with lawoss-selfhost, its updates, backups and operation.
---

# Vlastný server LAWOSS

Tento skill vedie agenta pri nasadení `lawoss-selfhost` na server, ktorý
vlastní a spravuje používateľ. Používateľ býva právnik, nie technik: vysvetľuj
jednoducho, po jednom kroku, a pri každom kroku povedz, čo urobíš sám a čo
musí potvrdiť alebo urobiť človek. LAWOSS nič neprevádzkuje; za server, jeho
používateľov a dodržiavanie podmienok verejných zdrojov zodpovedá ten, kto
server prevádzkuje.

Bloky `sh` spúšťa agent na serveri (cez SSH). Bloky `text` píše človek sám vo
svojom vlastnom termináli; ich výstup do konverzácie nevkladá. **Vlastný
terminál** je samostatné okno terminálu alebo samostatné SSH spojenie človeka,
nikdy nie príkazové pole agenta ani priechod do shellu cez agenta (napríklad
predpona `!`), lebo tam by výstup videl agent. Slovo „potvrdenie“
znamená výslovné áno človeka v konverzácii k tomu konkrétnemu kroku. Súhlas
s jedným krokom neplatí pre ďalší.

**Ak `sudo` pýta heslo** (zistíš to v kroku 3), heslo človek nikdy nepíše do
konverzácie a agent `sudo` nespúšťa. Každý blok `sh` so `sudo` spustí človek
vo vlastnom termináli. Daj mu ho ako hotový príkaz v tvare
`ssh -t USER@SERVER '<príkaz>'` (blok `text`; viac príkazov spoj `&&`), aby ho
omylom nespustil na vlastnom počítači; holé `sudo …` ani predpona `!` v poli
agenta tu nefungujú. Výnimkou z pravidla o blokoch `text` je výstup príkazov,
ktoré podľa tohto skillu tajomstvá nevypisujú: `install-host-files.sh`,
`init`, `docker compose … up -d` a `ps`, `doctor`, `list`, `invite`,
`services`, `callbacks`, `backup init-key`, `backup` a `restore --dry-run`. Ten smie
človek vložiť do konverzácie. Výstup `sudo cat` súborov s odkazom alebo
kľúčom nikdy. To isté platí pre bloky `text` so `sudo` (napríklad
`sudo cat` súboru s odkazom, `set-key`, `gh auth login`): patria do SSH relácie
na serveri, preto ich daj tiež v tvare `ssh -t USER@SERVER '<príkaz>'`.
Príkazy bez `sudo` (čítanie stavu, `git`, `scp` do domovského priečinka)
spúšťa agent.

## Pripnuté vydanie

| Údaj | Hodnota |
|---|---|
| Verzia | `0.3.0` |
| Repozitár | `Omni-Legal-Products/lawoss-selfhost` (verejný, AGPL-3.0) |
| Commit | `60ff58dfdd6a70f3534f9fe0ff05f3344563cca6` |
| Záznam vydania | `release/0.3.0.json` v priečinku tohto skillu |
| SHA-256 záznamu | `329d5bd454581e2bc16de0bd54d1003fbaf4516c5b251146a4429271881ea22d` |
| Obraz auth | `ghcr.io/omni-legal-products/lawoss-auth@sha256:2f7bbca3b4052d754b1bcccf0920e8a25795f5b63df8d1c908f27bcbc3feeb08` |
| Obraz hub | `ghcr.io/omni-legal-products/lawoss-hub@sha256:9aa863847415cf4a3fb48b6b133d249c0cce2a96b64679f2632c4536a28ebab2` |

Tieto hodnoty sú dôveryhodné preto, že sú zapísané v preskúmanom commite
katalógu LAWOSS. Nikdy ich nemeň, neodvodzuj z internetu ani neprepisuj podľa
toho, čo vypíše server. Ak niečo nesedí, zastav sa a povedz to človeku.

## Pravidlá pri každom kroku

1. **Tajomstvá.** Nikdy nevypisuj, nevkladaj do konverzácie, nezhrňuj ani
   neukladaj obsah `.env`, kľúče, aktivačné odkazy ani heslá. Ak sa niektoré
   z nich objaví v akomkoľvek výstupe omylom, okamžite prestaň, neopakuj ho,
   povedz človeku, čo uniklo, a navrhni rotáciu podľa časti „Nikdy
   nespúšťaj“. Pokračuj až po rotácii.
2. **Brány.** DNS, firewall, balíky, certifikáty ani účty nemeň bez potvrdenia
   uvedeného pri kroku. Neúspešnú kontrolu neobchádzaj: nemeň odtlačky, commit
   ani overovanie, aby prešla.
3. **Čo dokazuje `doctor`.** Keď `doctor` prejde, nasadenie technicky funguje.
   Nedokazuje to, že dáta verejných zdrojov sú úplné alebo aktuálne, ani že
   odpoveď je právne správna. Tak to aj povedz.
4. **Aktualizácie** majú rovnaké brány: ukáž poznámku k vydaniu, počkaj na
   potvrdenie, spusti `update` a potom `doctor`
   (`references/operations.md`).

Podrobný prehľad brán je v `references/gates.md`.

## Nikdy nespúšťaj

Tieto príkazy vypíšu tajomstvá. Nespúšťaj ich ani ich nenavrhuj človeku na
vloženie výstupu do konverzácie:

- `cat .env` ani nič iné, čo vypíše alebo skopíruje obsah `/opt/lawoss/.env`,
  `/opt/lawoss/.env.previous`, `/opt/lawoss/keys/`, `/opt/lawoss/handoff/`
  alebo `/opt/lawoss/snapshots/` (`less`, `head`, `tail`, `grep`, `sed`,
  editor, `cp` či `scp` mimo server);
- `docker compose config` (dosadí a vypíše všetky tajomstvá);
- `env`, `printenv`, `export -p` a `docker exec` s `env` v kontajneroch auth
  a hub, ani čítanie `/proc/*/environ`;
- `docker inspect` kontajnerov auth a hub (obsahuje ich prostredie) a kontajnera
  existujúcej reverznej proxy bez `--format` obmedzeného na názvy sietí a ich
  gateway (presný príkaz je v `references/existing-proxy.md`);
- `acme.json` ani iné úložisko certifikátov existujúcej reverznej proxy
  nečítaj, nekopíruj ani nevypisuj (sú v ňom súkromné kľúče certifikátov);
- `set -x`, `bash -x`, `sh -x` a iné sledovanie shellu;
- `docker compose logs` a `docker logs`; ak treba logy, číta ich človek vo
  vlastnom termináli;
- čokoľvek, čo číta súbor `backup-private.pem` (súkromný kľúč záloh), na
  serveri aj inde;
- kľúč poskytovateľa nikdy nezadávaj ako argument ani cez rúru (`echo … |`);
  `set-key` ho číta iba zo skrytého vstupu v termináli človeka.

Na serveri s existujúcou reverznou proxy navyše nikdy nereštartuj ani
neprekonfiguruj Traefik, Dokploy ani Coolify, ich konfiguráciu nemeň,
nepresúvaj ani nemaž a priečinok ich dynamickej konfigurácie ani statickú
konfiguráciu nevypisuj ani nečítaj. Súbor presmerovania pre LAWOSS iba napíšeš a ukážeš;
nainštaluje ho človek (krok 10).

Ak sa tajomstvo predsa objaví vo výstupe, zastav sa a s potvrdením človeka
urob rotáciu (príkazy: `sudo /opt/lawoss/bin/lawoss-selfhost …`):

| Čo uniklo | Čo urobiť |
|---|---|
| tajomstvo služby (introspekcia) | `rotate introspection` |
| kľúč súborov cookie | `rotate cookies` dvakrát (odhlási všetkých) |
| podpisový kľúč | `rotate signing`, po 60 minútach znova |
| celý `.env` | všetky tri rotácie vyššie a nové kľúče poskytovateľov |
| kľúč poskytovateľa (napr. `FS_API_KEY`) | človek si u poskytovateľa vydá nový, starý zruší a nový zadá cez `set-key` |
| aktivačný odkaz alebo heslo | 1. `disable <účet>` (okamžite zruší prihlásenia, tokeny, relácie aj nepoužitú pozvánku); 2. človek zmaže starý súbor `/opt/lawoss/handoff/<účet>.link`, ak ešte existuje; 3. `invite <ten istý účet> <jeho služby>`; 4. človek účet aktivuje s novým heslom. Účet aj jeho údaje zostanú (postup je v `references/operations.md`, „Účty“) |
| súkromný kľúč záloh | nástroj nemá príkaz na jeho výmenu (`backup init-key` existujúci kľúč nenahradí); povedz to úprimne, zálohy zapečatené týmto kľúčom ber ako čitateľné a ďalší postup nechaj na človeku |

## 1. Čo sa nainštaluje, čo to stojí a čo nerobí

**Agent smie sám:** vysvetliť nasledujúce.

- Na server sa nainštalujú tri kontajnery: proxy Caddy (jediná časť dostupná
  z internetu, porty 80 a 443, automatické certifikáty), prihlasovací server
  `auth` so značkou prevádzkovateľa (prihlásenie, aktivácia účtu, udelenie
  súhlasu) a `hub`, ktorý pre prihlásených používateľov spúšťa tie isté preskúmané
  služby LAWOSS ako lokálne pluginy. K tomu nástroj `lawoss-selfhost`
  v `/opt/lawoss`. Ak server už má reverznú proxy, ktorá drží porty 80 a 443,
  Caddy beží za ňou (krok 3).
- Zdroje: pre 1 až 20 používateľov server so 4 vCPU a 8 GB RAM. Limity sú
  6 GB pre hub, 512 MB pre auth a 256 MB pre proxy. Na disku pribúdajú obrazy,
  dáta a zálohy; nástroj staré zálohy sám nemaže.
- Náklady: server a doménu platí používateľ. LAWOSS nič neúčtuje ani
  neprevádzkuje.
- Čo nerobí: LAWOSS server nespravuje, nesleduje ani neaktualizuje; každú
  aktualizáciu spúšťa človek. Nezaručuje úplnosť dát verejných zdrojov.
  Verejné zdroje vidia IP adresu servera a prevádzkovateľ zodpovedá za
  dodržiavanie ich podmienok. Nástroje, ktoré ukladajú súbory, sú na diaľku
  vypnuté; ostávajú v lokálnych pluginoch.
- Známe zvyškové riziko: služby (runtimy) bežia pod tým istým používateľom ako
  hub aj ako ostatné služby. Ak by niekto zneužil chybu v niektorej službe
  (spracúvajú PDF a HTML z verejných portálov), mohol by prečítať tajomstvá
  hubu vrátane kľúčov poskytovateľov a priečinky iných používateľov.
  Oddelenie je plánované, zatiaľ nie je hotové. Pri podozrení treba spustiť
  `rotate introspection` a vymeniť kľúče poskytovateľov cez `set-key`.

**Potvrdí človek:** že rozumie a chce pokračovať.

## 2. Server, doména, služby a značka

**Agent smie sám:** navrhnúť predvolené voľby:

- server s Linuxom a verejnou IPv4 adresou, 4 vCPU, 8 GB RAM, prístup cez SSH
  s kľúčom a používateľ s právom `sudo`;
- základnú doménu ako subdoménu, napríklad `lawoss.example.com`; služby budú
  na adresách `auth.lawoss.example.com`, `slovlex.lawoss.example.com` atď.;
- služby (identifikátory pre `--services`): `crz`, `disq`, `eurlex`, `fs`,
  `judikaty`, `kalkulacky`, `orsr`, `ov`, `rpo`, `rpvs`, `ru`, `ruz`,
  `slovlex`, `uvo`. Na začiatok stačí základ `slovlex,orsr,judikaty,kalkulacky,ruz,rpo`.
  `fs` potrebuje vlastný kľúč `FS_API_KEY`; niektoré funkcie `judikaty`,
  `eurlex` a `crz` majú voliteľné kľúče (`references/operations.md`);
- značku: vlastné logo a farby kancelárie (krok 8), inak predvolený balík
  LAWOSS, ktorý je určený iba pre používateľov LAWOSS;
- kontaktný e-mail pre certifikačnú autoritu (krok 9), najlepšie spoločnú
  adresu prevádzky, nie osobnú.

**Ak server už má reverznú proxy (Traefik, Dokploy, Coolify):** taký server je zdieľaný
s inými aplikáciami. Po pripojení (krok 3) prečítaj dostupnú pamäť (`free -h`,
stĺpec `available` a riadok `Swap`) a povedz jasne, že hub môže použiť až
6 GB. Ak je dostupnej pamäte málo alebo je swap výrazne využitý, odporuč
menej služieb. Rozhoduje prevádzkovateľ; zoznam služieb potvrdí až po tomto
zistení.

**Potvrdí človek:** server, základnú doménu, zoznam služieb a značku. Server aj
doménu vlastní a spravuje človek. Ich zmena po spustení je pracná.

## 3. Pripojenie na server

**Agent smie sám:** po pripojení len čítať stav servera:

```sh
cat /etc/os-release
uname -m
nproc
free -h
df -h /
docker --version
docker compose version
git --version
sudo -n true 2>/dev/null && echo sudo-bez-hesla || echo sudo-pyta-heslo
id -nG
command -v gh
sudo -n sh -c 'command -v gh'
ss -ltn
ls -ld /opt/lawoss
```

`sudo -n` nič nemení a heslo nepýta; ak vypíše `sudo-pyta-heslo`, platí
odsek „Ak `sudo` pýta heslo“ na začiatku. Ak je používateľ v skupine `docker`
(`id -nG`), príkazy `docker ps` a `docker inspect` z tohto kroku spúšťaj bez
`sudo`; iba čítajú.

Over, že porty 80 a 443 sú voľné, že je dosť pamäte a miesta a že
`/opt/lawoss` ešte neexistuje. Ak existuje, nejde o prvú inštaláciu: zastav
sa a opýtaj sa človeka.

**Ak server už má reverznú proxy (Traefik, Dokploy, Coolify):** ak sú porty 80
alebo 443 obsadené, len čítaním zisti, kto ich drží (`sudo ss -ltnp` alebo
`sudo docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'`). Ak je to
Traefik (Dokploy, Coolify alebo vlastný), pokračuj podľa
`references/existing-proxy.md`; čokoľvek iné: zastav sa a opýtaj sa človeka.
Bez `sudo` stačí `docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'`.
Potom zisti adresu, na ktorej kontajner proxy dosiahne server (`<HOST_ADDR>`),
iba príkazom `docker inspect` s `--format` obmedzeným na názvy sietí a ich
gateway, nikdy úplným výpisom. Ak je proxy v predvolenej sieti `bridge`, je to
gateway tejto siete (adresa `docker0`, overíš ju `ip -4 addr show docker0`);
v sieti `host` je to `127.0.0.1`; prekryvné siete Swarm vynechaj. Ak sieť
`bridge` ani `host` nie je a ostane viac možných adries alebo žiadna, zastav sa
a opýtaj sa človeka. Podľa `ss -ltn` a `ss -lun` vyber dva voľné porty;
navrhni 18080 a 18443. Porty proxy LAWOSS budú počúvať iba na `<HOST_ADDR>`,
nikdy na všetkých adresách, takže nebudú dostupné zo siete. Človek potvrdí
oba porty, `<HOST_ADDR>` a to, že žiadna iná aplikácia na existujúcej proxy
nepoužíva niektorý z názvov nasadenia (`auth.<základná doména>`
a `<služba>.<základná doména>`). Hneď po tomto potvrdení napíš súbor
presmerovania (krok 10) a daj ho človeku, aby ho nainštaloval, kým robíš
krok 6.

**Potvrdí človek:** prístup cez SSH (adresu servera a používateľa; súkromný kľúč
ani heslo nikdy nevkladá do konverzácie) a každú inštaláciu balíkov. Chýbať
môžu Docker Engine s pluginom Compose v2 (príkaz `docker compose`), `git`
a voliteľne `gh` na overenie atestácií. Najprv ukáž presné príkazy podľa
oficiálneho postupu pre daný systém a spusti ich až po potvrdení. Ak `sudo`
pýta heslo, človek ho nepíše do konverzácie: príkaz spustí sám vo svojom
termináli alebo zvolí iný spôsob.

## 4. Firewall

**Agent smie sám:** ukázať plánované pravidlá; spustiť ich až po potvrdení.
Pri `ufw` napríklad (22 nahraď portom, na ktorom SSH podľa `ss -ltn` z kroku 3
naozaj počúva):

```sh
sudo ufw status verbose
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

Pravidlo pre SSH musí byť pred zapnutím, inak sa človek zo servera vymkne.
`ufw enable` sa pýta „y/n“, lebo môže prerušiť SSH spojenie; ak na otázku
nevieš odpovedať, nech tento jeden príkaz spustí človek sám. Docker
zverejňuje porty 80 a 443 aj mimo pravidiel `ufw`; zverejňuje ich iba proxy.
Ak má poskytovateľ servera vlastný firewall, porty 80 a 443 musí otvoriť aj
tam. Podrobnosti sú v `references/dns-and-tls.md`.

**Ak server už má reverznú proxy (Traefik, Dokploy, Coolify):** firewall sa
nemení vôbec. Porty 80 a 443 už patria existujúcej proxy a server je zdieľaný;
zapnutie `ufw` by mohlo odrezať iné aplikácie aj samotné SSH. Nespúšťaj preto
žiadny príkaz `ufw` (ani iného firewallu) a človeku to povedz. Porty z kroku 3
sa nikde neotvárajú.

**Potvrdí človek:** otvorenie portov 80 a 443 (a 443/udp) a zapnutie
firewallu. Pravidlá vo firewalle poskytovateľa nastavuje človek. Na serveri
s existujúcou reverznou proxy nič.

## 5. DNS

**Agent smie sám:** vypísať presné záznamy podľa zvolenej domény a služieb, napríklad
pre `lawoss.example.com` a služby `slovlex,orsr`:

| Typ | Názov | Hodnota |
|---|---|---|
| A | `auth.lawoss.example.com` | verejná IPv4 adresa servera |
| A | `slovlex.lawoss.example.com` | verejná IPv4 adresa servera |
| A | `orsr.lawoss.example.com` | verejná IPv4 adresa servera |

Záznam AAAA pridaj iba vtedy, ak má server verejnú IPv6 adresu a porty 80 a 443
sú na nej dostupné. Namiesto jednotlivých záznamov stačí aj jeden záznam
`*.lawoss.example.com`. Čo s CAA a čakaním na šírenie DNS:
`references/dns-and-tls.md`.

**Ak server už má reverznú proxy (Traefik, Dokploy, Coolify):** záznamy sú
rovnaké. Ukazujú na verejnú IP adresu, na ktorej prijíma prevádzku existujúca
proxy; ak je server za NAT, je to verejná IP adresa smerovača. Tú pozná
človek (rozhranie smerovača alebo poskytovateľa pripojenia) alebo už na ňu
ukazujú záznamy iných aplikácií na tej istej proxy. Záznam
`*.lawoss.example.com` stačí aj tu.

Keď človek záznamy vytvorí, over, že sa adresy prekladajú na server
(`getent hosts auth.lawoss.example.com`).

**Potvrdí človek:** vytvorí záznamy sám u svojho správcu DNS. Agent DNS nikdy
nemení.

## 6. Stiahnutie pripnutého vydania

**Agent smie sám:** stiahnuť verejný repozitár, prepnúť ho na pripnutý commit
a overiť ho:

```sh
git clone https://github.com/Omni-Legal-Products/lawoss-selfhost.git ~/lawoss-selfhost
cd ~/lawoss-selfhost
git checkout --detach 60ff58dfdd6a70f3534f9fe0ff05f3344563cca6
git rev-parse HEAD
```

`git rev-parse HEAD` musí vypísať presne
`60ff58dfdd6a70f3534f9fe0ff05f3344563cca6`. Inak sa zastav.

Záznam vydania nie je v repozitári; je v tomto skille (`release/0.3.0.json`).
Skopíruj ho na server bez zmeny, napríklad ako `~/lawoss-0.3.0.json`
(`scp` z počítača, na ktorom beží agent), a over jeho odtlačok:

```sh
sha256sum ~/lawoss-0.3.0.json
```

Výsledok musí byť `329d5bd454581e2bc16de0bd54d1003fbaf4516c5b251146a4429271881ea22d`.
Ukáž človeku poznámku k vydaniu (pole `note` v zázname; neobsahuje
tajomstvá). Potom nainštaluj súbory vydania do `/opt/lawoss`:

```sh
cd ~/lawoss-selfhost
sudo sh deploy/install-host-files.sh ~/lawoss-0.3.0.json 329d5bd454581e2bc16de0bd54d1003fbaf4516c5b251146a4429271881ea22d .
```

Skript overí odtlačok záznamu, stiahne obraz auth podľa odtlačku (digestu),
skontroluje každý súbor podľa záznamu a až potom ho nainštaluje. Končí
riadkom `installed the host files of release …` a cestou
`/opt/lawoss/node/bin/node`; aj to je úspech.

Atestácie povedz úprimne:

- Ak `gh` nie je nainštalovaný, skript vypíše upozornenie a pokračuje. Platí
  odtlačok záznamu a odtlačky obrazov: na server príde presne to, čo zapísal
  katalóg. Neoverí sa však atestácia, že obrazy postavila CI organizácie.
- Ak `gh` nainštalovaný je, musí byť prihlásený ako root, inak skript (a neskôr
  `init` aj `update`) vydanie odmietne. Neobchádzaj to odinštalovaním `gh`;
  opýtaj sa človeka. Stav prihlásenia roota zistíš bez výpisu podrobností:

  ```sh
  sudo gh auth status > /dev/null 2>&1 && echo prihlaseny || echo neprihlaseny
  ```
- Obraz proxy (Caddy) atestáciu nemá; platí preň iba odtlačok.

**Potvrdí človek:** nič, ak `gh` nie je nainštalovaný. Ak je a človek chce
atestácie overiť, prihlási ho sám vo svojom vlastnom termináli (token sa do
konverzácie nedostane):

```text
sudo gh auth login
```

## 7. Generovanie tajomstiev

**Agent smie sám:** spustiť `init`, ktorý vygeneruje všetky tajomstvá na
serveri do `/opt/lawoss/.env` (0600, iba root). `.env` nikdy nečítaj ani
nevypisuj. Pred `init` musí byť hotové potvrdenie z kroku 9 (podmienky
certifikačnej autority a e-mail), lebo `init` e-mail vyžaduje a `.env` už
nikdy neprepíše.

```sh
sudo /opt/lawoss/bin/lawoss-selfhost init --base lawoss.example.com --services slovlex,orsr,judikaty --acme-email ops@example.com --record ~/lawoss-0.3.0.json --record-sha256 329d5bd454581e2bc16de0bd54d1003fbaf4516c5b251146a4429271881ea22d
```

Doménu, služby a e-mail nahraď voľbami človeka. `init` vypíše na štandardný
výstup iba názvy hostiteľov; porovnaj ich so záznamami DNS z kroku 5. Na
chybový výstup (stderr) pridá jeden riadok s povolenými callbackmi: webovými
adresami, na ktoré sa aplikácia smie vrátiť po prihlásení. Návrat na ten istý
počítač (Claude Code) nepotrebuje žiadny záznam a funguje vždy. Predvolene je to
callback aplikácií Claude `claude.ai/api/mcp/auth_callback` (s `https://`),
takže Claude desktop a claude.ai sa pripoja bez ďalšieho nastavovania; to je
cieľ produktu. Callback nie je tajomstvo. Služby neskôr pridáš alebo odoberieš
cez `services add|remove`, callbacky cez `callbacks`
(`references/operations.md`). Ak je zle doména alebo e-mail, `.env` neupravuj
ani nečítaj; zastav sa a rozhodnutie nechaj na človeku.

Pred `init` sa opýtaj človeka, či chce pripájať konektory Claude desktop
a claude.ai. Rozhoduje človek. Voľbu `--no-claude-callbacks` pridaj na koniec
príkazu `init` (aj vo variante nižšie) iba vtedy, keď ich človek nechce. `init`
potom nepovolí žiadny callback a na stderr vypíše, že ho možno pridať neskôr
príkazom `callbacks add claude`.

**Ak server už má reverznú proxy (Traefik, Dokploy, Coolify):** pridaj porty
a adresu, ktoré človek potvrdil v kroku 3 (`<HOST_ADDR>` nahraď touto
adresou):

```sh
sudo /opt/lawoss/bin/lawoss-selfhost init --base lawoss.example.com --services slovlex,orsr,judikaty --acme-email ops@example.com --http-port 18080 --https-port 18443 --proxy-bind <HOST_ADDR> --record ~/lawoss-0.3.0.json --record-sha256 329d5bd454581e2bc16de0bd54d1003fbaf4516c5b251146a4429271881ea22d
```

`init` ich zapíše do `.env` ako `LAWOSS_HTTP_PORT`, `LAWOSS_HTTPS_PORT`
a `LAWOSS_PROXY_BIND`. Ak `init` voľby odmietne, zastav sa a povedz to
človeku.

**Tajomstvá:** `.env` nikdy nečítaj, nevypisuj ani nekopíruj; ak sa niečo
z neho objaví vo výstupe, zastav sa a postupuj podľa „Nikdy nespúšťaj“.

**Potvrdí človek:** či chce konektory Claude desktop a claude.ai (predvolene
áno; ak nie, `init` dostane `--no-claude-callbacks`). Doménu, služby a e-mail
už potvrdil.

## 8. Značka

**Agent smie sám:** z loga a farieb človeka pripraviť balík značky
(`references/brand.md`), skopírovať ho na server, napríklad do
`~/kancelaria`, a skontrolovať ho:

```sh
sudo /opt/lawoss/bin/lawoss-selfhost brand check "$HOME/kancelaria"
sudo /opt/lawoss/bin/lawoss-selfhost brand preview "$HOME/kancelaria"
```

`brand preview` beží, kým ho nezastaví Ctrl-C. Ak ho tvoje nástroje nevedia
nechať bežať, nech ho človek spustí sám vo svojom vlastnom SSH termináli. Človek si
otvorí tunel a náhľad v prehliadači:

```text
ssh -N -L 4317:127.0.0.1:4317 USER@SERVER
```

a potom `http://127.0.0.1:4317`. Po schválení balík nastav:

```sh
sudo /opt/lawoss/bin/lawoss-selfhost brand set "$HOME/kancelaria"
```

`brand set` reštartuje kontajner auth; pred krokom 10 ho tým už spustí, čo je
v poriadku. Bez vlastného balíka zostane predvolený balík LAWOSS, ktorý je
určený iba pre používateľov LAWOSS.

**Potvrdí človek:** schváli náhľad a potvrdí, že smie použiť logo, názov
a farby (napríklad sú to jeho vlastné alebo má súhlas ich vlastníka).

## 9. Certifikáty

**Agent smie sám:** vysvetliť certifikačnú autoritu. Tento krok sa s človekom
prejde ešte pred krokom 7. Caddy pri spustení požiada o certifikát pre každú
adresu, predvolene u Let's Encrypt (pri zlyhaní môže skúsiť ZeroSSL), a tým
v mene prevádzkovateľa prijme ich podmienky. Kontaktný e-mail (`--acme-email`)
dostane autorita; nie je tajomstvom ani súčasťou certifikátu. Teraz, pred
spustením, over, že DNS ukazuje na server a porty 80 a 443 sú otvorené. Na
serveri s existujúcou reverznou proxy namiesto portov človek v konverzácii
potvrdí, že nainštaloval súbor presmerovania (krok 10); pred spustením to
overí kontrola trasy na porte 80 (krok 10) a potom `doctor` (kroky 10 a 13). Priečinok dynamickej konfigurácie ani statickú
konfiguráciu proxy agent nevypisuje ani nečíta (v Dokploy je v ňom aj
úložisko certifikátov).
Opakované neúspešné pokusy môže autorita dočasne obmedziť.

**Potvrdí človek:** prijme podmienky certifikačnej autority a zadá kontaktný
e-mail.

## 10. Spustenie

**Agent smie sám:** spustiť server a skontrolovať ho. Na serveri
s existujúcou reverznou proxy až potom, keď človek nainštaloval súbor
presmerovania (nižšie):

```sh
sudo docker compose -f /opt/lawoss/compose.yaml --env-file /opt/lawoss/.env up -d
sudo /opt/lawoss/bin/lawoss-selfhost doctor
```

`doctor` vypisuje iba riadky `PASS` a `FAIL`. Ak zlyhá TLS hneď po spustení,
počkaj minútu, kým Caddy získa certifikáty, a spusti ho znova. Ak služba
potrebuje kľúč poskytovateľa (napríklad `fs`), zadá ho človek.

**Ak server už má reverznú proxy (Traefik, Dokploy, Coolify):** pred prvým
spustením napíš presnú dynamickú konfiguráciu Traefiku (poskytovateľ `file`)
pre zvolenú základnú doménu, `<HOST_ADDR>` a porty podľa vzoru
v `references/existing-proxy.md`: router TCP s `HostSNIRegexp`
a `tls.passthrough: true` na port HTTPS a router HTTP pre port 80 (v Dokploy
vstupný bod `web`) na port HTTP. Regulárny
výraz vymenuje presne `auth` a zvolené služby, má bodky zapísané ako `\.`,
začína `^` a končí `$`, napríklad `^(auth|slovlex|orsr|judikaty)\.lawoss\.example\.com$`.
Nikdy nezachytí všetkých hostiteľov pod základnou doménou, lebo na zdieľanej
proxy by tým iným aplikáciám zobral TLS. Súbor ukáž človeku; nainštaluje ho
sám (v Dokploy v ľavom menu **Traefik File System**, priečinok `dynamic`;
presný postup, aj keď rozhranie nový súbor vytvoriť nedovolí, je
v `references/existing-proxy.md`; inde do priečinka dynamickej konfigurácie,
ktorý si nájde sám). Inštaláciu súboru potvrdí v konverzácii samostatne, nie
spolu so spustením. Potom over, že Traefik súbor načítal:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: auth.lawoss.example.com' http://127.0.0.1/
```

`404` znamená, že súbor sa neuplatnil (chýba, je v zlom priečinku alebo má
chybu). `502` alebo `503` znamená, že trasa existuje a čaká na LAWOSS. Iný
kód (napríklad presmerovanie `301` alebo `308`, ak proxy presmerúva všetko na
HTTPS) nič nedokazuje; vtedy inštaláciu potvrdí človek. Kým je výsledok `404`,
server nespúšťaj: Caddy by hneď žiadal certifikáty
a neúspešné pokusy autorita obmedzuje. Existujúcu konfiguráciu proxy nemeň,
nepresúvaj ani nemaž, Traefik ani Dokploy nereštartuj a úložisko certifikátov proxy
(`acme.json`) nečítaj. `doctor` potom overuje TLS cez existujúcu proxy
a prejde, iba keď presmerovanie funguje.

**Tajomstvá:** kľúč poskytovateľa nikdy nepýtaj do konverzácie a logy
kontajnerov nečítaj; ak sa tajomstvo objaví vo výstupe, zastav sa a postupuj
podľa „Nikdy nespúšťaj“.

**Potvrdí človek:** nič; na serveri s existujúcou reverznou proxy inštaláciu
súboru presmerovania, ktorú urobí sám. Kľúče poskytovateľov zadáva človek sám
vo svojom vlastnom termináli; hodnotu píše do skrytého vstupu:

```text
sudo /opt/lawoss/bin/lawoss-selfhost set-key FS_API_KEY
```

## 11. Prvý účet

**Agent smie sám:** založiť osobný účet s jednorazovým aktivačným odkazom.
Meno účtu má 3 až 64 znakov: malé písmená bez diakritiky, číslice, `-` alebo
`_`, a začína písmenom alebo číslicou. Meno je zároveň označenie údajov
používateľa, preto ho neskôr nemeň. Každý človek má vlastný účet.

```sh
sudo /opt/lawoss/bin/lawoss-selfhost invite jnovak slovlex,orsr,judikaty
```

Príkaz vypíše iba cestu `/opt/lawoss/handoff/jnovak.link` (súbor 0600). Povedz
človeku len túto cestu; súbor nikdy nečítaj. Pri účte sa e-mail nezadáva,
iba meno. Či účet vznikol a či je aktivovaný, ukáže `list` (meno, stav,
služby); súbor s odkazom po aktivácii zmizne, lebo ho človek zmaže.

**Tajomstvá:** aktivačný odkaz ani heslo nikdy nepýtaj do konverzácie; ak sa
objavia vo výstupe, zastav sa a postupuj podľa „Nikdy nespúšťaj“. Odkaz platí
1 hodinu.

**Potvrdí človek:** otvorí súbor sám vo svojom vlastnom termináli (nie cez
agenta), odkaz otvorí v prehliadači, aktivuje účet a zvolí si heslo (aspoň
15 znakov). Potom súbor zmaže:

```text
sudo cat /opt/lawoss/handoff/jnovak.link
sudo rm /opt/lawoss/handoff/jnovak.link
```

## 12. Pripojenie aplikácie

**Agent smie sám:** dať adresy služieb v tvare `https://<služba>.<základná doména>/mcp`,
napríklad `slovlex.lawoss.example.com/mcp` s `https://`. Pre návod na
používanie odporuč plugin `lawoss-remote-skills` (vzdialené verzie skillov).

Povedz vopred:

- Adresa `/mcp` sa nezadáva do prehliadača (ukáže prázdnu stránku), ale do
  aplikácie ako vzdialené pripojenie. Stránka `auth.<základná doména>`
  je iba informačná; prihlasovací formulár sa otvorí až pri pripájaní služby.
- Claude desktop a claude.ai: človek pridá v **Settings → Connectors** vlastný
  konektor (custom connector) s adresou `https://<služba>.<základná-doména>/mcp`,
  pre každú službu jeden. Funguje to, ak `init` povolil callback aplikácií
  Claude (krok 7) a `callbacks list` ho vypíše (`references/operations.md`).
  Ak ho človek v kroku 7 odmietol, konektor skončí chybou registrácie;
  neobchádzaj to, callback pridá až `callbacks add claude` po potvrdení
  človeka.
  Aplikácie Claude sa na server pripájajú z internetu cez verejný port 443; za
  existujúcou reverznou proxy ho drží tá proxy a posiela spojenia ďalej.
- Prihlásenie cez claude.ai zatiaľ nebolo overené na skutočnom nasadení;
  sprístupňuje ho až vydanie 0.3.0. Ak zlyhá, povedz to človeku úprimne
  a nastavenia servera kvôli tomu nemeň.

V Claude Code (návrat na ten istý počítač, bez callbacku) to človek urobí ako
doteraz vo vlastnom termináli na svojom počítači a potom v Claude Code zadá
`/mcp`, vyberie pripojenie a zvolí **Authenticate** (`<služba>`
a `<základná-doména>` nahraď, napríklad `slovlex`):

```text
claude mcp add --transport http lawoss-<služba> https://<služba>.<základná-doména>/mcp
```

**Potvrdí človek:** v aplikácii LAWOSS pridá vzdialené pripojenie, prihlási sa,
udelí súhlas a potvrdí, že sa zobrazujú nástroje služby.

## 13. Overenie

**Agent smie sám:** znova spustiť `doctor` a požiadať človeka o jeden skutočný
dotaz na každú zapnutú službu cez nové pripojenie; ten istý dotaz porovnaj
s lokálnym pluginom, ak ho človek má.

```sh
sudo /opt/lawoss/bin/lawoss-selfhost doctor
```

Pripomeň, že prechod `doctor` dokazuje technickú funkčnosť, nie úplnosť
alebo aktuálnosť zdrojov. Rozdiel vo výsledku hlás presne; na diaľku chýbajú
nástroje, ktoré ukladajú súbory.

**Ak server už má reverznú proxy (Traefik, Dokploy, Coolify):** zlyhanie TLS
alebo HTTP v `doctor` znamená najprv, že súbor presmerovania chýba alebo je
zlý. Skôr než čokoľvek iné nech ho človek skontroluje (základná doména, vstupné
body, `<HOST_ADDR>`, porty, verzia Traefiku; `references/existing-proxy.md`).
Ak trasa funguje a TLS zlyháva aj po niekoľkých minútach, postupuj podľa časti
„Certifikáty, keď súbor prišiel neskoro“ v tej istej referencii.
Konfiguráciu proxy agent nemení.

**Potvrdí človek:** že výsledky vyzerajú správne.

## 14. Zálohy

**Agent smie sám:** vytvoriť kľúč záloh, urobiť prvú zálohu, skontrolovať ju
a po schválení nastaviť plán:

```sh
sudo /opt/lawoss/bin/lawoss-selfhost backup init-key
sudo /opt/lawoss/bin/lawoss-selfhost backup
sudo /opt/lawoss/bin/lawoss-selfhost restore --dry-run
```

`backup init-key` vypíše iba cesty ku kľúčom. Zálohy sa šifrujú verejným
kľúčom; bez súkromného kľúča sa nedajú obnoviť. Plán (napríklad denne o 2.30)
nastav až po schválení; postup je v `references/operations.md`.

**Tajomstvá:** súkromný kľúč záloh (`backup-private.pem`) nikdy nečítaj,
nekopíruj ani nepresúvaj; ak sa jeho obsah objaví vo výstupe, zastav sa
a povedz to človeku.

**Potvrdí človek:** skopíruje súkromný kľúč na svoj počítač na bezpečné miesto
(napríklad do správcu hesiel) a schváli plán záloh. Postup pre človeka je
v `references/operations.md`; agent kľúč nečíta ani nekopíruje.

## 15. Odovzdanie

**Agent smie sám:** zapísať na server krátku prevádzkovú poznámku
`/opt/lawoss/PREVADZKA.md` podľa vzoru v `references/operations.md`: verzia,
commit, doména, služby, plán záloh a kde je súkromný kľúč (opis miesta, nie
kľúč), postup aktualizácie a rotácie. Žiadne tajomstvá, heslá ani odkazy.

**Ak server už má reverznú proxy (Traefik, Dokploy, Coolify):** do poznámky
patria aj porty, `<HOST_ADDR>` a miesto, kde človek uložil súbor presmerovania
(riadok „Za existujúcou proxy“ vo vzore v `references/operations.md`).
Povedz človeku, že pri odstránení nasadenia musí tento súbor odstrániť aj
z konfigurácie existujúcej proxy (`references/existing-proxy.md`).

**Potvrdí človek:** nič; odporuč mu poznámku si prečítať.
