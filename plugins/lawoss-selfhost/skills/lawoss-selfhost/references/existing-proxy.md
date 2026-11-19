# Server s existujúcou reverznou proxy

Tento postup platí, keď na serveri už beží reverzná proxy, ktorá drží porty
80 a 443: Traefik v Dokploy, v Coolify alebo vlastný. Proxy Caddy z LAWOSS
potom nepočúva na portoch 80 a 443, ale na dvoch iných portoch dostupných iba
zo servera. Existujúca proxy jej podľa názvu hostiteľa (SNI) posiela spojenia
pre adresy nasadenia bez rozšifrovania TLS. Caddy ďalej sám ukončuje TLS
a získava certifikáty. Používatelia sa pripájajú stále na port 443.

Postup potrebuje vydanie `lawoss-selfhost`, ktorého `init` pozná voľby
`--http-port`, `--https-port` a `--proxy-bind`. Ak ich `init` odmietne,
pripnuté vydanie ich ešte nepozná: zastav sa a povedz to človeku.

## Čo agent s existujúcou proxy nikdy nerobí

- nemení, nepresúva ani nemaže jej konfiguráciu; súbor presmerovania iba
  napíše a ukáže, nainštaluje ho človek;
- nereštartuje ani neprekonfiguruje Traefik, Dokploy ani Coolify;
- nečíta `acme.json` ani iné úložisko certifikátov proxy (sú v ňom súkromné
  kľúče certifikátov);
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
sieti:

- jedna sieť s vyplnenou adresou: to je `<HOST_ADDR>`;
- sieť `host` (proxy beží priamo v sieti servera): `<HOST_ADDR>` je
  `127.0.0.1`;
- prázdna adresa pri prekryvnej sieti Docker Swarm (tú používa napríklad
  Dokploy): kontajner vtedy dosiahne server cez sieť `docker_gwbridge`. Jej
  adresu prečítaš takto a človeku ju navrhneš ako `<HOST_ADDR>`:

  ```sh
  sudo docker network inspect docker_gwbridge --format '{{range .IPAM.Config}}{{.Gateway}}{{println}}{{end}}'
  ```

- viac sietí, prázdny výsledok aj z `docker_gwbridge` alebo čokoľvek
  nejasné: zastav sa a opýtaj sa človeka. Adresu nehádaj.

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

**Potvrdí človek:** oba porty a `<HOST_ADDR>`. Po `init` sú zapísané v `.env`;
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
podľa zvolenej základnej domény, portov a `<HOST_ADDR>` a ukáže ju človeku.
Pre `lawoss.example.com`, porty 18080 a 18443:

```yaml
tcp:
  routers:
    lawoss-tls:
      entryPoints: [websecure]
      rule: HostSNIRegexp(`^[a-z0-9-]+\.lawoss\.example\.com$`)
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
      rule: HostRegexp(`^[a-z0-9-]+\.lawoss\.example\.com$`)
      service: lawoss-http
  services:
    lawoss-http:
      loadBalancer:
        servers:
          - url: http://<HOST_ADDR>:18080
```

Pri zápise:

- `lawoss.example.com` nahraď základnou doménou, bodky v nej oddeľ spätnou
  lomkou (`\.`) a ponechaj `^` na začiatku a `$` na konci. Pravidlo potom
  zachytí `auth.` aj každú službu priamo pod základnou doménou, preto sa súbor
  pri `services add` ani `services remove` nemení.
- `<HOST_ADDR>` nahraď adresou z kroku 3 a porty tými, ktoré potvrdil človek.
  Adresu IPv6 píš v tomto súbore v hranatých zátvorkách (`[…]:18443`),
  v `--proxy-bind` bez nich.
- `web` a `websecure` sú názvy vstupných bodov (entrypoints) pre porty 80
  a 443 v Dokploy. Iná inštalácia ich môže volať inak (Coolify napríklad
  `http` a `https`); názvy potvrdí človek podľa svojej proxy.
- `passthrough: true` znamená, že Traefik TLS nerozšifruje a certifikát
  nepotrebuje. Caddy získa certifikáty sám (overenie TLS-ALPN-01 funguje cez
  presmerovanie; trasa pre port 80 umožní aj HTTP-01 a presmerovanie na
  HTTPS).
- Caddy potom ako adresu klienta vidí adresu existujúcej proxy, nie adresu
  používateľa.

**Potvrdí človek:** súbor nainštaluje sám. V Dokploy ho pridá ako nový súbor
v editore súborov Traefiku (dynamická konfigurácia), inde ako nový súbor
v priečinku, ktorý sleduje poskytovateľ `file` jeho Traefiku. Traefik, ktorý
priečinok sleduje, načíta súbor bez reštartu. Ak ho nesleduje, o ďalšom
postupe rozhoduje človek; agent Traefik nereštartuje.

## Kontrola a chyby (kroky 10 a 13)

`doctor` overuje TLS cez `127.0.0.1:443` s názvom každej adresy (SNI), teda
cez existujúcu proxy, rovnakou cestou ako používatelia. Prejde iba vtedy, keď
presmerovanie funguje. Ak existujúca proxy nepočúva na `127.0.0.1:443`
servera, `doctor` sa k nasadeniu odtiaľ nedostane; povedz to človeku.

Ak na tejto vetve zlyhá kontrola TLS alebo HTTP, najprv to znamená, že súbor
presmerovania chýba alebo je zlý. Skôr než čokoľvek iné nech človek overí, že
je nainštalovaný a sedí v ňom základná doména, názvy vstupných bodov,
`<HOST_ADDR>` aj porty a že zápis zodpovedá verzii Traefiku. Až potom počkaj
minútu na certifikáty a skontroluj DNS podľa `references/dns-and-tls.md`.
Konfiguráciu proxy agent ani pri chybe nemení.

## Zmeny a odstránenie

- `update`, `rollback`, `rotate` a `services` porty ani `<HOST_ADDR>`
  nemenia; súbor presmerovania zostáva platný.
- Pri `services add` stačí nový záznam DNS (ak nie je záznam `*`).
- Ak sa nasadenie odstraňuje, človek odstráni z konfigurácie existujúcej
  proxy aj súbor presmerovania. Agent ho nemaže.
- Do prevádzkovej poznámky (krok 15) patria porty, `<HOST_ADDR>` a to, kde
  človek súbor presmerovania uložil.
