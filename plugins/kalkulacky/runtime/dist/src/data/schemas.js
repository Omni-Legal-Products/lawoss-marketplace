// Zod schémy pre dátové súbory v data/*.json. Zrkadlia REÁLNE súbory (Task 2),
// nie draft schémy z briefu — pozri task-2-report.md, sekcia "Nezverejnená zmena typu".
//
// Táto vrstva neimportuje fs ani MCP SDK — iba čistá validácia (zod). fs patrí
// výhradne do src/data/loader.ts.
import { z } from "zod";
// ---------------------------------------------------------------------------
// ecb-main-rate.json
// ---------------------------------------------------------------------------
export const ecbEntrySchema = z
    .object({
    from: z.string(),
    rate: z.number(),
})
    .passthrough();
export const ecbMainRateFileSchema = z
    .object({
    version: z.string(),
    fetchedAt: z.string().optional(),
    source: z.string(),
    sourceSecondary: z.string().optional(),
    coverage: z.object({ from: z.string(), to: z.string() }),
    entries: z.array(ecbEntrySchema).min(1),
})
    .passthrough();
// ---------------------------------------------------------------------------
// vypoctovy-zaklad.json
// ---------------------------------------------------------------------------
const trestneSchema = z
    .object({ _comment: z.string().optional() })
    .catchall(z.number());
export const vypoctovyZakladFileSchema = z
    .object({
    version: z.string(),
    fetchedAt: z.string().optional(),
    source: z.string(),
    sourceSecondary: z.string().optional(),
    definicia: z.string().optional(),
    years: z.record(z.string(), z.number()),
    trestne: trestneSchema.optional(),
})
    .passthrough();
// ---------------------------------------------------------------------------
// rezimy-urokov.json
// ---------------------------------------------------------------------------
const sposobSchema = z
    .object({
    spread: z.number(),
    fixacia: z.string(),
    zaklad: z.string(),
    podmienka: z.string().optional(),
})
    .passthrough();
const sposobySchema = z
    .object({
    fixny: sposobSchema.optional(),
    variabilny: sposobSchema.optional(),
})
    .passthrough()
    .refine((s) => s.fixny !== undefined || s.variabilny !== undefined, {
    message: "sposoby musí obsahovať aspoň fixny alebo variabilny",
});
const rezimZaznamSchema = z
    .object({
    from: z.string(),
    to: z.string().nullable(),
    kriterium: z.object({
        from: z.string(),
        to: z.string().nullable(),
    }),
    rozhodujucaSkutocnost: z.enum(["vznikZavazku", "vznikOmeskania"]),
    sposoby: sposobySchema,
    zaklad: z.string(),
    kriteriumZaklad: z.string(),
})
    .passthrough();
export const rezimyUrokovFileSchema = z
    .object({
    version: z.string(),
    fetchedAt: z.string().optional(),
    source: z.string(),
    coverageFrom: z.string(),
    rozhodujucaSkutocnost: z.record(z.string(), z.string()),
    dennyZakladVypoctu: z
        .object({
        konvencia: z.string(),
        urokPlynieOd: z.string(),
    })
        .passthrough(),
    obcianske: z.array(rezimZaznamSchema).min(1),
    obchodne: z.array(rezimZaznamSchema).min(1),
    pausalnaNahradaNakladov: z
        .object({
        suma: z.number(),
        jednorazovo: z.boolean(),
        zaklad: z.string(),
    })
        .passthrough(),
    poplatokZOmeskania: z
        .object({
        dennaSadzba: z.number(),
        minZaMesiac: z.number(),
        zaklad: z.string(),
    })
        .passthrough(),
    vyberZaznamu: z.string(),
})
    .passthrough();
// ---------------------------------------------------------------------------
// trovy.json
// ---------------------------------------------------------------------------
const pasmoKrokSchema = z
    .object({
    za: z.number(),
    suma: z.number(),
    prevysujucichSumu: z.number(),
})
    .passthrough();
const pasmoSchema = z
    .object({
    nad: z.number(),
    do: z.number().nullable(),
    zaklad: z.number(),
    krok: pasmoKrokSchema.nullable(),
})
    .passthrough();
const ukonySchema = z
    .object({
    podiel: z.string(),
    zaklad: z.string(),
    polozky: z.array(z.string()),
})
    .passthrough();
export const trovyFileSchema = z
    .object({
    version: z.string(),
    fetchedAt: z.string().optional(),
    source: z.string(),
    pasma: z.array(pasmoSchema).min(1),
    nevycislitelnaPodiel: z.string(),
    nevycislitelna: z
        .object({
        podiel: z.string(),
        zaklad: z.string(),
        pripady: z.array(z.string()),
    })
        .passthrough(),
    inePodiely: z.array(z.object({ podiel: z.string(), pripad: z.string(), zaklad: z.string() }).passthrough()),
    rezijnyPausalPodiel: z.string(),
    rezijnyPausal: z
        .object({
        podiel: z.string(),
        zaZaklad: z.string(),
        zaKazdy: z.string(),
        zaklad: z.string(),
    })
        .passthrough(),
    nahradaZaStratuCasu: z
        .object({
        podiel: z.string(),
        zaKazdu: z.string(),
        zaklad: z.string(),
    })
        .passthrough(),
    plneUkony: z
        .object({
        zaklad: z.string(),
        polozky: z.array(z.string()),
    })
        .passthrough(),
    polovicneUkony: ukonySchema,
    stvrtinoveUkony: ukonySchema,
    tarifnaHodnotaOsobitne: z.array(z.object({ pripad: z.string(), hodnota: z.string(), zaklad: z.string() }).passthrough()),
    dph: z.number(),
    dphHistoria: z.array(z
        .object({ from: z.string(), to: z.string().nullable(), sadzba: z.number() })
        .passthrough()),
    dphZaklad: z.string(),
})
    .passthrough();
