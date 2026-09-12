// MCP nástroje: tenké obálky nad doménovou vrstvou. Žiadna business logika —
// zod schéma len zrkadlí input typ domain funkcie, `wrap` mapuje CalcError na
// isError, `warnings[]` z domain výsledku sa nikdy nezahadzujú (prechádzajú
// priamo v JSON tela odpovede).
import { z } from "zod";
import { looseBoolean, looseNumber } from "./scalars.js";
import { vypocitajUrok } from "../domain/urok.js";
import { vypocitajTrovy } from "../domain/trovy.js";
import { vypocitajSudnyPoplatok, zoznamPoloziek } from "../domain/poplatky.js";
import { vypocitajTrovyExekucie } from "../domain/exekucia.js";
import { CalcError } from "../domain/errors.js";
import { logToolCall } from "../logging.js";
import { getTables } from "../data/tables-cache.js";
function wrap(tool, fn) {
    const startedAt = Date.now();
    try {
        const response = { content: [{ type: "text", text: JSON.stringify(fn()) }] };
        logToolCall({ event: "tool_call", tool, outcome: "ok", durationMs: Date.now() - startedAt });
        return response;
    }
    catch (e) {
        if (e instanceof CalcError) {
            // Očakávaná chyba vstupu — kód áno, správa nie: môže citovať zadané sumy.
            logToolCall({
                event: "tool_call",
                tool,
                outcome: "calc_error",
                durationMs: Date.now() - startedAt,
                errorCode: e.code,
            });
            return {
                isError: true,
                content: [{ type: "text", text: JSON.stringify({ error: e.code, message: e.message }) }],
            };
        }
        logToolCall({
            event: "tool_call",
            tool,
            outcome: "error",
            durationMs: Date.now() - startedAt,
            errorCode: e instanceof Error ? e.name : typeof e,
        });
        throw e;
    }
}
export function registerTools(server, tablesFn = getTables) {
    // Static registration-time snapshot — used only to build the sudny_poplatok
    // tool description's list of sadzobník items. Tool handlers below call
    // tablesFn() fresh on every request so they see reloads picked up by the
    // cache provider (see src/data/tables-cache.ts).
    const initialTables = tablesFn();
    server.registerTool("urok_z_omeskania", {
        title: "Úrok z omeškania",
        description: "Zákonný alebo dohodnutý úrok z omeškania (SR, § 517 ods. 2 OZ / § 369 ObZ) s možnosťou čiastočných úhrad. " +
            "Vracia rozpis po úsekoch, právny základ, snapshot použitých sadzieb a warnings[] s právne relevantnými výhradami " +
            "(napr. neistý dátum vzniku záväzku, zastarané dáta ECB) — vždy over warnings pred použitím výsledku.",
        inputSchema: {
            istina: looseNumber(z.number().positive()).describe("Istina (dlžná suma) v EUR."),
            splatnost: z.string().describe("Dátum splatnosti dlhu, formát YYYY-MM-DD."),
            rezim: z.enum(["obcianske", "obchodne"]).describe("Právny režim: občianskoprávny alebo obchodnoprávny vzťah."),
            vznikZavazku: z
                .string()
                .optional()
                .describe("Dátum vzniku záväzkového vzťahu (YYYY-MM-DD) — rozhoduje o hranici 1. 2. 2013. Ak nezadané, predpokladá sa najneskorší možný (deň splatnosti)."),
            sposob: z
                .enum(["fixny", "variabilny", "najvyhodnejsi"])
                .optional()
                .describe('Spôsob výpočtu sadzby. "najvyhodnejsi" porovná dostupné spôsoby a vyberie ten výhodnejší pre veriteľa.'),
            dohodnutaSadzba: looseNumber(z.number().nonnegative()).optional().describe("Dohodnutá zmluvná sadzba (% p. a.), prebíja zákonnú sadzbu."),
            uhrady: z
                .array(z.object({ datum: z.string().describe("YYYY-MM-DD"), suma: looseNumber(z.number().positive()) }))
                .optional()
                .describe("Zoznam čiastočných úhrad dlhu."),
            kuDnu: z.string().optional().describe("Deň, ku ktorému sa úrok počíta (YYYY-MM-DD). Predvolene dnešný dátum."),
            uhradyNajprvIstina: looseBoolean()
                .optional()
                .describe("Ak true, úhrady sa najprv započítajú na istinu, potom na úrok (predvolene opačne)."),
        },
    }, (input) => wrap("urok_z_omeskania", () => vypocitajUrok(input, tablesFn())));
    server.registerTool("trovy_pravneho_zastupenia", {
        title: "Trovy právneho zastúpenia",
        description: "Tarifná odmena advokáta podľa vyhl. 655/2004 Z. z. (odmena za úkony + režijný paušál, prípadne DPH). " +
            "Vracia rozpis po úkonoch, právny základ, snapshot dát a warnings[] s právne relevantnými výhradami " +
            "(napr. nezvyčajný podiel úkonu) — vždy over warnings pred použitím výsledku.",
        inputSchema: {
            tarifnaHodnota: looseNumber(z.number().nonnegative())
                .nullable()
                .optional()
                .describe("Tarifná hodnota veci v EUR. Práve jedno z tarifnaHodnota / nevycislitelna musí byť zadané."),
            nevycislitelna: looseBoolean()
                .optional()
                .describe("True, ak ide o nevyčísliteľnú hodnotu veci podľa § 11 ods. 1 vyhl. 655/2004 Z. z."),
            ukony: z
                .array(z.object({
                rok: looseNumber().describe("Rok, v ktorom bol úkon právnej služby vykonaný."),
                podiel: looseNumber().describe("Podiel zo základnej sadzby: 1 = plný úkon, 0.5 = polovičný, 0.25 = štvrtinový."),
                druh: z.string().optional().describe("Voliteľný opisný text úkonu (informatívny)."),
            }))
                .describe("Zoznam úkonov právnej služby."),
            platitelDph: looseBoolean().describe("Či je advokát platiteľom DPH."),
        },
    }, (input) => wrap("trovy_pravneho_zastupenia", () => vypocitajTrovy(input, tablesFn())));
    server.registerTool("sudny_poplatok", {
        title: "Súdny poplatok",
        description: `Súdny poplatok podľa zák. č. 71/1992 Zb. Vracia zaokrúhlený poplatok, uplatnenú položku sadzobníka, ` +
            `právny základ, snapshot dát a warnings[] s právne relevantnými výhradami (napr. neuplatnená e-zľava) — ` +
            `vždy over warnings pred použitím výsledku. Dostupné položky sadzobníka: ${zoznamPoloziek(initialTables)
                .map((p) => `${p.id} (${p.nazov})`)
                .join(", ")}.`,
        inputSchema: {
            polozkaId: z.string().optional().describe("ID položky sadzobníka (povinné)."),
            hodnotaSporu: looseNumber(z.number().nonnegative()).optional().describe("Hodnota sporu v EUR — vyžaduje sa pri percentuálnych položkách."),
            obchodnaVec: looseBoolean().optional().describe("Či ide o vec obchodného registra (ovplyvňuje maximálnu sadzbu)."),
            epodanie: looseBoolean().optional().describe("Či bol návrh podaný elektronicky (nárok na zľavu, ak nie je vylúčená)."),
            instancia: z
                .enum(["odvolanie", "dovolanie", "kasacnaStaznost"])
                .optional()
                .describe("Násobok sadzby pre odvolacie/dovolacie/kasačné konanie (§ 6 ods. 2)."),
            upominacieKonanie: looseBoolean()
                .optional()
                .describe("Poplatok podľa § 11c ods. 1 (50 % zo sadzby, bez e-zľavy). Vzájomne sa vylučuje s instancia."),
            skoncenie: z
                .enum(["rozsudok", "zmier"])
                .optional()
                .describe('Spôsob skončenia veci — "zmier" použije zníženú sadzbu pri položkách, ktoré ju majú (napr. sadzbaZmier).'),
        },
    }, (input) => wrap("sudny_poplatok", () => vypocitajSudnyPoplatok(input, tablesFn())));
    server.registerTool("trovy_exekucie", {
        title: "Trovy exekúcie",
        description: "Odmena exekútora a paušálne výdavky podľa vyhl. 68/2017 Z. z. Vracia rozpis odmeny a paušálnych výdavkov, " +
            "právny základ, snapshot dát a warnings[] s právne relevantnými výhradami (napr. prekročenie zákonného stropu) — " +
            "vždy over warnings pred použitím výsledku.",
        inputSchema: {
            vymozene: looseNumber().describe("Výška skutočne vymoženého plnenia (EUR)."),
            zacatieKonania: z.string().describe("Dátum začatia exekučného konania (YYYY-MM-DD)."),
            splneneVLehote: looseBoolean()
                .describe("Či sa vymáhaný nárok splnil do uplynutia lehoty na podanie návrhu na zastavenie exekúcie s odkladným účinkom."),
            platitelDph: looseBoolean().optional().describe("Či je exekútor platiteľom DPH. Predvolene false."),
            vymahanyNarokKuDnuPoverenia: looseNumber()
                .optional()
                .describe("Výška vymáhaného nároku ku dňu vydania poverenia na vykonanie exekúcie (limit odmeny podľa § 197 ods. 1 EP)."),
            zastavene: looseBoolean()
                .optional()
                .describe("Či ide o zastavenie exekúcie — pri zastavení patrí plná náhrada paušálnych výdavkov aj pri vymožené = 0."),
        },
    }, (input) => wrap("trovy_exekucie", () => vypocitajTrovyExekucie(input, tablesFn())));
    server.registerTool("sadzby_info", {
        title: "Sadzby a snapshoty dát",
        description: "Audit tabuliek sadzieb: záznamy ECB, roky výpočtového základu a snapshoty (verzia, zdroj, dátum) všetkých " +
            "dátových tabuliek použitých kalkulačkami — na overenie, z akých dát bol výpočet urobený.",
        inputSchema: {},
    }, () => wrap("sadzby_info", () => {
        const tables = tablesFn();
        return {
            ecb: tables.ecb,
            vypoctovyZaklad: tables.vypoctovyZaklad,
            snapshoty: [
                tables.ecb.snapshot,
                tables.vypoctovyZaklad.snapshot,
                tables.rezimy.snapshot,
                tables.trovy.snapshot,
                tables.poplatky.snapshot,
                tables.exekucia.snapshot,
            ],
        };
    }));
}
//# sourceMappingURL=register.js.map