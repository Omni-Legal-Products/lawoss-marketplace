# Server s existujúcou reverznou proxy

Tento postup platí, keď na serveri už beží reverzná proxy, ktorá drží porty
80 a 443: Traefik v Dokploy, v Coolify alebo vlastný. Proxy Caddy z LAWOSS
potom nepočúva na portoch 80 a 443, ale na dvoch iných portoch dostupných iba
zo servera. Existujúca proxy jej podľa názvu hostiteľa (SNI) posiela spojenia
pre adresy nasadenia bez rozšifrovania TLS. Caddy ďalej sám ukončuje TLS
a získava certifikáty. Používatelia sa pripájajú stále na port 443.

Voľby `--http-port`, `--https-port` a `--proxy-bind` pozná `init` od
vydania `lawoss-selfhost` 0.2.0. Ak ich `init` odmietne, zastav sa a povedz to
človeku.

## Čo agent s existujúcou proxy nikdy nerobí

- nemení, nepresúva ani nemaže jej konfiguráciu; súbor presmerovania iba
  napíše a ukáže, nainštaluje ho človek;
- nereštartuje ani neprekonfiguruje Traefik, Dokploy ani Coolify;
- nečíta `acme.json` ani iné úložisko certifikátov proxy (sú v ňom súkromné
  kľúče certifikátov);
- nevypisuje ani nečíta priečinok dynamickej konfigurácie proxy ani jej
  statickú konfiguráciu (v Dokploy je v tom istom priečinku aj úložisko
  certifikátov);
- nespúšťa `docker inspect` kontajnera proxy bez `--format` obmedzeného na
  názvy sietí a ich gateway; úplný výpis obsahuje prostredie kontajnera
  a v ňom často tajomstvá;
- nemení firewall: porty 80 a 443 už patria existujúcej proxy a server je
  zdieľaný, preto na tejto vetve nespúšťa žiadny príkaz `ufw` (ani iného
  firewallu).

## Kto drží porty 80 a 443 (krok 3)

Agent smie sám len čítať:

```sh
sudo ss -ltnp
sudo docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'
```

Ak porty 80 a 443 zverejňuje kontajner s obrazom `traefik` (v Dokploy
zvyčajne `dokploy-traefik`, v Coolify `coolify-proxy`) alebo vlastný Traefik,
pokračuj podľa tohto postupu. Ak ich drží čokoľvek iné (nginx, Apache, iný
Caddy, proces mimo Dockeru), zastav sa a opýtaj sa človeka.

Z obrazu v tom istom výpise prečítaj verziu Traefiku. Pravidlá nižšie sú
napísané pre Traefik v3 (regulárne výrazy v `HostSNIRegexp` a `HostRegexp`).
Traefik v2 zapisuje pravidlá inak; ak je verzia 2 alebo z obrazu nevyplýva
(napríklad `latest`), povedz to človeku a zápis s ním over.

## Adresa servera pre proxy (`<HOST_ADDR>`)

`<HOST_ADDR>` je adresa, na ktorej kontajner existujúcej proxy dosiahne
server. Na nej (`--proxy-bind`) budú počúvať porty proxy LAWOSS, takže nie sú
dostupné zo siete. Na tejto vetve nikdy nenechávaj porty počúvať na všetkých
adresách. Adresu zistíš bez výpisu prostredia kontajnera (`<traefik>` je
názov kontajnera z `docker ps`):

```sh
sudo docker inspect <traefik> --format '{{range $name, $net := .NetworkSettings.Networks}}{{$name}} {{$net.Gateway}}{{println}}{{end}}'
```

Každý riadok je názov siete Dockeru a jej gateway, teda adresa servera v tej
sieti. Vyber podľa tohto poradia:

1. Sieť `bridge` (predvolená sieť Dockeru) s vyplnenou adresou: to je
   `<HOST_ADDR>`, adresa rozhrania `docker0` servera. Môžeš ju overiť len
   čítaním:

   ```sh
   ip -4 addr show docker0
   ```

2. Sieť `host` (proxy beží priamo v sieti servera): `<HOST_ADDR>` je
   `127.0.0.1`.
3. Prekryvné siete Docker Swarm (napríklad `dokploy-network` v Dokploy) nemajú
   použiteľnú gateway (adresa je prázdna alebo neplatná); vynechaj ich.
4. Bez siete `bridge` a `host`: ak ostane práve jedna sieť s vyplnenou
   adresou, je to `<HOST_ADDR>`. Ak ostane viac takých adries alebo žiadna,
   zastav sa a opýtaj sa človeka. Adresu nehádaj.

Napríklad Traefik v Dokploy (`dokploy-traefik`) býva pripojený k sieti
`bridge` aj k prekryvnej sieti `dokploy-network`; `<HOST_ADDR>` je potom
gateway siete `bridge`.

Či je adresa správna, potvrdí až `doctor` po spustení (krok 10).

## Porty

