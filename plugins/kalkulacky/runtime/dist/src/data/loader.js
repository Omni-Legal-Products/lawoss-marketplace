// Overlay-first loader: číta zákonné parametre z repo (data/*.json), voliteľne
// prekryté novším "overlay" adresárom (napr. výsledok scripts/refresh-rates.ts).
// fs patrí VÝHRADNE sem — schemas.ts aj domain/ sú bez fs.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ecbMainRateFileSchema, vypoctovyZakladFileSchema, rezimyUrokovFileSchema, trovyFileSchema, sudnePoplatkyFileSchema, exekuciaFileSchema, } from "./schemas.js";
import { CalcError } from "../domain/errors.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
/** Marker file used to recognize the repo's data/ directory while walking up from __dirname. */
const REPO_MARKER_FILE = "ecb-main-rate.json";
const MAX_WALK_UP = 6;
/**
 * Nájde predvolený `data/` adresár chôdzou nahor od `fromDir`, kým nenarazí na
 * `data/ecb-main-rate.json`. Funguje pre viacero build layoutov bez toho, aby
 * bol naviazaný na konkrétny počet úrovní:
 *  - dev/test (tsx, vitest): src/data/loader.ts -> ../../data
 *  - compiled build (tsc -p tsconfig.build.json, rootDir="."): dist/src/data/loader.js -> ../../data
 * Bounded na MAX_WALK_UP úrovní, aby v prípade chyby zlyhalo rýchlo a jasne
 * namiesto tichého prehľadávania celého súborového systému.
 */
export function resolveDefaultRepoDir(fromDir) {
    let dir = fromDir;
    for (let i = 0; i <= MAX_WALK_UP; i++) {
        const candidateDir = join(dir, "data");
        if (existsSync(join(candidateDir, REPO_MARKER_FILE)))
            return candidateDir;
        const parent = dirname(dir);
        if (parent === dir)
            break; // dosiahnutý koreň filesystemu
        dir = parent;
    }
    throw new CalcError(`Nepodarilo sa nájsť adresár "data/" (hľadaný marker "${REPO_MARKER_FILE}") chôdzou nahor od "${fromDir}" (max ${MAX_WALK_UP} úrovní). Zadaj repoDir explicitne.`, "REPO_DIR_NOT_FOUND");
}
const specs = {
    ecb: { file: "ecb-main-rate.json", schema: ecbMainRateFileSchema, freshnessKey: (d) => d.coverage.to },
    vypoctovyZaklad: { file: "vypoctovy-zaklad.json", schema: vypoctovyZakladFileSchema, freshnessKey: (d) => d.version },
    rezimy: { file: "rezimy-urokov.json", schema: rezimyUrokovFileSchema, freshnessKey: (d) => d.version },
    trovy: { file: "trovy.json", schema: trovyFileSchema, freshnessKey: (d) => d.version },
    poplatky: { file: "sudne-poplatky.json", schema: sudnePoplatkyFileSchema, freshnessKey: (d) => d.version },
    exekucia: { file: "exekucia.json", schema: exekuciaFileSchema, freshnessKey: (d) => d.version },
};
/**
 * Filenames of all data files loadTables() reads (repo + optional overlay).
 * Derived from `specs` so a future 7th data file is picked up automatically
 * by anything that watches for changes (see src/data/tables-cache.ts) —
 * no hand-kept duplicate list to fall out of sync.
 */
export const DATA_FILE_NAMES = Object.values(specs).map((spec) => spec.file);
function readAndParseJson(path) {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw);
}
/** Načíta a zvaliduje povinný repo súbor. Nesprávny JSON alebo schéma → throw. */
function loadRepo(repoDir, spec) {
    const path = join(repoDir, spec.file);
    let json;
    try {
        json = readAndParseJson(path);
    }
    catch (err) {
        throw new CalcError(`Repo dáta "${spec.file}" sa nepodarilo prečítať/parsovať: ${err.message}`, "REPO_DATA_INVALID");
    }
    const result = spec.schema.safeParse(json);
    if (!result.success) {
        throw new CalcError(`Repo dáta "${spec.file}" nevyhoveli schéme: ${result.error.message}`, "REPO_DATA_INVALID");
    }
    return result.data;
}
/**
 * Načíta voliteľný overlay súbor. Chýbajúci súbor → null, ticho (žiadny warning).
 * Nesprávny JSON alebo neplatná schéma → warning + null (fallback na repo).
 */
function loadOverlay(overlayDir, spec) {
    const path = join(overlayDir, spec.file);
    if (!existsSync(path))
        return null;
    let json;
    try {
        json = readAndParseJson(path);
    }
    catch (err) {
        console.warn(`[data/loader] overlay "${spec.file}" má neplatný JSON, fallback na repo: ${err.message}`);
        return null;
    }
    const result = spec.schema.safeParse(json);
    if (!result.success) {
        console.warn(`[data/loader] overlay "${spec.file}" nevyhovel schéme, fallback na repo: ${result.error.message}`);
        return null;
    }
    return result.data;
}
function loadOne(spec, repoDir, overlayDir) {
    const repoData = loadRepo(repoDir, spec);
    const overlayData = overlayDir ? loadOverlay(overlayDir, spec) : null;
    let data = repoData;
    let zdroj = "repo";
    if (overlayData && spec.freshnessKey(overlayData) > spec.freshnessKey(repoData)) {
        data = overlayData;
        zdroj = "overlay";
    }
    const snapshot = {
        file: spec.file,
        version: data.version,
        source: data.source,
        zdroj,
        ...(data.fetchedAt !== undefined ? { fetchedAt: data.fetchedAt } : {}),
    };
    return { data, snapshot };
}
export function loadTables(opts = {}) {
    const repoDir = opts.repoDir ?? resolveDefaultRepoDir(__dirname);
    const overlayDir = opts.overlayDir !== undefined ? opts.overlayDir : process.env["DATA_OVERLAY_DIR"] ?? null;
    const ecb = loadOne(specs.ecb, repoDir, overlayDir);
    const vypoctovyZaklad = loadOne(specs.vypoctovyZaklad, repoDir, overlayDir);
    const rezimy = loadOne(specs.rezimy, repoDir, overlayDir);
    const trovy = loadOne(specs.trovy, repoDir, overlayDir);
    const poplatky = loadOne(specs.poplatky, repoDir, overlayDir);
    const exekucia = loadOne(specs.exekucia, repoDir, overlayDir);
    return {
        ecb: { entries: ecb.data.entries, coverage: ecb.data.coverage, snapshot: ecb.snapshot },
        vypoctovyZaklad: {
            years: vypoctovyZaklad.data.years,
            ...(vypoctovyZaklad.data.trestne !== undefined ? { trestne: vypoctovyZaklad.data.trestne } : {}),
            snapshot: vypoctovyZaklad.snapshot,
        },
        rezimy: { ...rezimy.data, snapshot: rezimy.snapshot },
        trovy: { ...trovy.data, snapshot: trovy.snapshot },
        poplatky: { ...poplatky.data, snapshot: poplatky.snapshot },
        exekucia: { ...exekucia.data, snapshot: exekucia.snapshot },
    };
}
//# sourceMappingURL=loader.js.map