// ---------------------------------------------------------------------------
// sudne-poplatky.json
// ---------------------------------------------------------------------------
const vypocetSchema = z.discriminatedUnion("typ", [
    z
        .object({
        typ: z.literal("percento"),
        sadzba: z.number(),
        sadzbaZmier: z.number().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        maxObchodne: z.number().optional(),
    })
        .passthrough(),
    z
        .object({
        typ: z.literal("pevnaSuma"),
        suma: z.number(),
    })
        .passthrough(),
]);
const polozkaSchema = z
    .object({
    id: z.string(),
    nazov: z.string(),
    vypocet: vypocetSchema,
    citacia: z.string(),
    /** § 6 ods. 5 zák. 71/1992 Zb.: pri tejto položke sa zľava za e-podanie
     *  (§ 6 ods. 3) NEUPLATNÍ (exekučné konanie, obchodný register).
     *  Neprítomné pole = false (zľava sa uplatňuje bežne). */
    epodanieVylucene: z.boolean().optional(),
})
    .passthrough();
export const sudnePoplatkyFileSchema = z
    .object({
    version: z.string(),
    fetchedAt: z.string().optional(),
    source: z.string(),
    zaklad: z
        .object({ zaokruhlenie: z.string(), zaklad: z.string() })
        .passthrough(),
    zaokruhleniePoplatku: z
        .object({ pravidlo: z.string(), zaklad: z.string() })
        .passthrough(),
    epodanie: z
        .object({
        zlava: z.number(),
        maxZlava: z.number(),
        zaklad: z.string(),
        vypocet: z.string(),
        podmienky: z.array(z.string()),
        neuplatniSa: z.array(z.string()),
    })
        .passthrough(),
    instancie: z.record(z.string(), z.object({ nasobok: z.number(), zaklad: z.string() }).passthrough()),
    polozky: z.array(polozkaSchema).min(1),
    neoverene: z.array(z.string()).optional(),
})
    .passthrough();
// ---------------------------------------------------------------------------
// exekucia.json
// ---------------------------------------------------------------------------
export const exekuciaFileSchema = z
    .object({
    version: z.string(),
    fetchedAt: z.string().optional(),
    source: z.string(),
    penazne: z
        .object({
        sadzba: z.number(),
        min: z.number().nullable(),
        max: z.number(),
        zaklad: z.string(),
        zakladSadzby: z.string(),
        zakladMax: z.string(),
    })
        .passthrough(),
    dalsiLimitOdmeny: z
        .object({ pravidlo: z.string(), zaklad: z.string() })
        .passthrough(),
    splnenieVLehote: z
        .object({
        sadzba: z.number(),
        pausalneVydavkyPodiel: z.number(),
        podmienka: z.string(),
        zaklad: z.string(),
        nepenazne: z
            .object({ podiel: z.number(), zaklad: z.string() })
            .passthrough(),
    })
        .passthrough(),
    zastavenie: z
        .object({
        penazne: z
            .object({
            odmena: z.string(),
            pausalneVydavkyPodiel: z.number(),
            zaklad: z.string(),
        })
            .passthrough(),
    })
        .passthrough(),
    pausalneVydavky: z
        .object({
        suma: z.number(),
        polovicnyPodiel: z.number(),
        podlaObdobia: z.array(z
            .object({
            zacatieKonaniaOd: z.string(),
            zacatieKonaniaDo: z.string().nullable(),
            suma: z.number(),
        })
            .passthrough()),
        vypocet: z.string(),
        zaklad: z.string(),
        zahrnuje: z.array(z.string()),
        zakladZahrnuje: z.string(),
    })
        .passthrough(),
    zaokruhlovanie: z
        .object({
        zaklad: z.string(),
        odmena: z.string(),
        pravnyZaklad: z.string(),
    })
        .passthrough(),
    dph: z
        .object({ uplatniSa: z.string(), sadzba: z.number(), zaklad: z.string() })
        .passthrough(),
    ineOdmeny: z.array(z
        .object({
        id: z.string(),
        suma: z.number(),
        nazov: z.string(),
        zaklad: z.string(),
        sumaVyzivneAleboOslobodeny: z.number().optional(),
        dodatok: z.string().optional(),
    })
        .passthrough()),
    konverzia: z
        .object({
        zaSkenovanuStranu: z.number(),
        zaDokument: z.number(),
        zaklad: z.string(),
    })
        .passthrough(),
    historia: z
        .object({
        pausalneVydavky: z.string(),
        prechodneUstanovenia: z.array(z.string()),
    })
        .passthrough(),
    neoverene: z.array(z.string()).optional(),
})
    .passthrough();
//# sourceMappingURL=schemas.js.map