Vyber dva porty, na ktorých nič nepočúva; navrhni 18080 (HTTP) a 18443
(HTTPS). Port HTTPS sa zverejňuje pre TCP aj UDP, preto skontroluj oba
zoznamy:

```sh
ss -ltn
ss -lun
```

V žiadnom z nich nesmie byť `:18080` ani `:18443`. Inak navrhni iné porty.

**Potvrdí človek:** oba porty, `<HOST_ADDR>` a to, že žiadna iná aplikácia na
existujúcej proxy nepoužíva niektorý z názvov nasadenia (`auth.<základná
doména>` a `<služba>.<základná doména>` pre každú zvolenú službu). Po `init`
sú porty a adresa zapísané v `.env`;
neskôr ich agent nemení. Ak treba zmenu, zastav sa a rozhodnutie nechaj na
človeku.

## Firewall a DNS (kroky 4 a 5)

- Firewall sa nemení vôbec, ani u poskytovateľa servera. Porty 80 a 443 už
  existujúca proxy má otvorené. Porty 18080 a 18443 slúžia iba vnútri servera
  a nikde sa neotvárajú.
- Záznamy DNS sú rovnaké ako v kroku 5. Ukazujú na verejnú IP adresu, na
  ktorej prijíma prevádzku existujúca proxy; ak je server za NAT, je to
  verejná IP adresa smerovača. Stačí aj jeden záznam `*.lawoss.example.com`.

## Súbor presmerovania (krok 10, pred prvým spustením)

Agent napíše presnú dynamickú konfiguráciu Traefiku (poskytovateľ `file`)
podľa zvolenej základnej domény, služieb, portov a `<HOST_ADDR>` a ukáže ju
človeku. Pre `lawoss.example.com`, služby `slovlex,orsr,judikaty`, porty 18080
a 18443:

```yaml
tcp:
  routers:
    lawoss-tls:
      entryPoints: [websecure]
      rule: HostSNIRegexp(`^(auth|slovlex|orsr|judikaty)\.lawoss\.example\.com$`)
      tls:
        passthrough: true
      service: lawoss-tls
  services:
    lawoss-tls:
      loadBalancer:
        servers:
          - address: <HOST_ADDR>:18443
http:
  routers:
    lawoss-http:
      entryPoints: [web]
      rule: HostRegexp(`^(auth|slovlex|orsr|judikaty)\.lawoss\.example\.com$`)
      service: lawoss-http
  services:
    lawoss-http:
      loadBalancer:
        servers:
          - url: http://<HOST_ADDR>:18080
```

Pri zápise:

- Do zátvorky vymenuj `auth` a presne zvolené služby, oddelené `|`.
  `lawoss.example.com` nahraď základnou doménou, pred každú bodku v nej napíš
  spätnú lomku (`\.`) a ponechaj `^` na začiatku a `$` na konci. Oba routery
  majú rovnaký výraz.
- Nikdy nepíš pravidlo pre všetkých hostiteľov pod základnou doménou. Na
  zdieľanej proxy majú routery TCP na vstupnom bode pre port 443 prednosť pred
  routermi HTTP, takže širšie pravidlo by iným aplikáciám pod tou istou
  doménou zobralo TLS aj prevádzku na porte 80. Preto sa súbor pri
  `services add` a `services remove` mení (časť „Zmeny a odstránenie“).
- `<HOST_ADDR>` nahraď adresou z kroku 3 a porty tými, ktoré potvrdil človek.
  Adresu IPv6 píš v tomto súbore v hranatých zátvorkách a celú hodnotu
  v úvodzovkách, inak to nie je platný YAML: `address: "[2001:db8::1]:18443"`
  a `url: "http://[2001:db8::1]:18080"`. V `--proxy-bind` ju píš bez zátvoriek
  (`2001:db8::1`).
- `web` a `websecure` sú názvy vstupných bodov (entrypoints) pre porty 80
  a 443 v Dokploy. Iná inštalácia ich môže volať inak (Coolify napríklad
  `http` a `https`); názvy potvrdí človek podľa svojej proxy.
- `passthrough: true` znamená, že Traefik TLS nerozšifruje a certifikát
  nepotrebuje. Caddy získa certifikáty sám (overenie TLS-ALPN-01 funguje cez
  presmerovanie; trasa pre port 80 umožní aj HTTP-01 a presmerovanie na
  HTTPS).
- Caddy potom ako adresu klienta vidí adresu existujúcej proxy, nie adresu
  používateľa.

Súbor napíš hneď po potvrdení v kroku 3, aby ho človek nainštaloval, kým
beží krok 6.

**Potvrdí človek:** súbor nainštaluje sám a v konverzácii samostatne potvrdí,
že je nainštalovaný (nie spolu so spustením servera). Inde než v Dokploy ho
pridá ako nový súbor v priečinku, ktorý sleduje poskytovateľ `file` jeho
Traefiku; tento priečinok si nájde sám. Agent ho nehľadá, nevypisuje ani
nečíta.

V Dokploy:

