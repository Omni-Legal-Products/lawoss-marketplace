// Skalárne argumenty od MCP klientov chodia niekedy ako reťazce ("12500",
// "false"). Holé z.number()/z.boolean() vtedy odmietnu celé volanie s
// -32602 "expected number, received string".
import { z } from "zod";
/**
 * Boolean, ktorý prijme aj reťazce "true"/"false".
 *
 * ZÁMERNE NIE z.coerce.boolean(): to je obyčajná JS truthiness, takže reťazec
 * "false" sa stane true. Tu by to menilo výsledok výpočtu — platitelDph:
 * "false" by pri tarifnej hodnote 12 500 € nadhodnotilo trovy zo 603,96 € na
 * 742,87 €, a odpoveď by to ešte odôvodnila § 18 ods. 3 vyhl. 655/2004 Z. z.,
 * takže by chyba vyzerala ako zámer.
 *
 * Čokoľvek, čo nie je doslovné "true"/"false", validáciu naďalej neprejde.
 */
export function looseBoolean() {
    // Funkcia, nie zdieľaná konštanta: prevodník zod -> JSON Schema deduplikuje
    // ZHODNÉ inštancie schém do $ref na súrodenca ($ref: "#/properties/ine_pole").
    // Server si s tým poradí, ale klient taký vnútorný odkaz nerozlúšti a volanie
    // nástroja zlyhá. Každé pole preto dostane vlastnú inštanciu.
    return z.preprocess((v) => (typeof v === "string" ? (v === "true" ? true : v === "false" ? false : v) : v), z.boolean());
}
/**
 * Číslo, ktoré prijme aj reťazcový zápis. Prázdny reťazec sa nepovažuje za
 * nulu — inak by "" ticho prešlo ako 0 a istina či hodnota sporu by sa
 * počítala z nuly.
 */
export function looseNumber(inner = z.number()) {
    // Refinements (.positive(), .nonnegative(), ...) musia byť na vnútornej
    // schéme — z.preprocess vracia ZodEffects, ktoré ich neponúka.
    return z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? Number.NaN : Number(v)) : v), inner);
}
//# sourceMappingURL=scalars.js.map