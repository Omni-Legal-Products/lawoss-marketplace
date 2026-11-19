# DNS, firewall a certifikáty

## Adresy

Z vybranej základnej domény (`--base`) vzniknú tieto adresy:

- `auth.<základná doména>`: prihlásenie, aktivácia účtu a súhlas;
- `<služba>.<základná doména>` pre každú zapnutú službu; aplikácia sa
  pripája na `https://<služba>.<základná doména>/mcp`.

Pre `lawoss.example.com` so službami `slovlex,orsr` to sú
`auth.lawoss.example.com`, `slovlex.lawoss.example.com`
a `orsr.lawoss.example.com`. `init` aj `services add` vypíšu názvy
hostiteľov, ktoré musia byť v DNS.

## Záznamy DNS

Záznamy vytvára človek u svojho správcu DNS. Agent ich iba vypíše:

- jeden záznam A na každú adresu s verejnou IPv4 adresou servera, alebo jeden
  záznam `*.lawoss.example.com`;
- záznam AAAA iba vtedy, ak má server verejnú IPv6 adresu a porty 80 a 443 sú
  na nej dostupné. Nefunkčný AAAA záznam pokazí vydanie certifikátu aj
  prístup používateľov s IPv6;
- ak má doména záznamy CAA, musia povoliť certifikačnú autoritu, ktorú Caddy
  použije (Let's Encrypt, prípadne ZeroSSL). Bez záznamov CAA nie je čo
  meniť.

Šírenie zmien DNS môže trvať od minút po hodiny podľa TTL. Kým nie je hotové,
nespúšťaj krok 10: neúspešné pokusy o certifikát môže autorita dočasne
obmedziť. Overenie zo servera:

```sh
getent hosts auth.lawoss.example.com
getent hosts slovlex.lawoss.example.com
```

Obe adresy musia vrátiť verejnú adresu servera. `doctor` ich potom kontroluje
pri každom spustení (riadky `dns …`).

## Firewall

Z internetu musia byť dostupné iba:

- 22/tcp (SSH; alebo iný port, ktorý človek používa) — pravidlo musí byť
  povolené pred zapnutím firewallu;
- 80/tcp (overenie certifikátu a presmerovanie na HTTPS);
- 443/tcp a 443/udp (HTTPS a HTTP/3).

Auth a hub nemajú zverejnený žiadny port; počúvajú iba vo vnútornej sieti
Dockeru. Docker zverejňuje porty proxy vlastnými pravidlami, takže `ufw` ich
neblokuje; zatvorené porty preto nezaručí `ufw`, ale to, že Compose zverejňuje
iba proxy. Firewall u poskytovateľa servera (bezpečnostné skupiny a pod.)
nastavuje človek v jeho rozhraní. Ak server používa iný firewall než `ufw`
(napríklad `firewalld`), ukáž zodpovedajúce pravidlá pre ten nástroj
a spusti ich až po potvrdení.

## Certifikáty

- Caddy získava certifikát pre každú adresu sám pri prvom spustení
  a obnovuje ho pred uplynutím platnosti. Predvolene ho žiada od Let's
  Encrypt, pri zlyhaní môže skúsiť ZeroSSL.
- Žiadosťou prevádzkovateľ prijíma podmienky autority. Preto ich človek
  prijme v kroku 9 pred spustením; agent ich za neho neprijíma.
- `--acme-email` je kontakt, ktorý dostane autorita. Nie je tajomstvom, nie je
  v certifikáte a zostáva v `.env`, aby ho mali aj neskoršie úpravy
  konfigurácie. Odporuč spoločnú adresu prevádzky, nie osobnú.
- Certifikáty sú v zväzku `caddy-data`, ktorý zálohy neobsahujú; po obnove
  na novom serveri sa vydajú znova.
- `doctor` overuje TLS cez `127.0.0.1:443` s každou verejnou adresou, takže
  nepotrebuje hairpin NAT. Ak TLS zlyhá hneď po spustení, počkaj minútu
  a spusti `doctor` znova. Ak zlyháva ďalej, skontroluj DNS a porty 80 a 443;
  firewall ani DNS nemeň bez potvrdenia.