1. V ľavom menu **Traefik File System** (nie Settings → Web Server).
2. Priečinok **`dynamic`**, v ňom nový súbor, napríklad `lawoss-<názov>.yml`.
   Inde (napríklad vedľa `traefik.yml`) ho Traefik nemusí načítať.
3. V nastaveniach Web Server → Traefik nestláčať **Reload** ani iné akcie:
   môžu reštartovať Traefik pre všetky aplikácie. V strome súborov neotvárať
   `acme.json` ani priečinok `certificates` (súkromné kľúče certifikátov).

Ak rozhranie nový súbor vytvoriť nedovolí, človek ho vytvorí vo vlastnom SSH
termináli na serveri. `/etc/dokploy/traefik/dynamic` je predvolená cesta
Dokploy; namiesto `<obsah súboru>` vloží celý súbor vyššie:

```text
sudo tee /etc/dokploy/traefik/dynamic/lawoss-<názov>.yml > /dev/null <<'EOF'
<obsah súboru>
EOF
```

Traefik, ktorý priečinok sleduje, načíta súbor bez reštartu. Ak ho
nesleduje, o ďalšom postupe rozhoduje človek; agent Traefik nereštartuje. Či presmerovanie funguje, overí `doctor` (kroky 10 a 13).

## Kontrola a chyby (kroky 10 a 13)

`doctor` overuje TLS cez `127.0.0.1:443` s názvom každej adresy (SNI), teda
cez existujúcu proxy, rovnakou cestou ako používatelia. Prejde iba vtedy, keď
presmerovanie funguje. Ak existujúca proxy nepočúva na `127.0.0.1:443`
servera, `doctor` sa k nasadeniu odtiaľ nedostane; povedz to človeku.

Pred prvým spustením over trasu na porte 80 (krok 10 v `SKILL.md`): `404`
znamená, že Traefik súbor nenačítal, a server vtedy nespúšťaj; `502` alebo
`503` znamená, že trasa existuje; iný kód nič nedokazuje.

Ak na tejto vetve zlyhá kontrola TLS alebo HTTP, najprv to znamená, že súbor
presmerovania chýba alebo je zlý. Skôr než čokoľvek iné nech človek overí, že
je nainštalovaný a sedí v ňom základná doména, zoznam hostiteľov, názvy
vstupných bodov, `<HOST_ADDR>` aj porty a že zápis zodpovedá verzii Traefiku. Až potom počkaj
minútu na certifikáty a skontroluj DNS podľa `references/dns-and-tls.md`.
Ak je súbor správny a kontrola zlyháva ďalej, spojenie z proxy na server môže
blokovať firewall servera; povedz to človeku a nič nemeň. Konfiguráciu proxy
ani firewall agent ani pri chybe nemení.

### Certifikáty, keď súbor prišiel neskoro

Ak server bežal skôr, než súbor presmerovania fungoval, Caddy medzitým
neúspešne žiadal certifikáty a ďalší pokus môže odložiť aj o desiatky minút.
Keď trasa na porte 80 už nevracia `404` a `doctor` po niekoľkých minútach
stále hlási `FAIL tls`:

1. Človek si vo vlastnom termináli pozrie chyby certifikátov a vlastnými
   slovami povie, čo v nich je (napríklad `rate limit`, `timeout`,
   `unrecognized name`). Výstup logov do konverzácie nevkladá (časť „Nikdy
   nespúšťaj“ v `SKILL.md`):

   ```text
   sudo docker logs lawoss-proxy-1 --since 30m 2>&1 | grep -iE 'error|obtain|challenge|rate' | tail -15
   ```

   Chyby z času pred inštaláciou súboru (napríklad `tls: unrecognized name`)
   sú očakávané.
2. Po potvrdení reštartuj iba kontajner proxy LAWOSS; Caddy hneď skúsi znova:

   ```sh
   sudo docker compose -f /opt/lawoss/compose.yaml --env-file /opt/lawoss/.env restart proxy
   ```

Neopakuj reštart viackrát za hodinu: Let's Encrypt povolí najviac päť
neúspešných overení jednej adresy za hodinu. Traefik ani iné kontajnery sa
nereštartujú.

## Zmeny a odstránenie

- `update`, `rollback`, `rotate` a `services` porty ani `<HOST_ADDR>`
  nemenia.
- Pred `services add` agent napíše upravený súbor presmerovania s novou
  službou v zozname, človek potvrdí, že jej názov nepoužíva iná aplikácia na
  proxy, a súbor nainštaluje. Až potom spusti `services add`, aby Caddy mohol
  hneď získať certifikát. Človek pridá aj záznam DNS (ak nie je záznam `*`).
- Po `services remove` agent napíše súbor bez odobratej služby a človek ho
  nainštaluje.
- Ak sa nasadenie odstraňuje, človek odstráni z konfigurácie existujúcej
  proxy aj súbor presmerovania. Agent ho nemaže.
- Do prevádzkovej poznámky (krok 15) patria porty, `<HOST_ADDR>` a to, kde
  človek súbor presmerovania uložil.
