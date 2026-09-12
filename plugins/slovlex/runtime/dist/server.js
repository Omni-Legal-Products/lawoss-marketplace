import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import path from "node:path";
import { extractExplanatoryReportText, findLpCandidatesForLaw, getExplanatoryReportsByLp, getPortalHtml, getRecentPredpisy, getRozsireneByCislo, getRozsireneByIri, getVersionIriForDate, parseLawBaseIri, searchNavrhy, searchRozsirene, selectExplanatoryReport, chooseConfidentLpCandidate, } from "./slovlex.js";
import { formatReadMarkdownWindowResult, formatSavedMarkdownResult, readMarkdownFileWindow, resolveConfiguredExportRoot, writeMarkdownFile, } from "./export-files.js";
import { extractCrossLawReferences, extractFootnoteDefinitions, extractParagraphReferences, extractParagrafFromPortalHtml, renderParagraf, renderWholeLawTextChunk, resolveFootnoteReferences, sliceWindow, } from "./portal.js";
function textResult(text) {
    return { content: [{ type: "text", text }] };
}
function slug(input) {
    return input
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
}
const positiveInteger = () => z.coerce.number().int().min(1);
function dedupeCrossLawRefs(refs) {
    const seen = new Map();
    for (const ref of refs) {
        const key = `${ref.number}/${ref.year}#${ref.paragraph ?? ""}`;
        const existing = seen.get(key);
        if (!existing) {
            seen.set(key, ref);
            continue;
        }
        if (existing.source !== "alias" && ref.source === "alias") {
            seen.set(key, ref);
        }
    }
    return Array.from(seen.values());
}
function formatCrossLawRefNote(ref, reason) {
    const aliasLabel = ref.alias ? ` (${ref.alias})` : "";
    const para = ref.paragraph ? `§ ${ref.paragraph} ` : "";
    return `${para}zákona č. ${ref.number}/${ref.year}${aliasLabel} — ${reason}`;
}
async function fetchCrossLawParagraph(ref, date) {
    try {
        const baseIri = `/SK/ZZ/${ref.year}/${ref.number}`;
        const { versionIri, date: resolvedDate } = await getVersionIriForDate(baseIri, date);
        const portalHtml = await getPortalHtml(versionIri);
        const lawDoc = await getRozsireneByIri(versionIri).catch(() => null);
        const lawTitle = lawDoc?.nazov ?? `zákon č. ${ref.number}/${ref.year}`;
        const header = [
            `${ref.number}/${ref.year}${ref.paragraph ? ` – § ${ref.paragraph}` : ""} (k ${resolvedDate})`,
            ref.alias ? `Kódex: ${ref.alias}` : null,
            `Názov: ${lawTitle}`,
        ]
            .filter(Boolean)
            .join("\n");
        if (!ref.paragraph) {
            return `${header}\n(odkaz iba na celý zákon; pre konkrétny paragraf zavolaj get_paragraph)`;
        }
        const extracted = extractParagrafFromPortalHtml(portalHtml, ref.paragraph);
        if (!extracted) {
            return `${header}\n(§ ${ref.paragraph} sa v zákone nenašiel)`;
        }
        const text = renderParagraf(extracted.$, extracted.$par);
        return `${header}\n${text}`;
    }
    catch {
        return null;
    }
}
export function createSlovLexMcpServer() {
    const exportRoot = resolveConfiguredExportRoot(process.env);
    const server = new McpServer({
        name: "slov-lex-mcp",
        version: "1.3.1",
    });
    server.tool("get_law", "Získa základné informácie o zákone podľa čísla a roku (napr. 595/2003).", {
        number: z.string().describe("Číslo zákona"),
        year: z.string().describe("Rok vydania"),
    }, async ({ number, year }) => {
        const cislo = `${String(number).trim()}/${String(year).trim()}`;
        const doc = await getRozsireneByCislo(cislo);
        const out = [
            `${doc.cislo ?? cislo} - ${doc.nazov ?? ""}`.trim(),
            doc.typPredp_value ? `Typ: ${doc.typPredp_value}` : null,
            doc.vyhlaseny ? `Vyhlásené: ${doc.vyhlaseny}` : null,
            doc.ucinnyOd || doc.ucinnyDo
                ? `Účinnosť: ${doc.ucinnyOd ?? "?"} - ${doc.ucinnyDo ?? "?"}`
                : null,
            doc.iri ? `IRI: ${doc.iri}` : null,
            doc.nadpisy?.length
                ? `Nadpisy: ${doc.nadpisy.slice(0, 40).join(" | ")}${doc.nadpisy.length > 40 ? " | …" : ""}`
                : null,
        ]
            .filter(Boolean)
            .join("\n");
        return textResult(out);
    });
    server.tool("get_version", "Získa znenie zákona. DÔLEŽITÉ: Bez parametra 'date' vráti AKTUÁLNE platné znenie (k dnešnému dňu). Ak je text dlhý, vracia sa po oknách (offset_chars + max_chars). Keď je v hlavičke MCP_WINDOW_COMPLETE: false a potrebuješ úplné/komplexné posúdenie, zavolaj tool znova s offset_chars=MCP_NEXT_OFFSET.", {
        law: z.string().describe("Číslo zákona (napr. '595/2003') alebo IRI"),
        date: z.string().optional().describe("Dátum znenia YYYY-MM-DD. Bez tohto parametra = dnešný dátum. Pre historické prípady zadaj relevantný dátum (napr. '2023-12-31' pre rok 2023)."),
        max_chars: positiveInteger().optional().describe("Max počet znakov (default: 20000)"),
        offset_chars: z.number().int().min(0).optional().describe("Offset od ktorého sa má text vrátiť (default: 0)."),
    }, async ({ law, date, max_chars, offset_chars }) => {
        const { baseIri } = parseLawBaseIri(law);
        const { versionIri, date: resolvedDate } = await getVersionIriForDate(baseIri, date);
        const meta = await getRozsireneByIri(versionIri);
        const portalHtml = await getPortalHtml(versionIri);
        const maxChars = max_chars ?? 20_000;
        const offsetChars = offset_chars ?? 0;
        const rendered = renderWholeLawTextChunk(portalHtml, { maxChars, offsetChars });
        const windowEnd = rendered.offsetChars + rendered.returnedChars;
        const header = [
            `${law} – znenie k ${resolvedDate}`,
            meta.ucinnyOd || meta.ucinnyDo ? `Účinnosť: ${meta.ucinnyOd ?? "?"} - ${meta.ucinnyDo ?? "?"}` : null,
            `IRI: ${versionIri}`,
            `MCP_WINDOW_COMPLETE: ${rendered.hasMore ? "false" : "true"}`,
            `MCP_TOTAL_CHARS: ${rendered.totalChars}`,
            `MCP_RETURNED_CHARS: ${rendered.returnedChars}`,
            `Text window: ${rendered.offsetChars}-${windowEnd} / ${rendered.totalChars} chars`,
            rendered.hasMore ? `MCP_NEXT_OFFSET: ${windowEnd}` : `MCP_NEXT_OFFSET: none`,
            rendered.hasMore ? `POZOR: Toto je iba výrez dokumentu, nie celé znenie.` : null,
        ]
            .filter(Boolean)
            .join("\n");
        return textResult(`${header}\n\n${rendered.text}`);
    });
    server.tool("get_paragraph", "Získa konkrétny paragraf zo zákona. DÔLEŽITÉ: Bez parametra 'date' vráti AKTUÁLNE platné znenie (k dnešnému dňu). Pre historické prípady použi parameter 'date'. Predvolene zahrnie aj paragrafy, na ktoré sa text priamo odkazuje v rámci toho istého zákona. Voliteľne (include_cross_law_references=true) sleduje aj odkazy na iné zákony – inline (napr. „§ 5 zákona č. 461/2003 Z. z.“), kódexy (Zákonník práce, Občiansky zákonník, …) aj odkazy v poznámkach pod čiarou. Veľké paragrafy sa vracajú po oknách (offset_chars + max_chars). Keď je v hlavičke MCP_WINDOW_COMPLETE: false a potrebuješ celý text, zavolaj tool znova s offset_chars=MCP_NEXT_OFFSET.", {
        law: z.string().describe("Číslo zákona (napr. '595/2003') alebo IRI"),
        paragraph: z.string().describe("Číslo paragrafu (napr. '3' alebo '§3')"),
        date: z.string().optional().describe("Dátum znenia YYYY-MM-DD. Bez tohto parametra = dnešný dátum. Pre historické prípady zadaj relevantný dátum."),
        include_linked_paragraphs: z.boolean().optional().describe("Ak true (default), pridá aj paragrafy, na ktoré sa vyžiadaný paragraf priamo odkazuje v tom istom zákone."),
        include_cross_law_references: z.boolean().optional().describe("Ak true (default), pripojí aj relevantné paragrafy z INÝCH zákonov, na ktoré sa text/poznámky odkazujú."),
        max_linked_paragraphs: positiveInteger().max(20).optional().describe("Maximálny počet odkazov dohľadávaných v tom istom zákone (default: 8)."),
        max_cross_law_refs: positiveInteger().max(15).optional().describe("Maximálny počet odkazov dohľadávaných v iných zákonoch (default: 6)."),
        max_chars: positiveInteger().max(120000).optional().describe("Veľkosť okna v znakoch (default: 20000). Pre väčšie paragrafy stránkuj cez offset_chars namiesto zvyšovania tejto hodnoty."),
        offset_chars: z.number().int().min(0).optional().describe("Offset od ktorého sa má text vrátiť (default: 0). Použi MCP_NEXT_OFFSET z predchádzajúceho okna."),
    }, async ({ law, paragraph, date, include_linked_paragraphs, include_cross_law_references, max_linked_paragraphs, max_cross_law_refs, max_chars, offset_chars, }) => {
        const { baseIri, number: selfNumber, year: selfYear } = parseLawBaseIri(law);
        const { versionIri, date: resolvedDate } = await getVersionIriForDate(baseIri, date);
        const meta = await getRozsireneByIri(versionIri);
        const portalHtml = await getPortalHtml(versionIri);
        const includeLinkedParagraphs = include_linked_paragraphs ?? true;
        const includeCrossLaw = include_cross_law_references ?? true;
        const maxLinked = max_linked_paragraphs ?? 8;
        const maxCrossLaw = max_cross_law_refs ?? 6;
        const maxChars = max_chars ?? 20_000;
        const offsetChars = offset_chars ?? 0;
        const extracted = extractParagrafFromPortalHtml(portalHtml, paragraph);
        if (!extracted) {
            return textResult(`Nenašiel som ${paragraph} v ${law} (IRI: ${versionIri}).`);
        }
        const paraText = renderParagraf(extracted.$, extracted.$par);
        const requestedRef = paragraph.replace(/^§/i, "").trim();
        const linkedRefs = includeLinkedParagraphs
            ? extractParagraphReferences(paraText).filter((ref) => ref !== requestedRef)
            : [];
        const linkedSections = [];
        for (const ref of linkedRefs.slice(0, maxLinked)) {
            const linked = extractParagrafFromPortalHtml(portalHtml, ref);
            if (!linked)
                continue;
            linkedSections.push(renderParagraf(linked.$, linked.$par));
        }
        const crossLawSections = [];
        const crossLawNotes = [];
        if (includeCrossLaw) {
            const inlineRefs = extractCrossLawReferences(paraText);
            const footnotes = extractFootnoteDefinitions(portalHtml);
            const footnoteRefs = resolveFootnoteReferences(paraText, footnotes);
            const allRefs = dedupeCrossLawRefs([...inlineRefs, ...footnoteRefs].filter((r) => !(r.number === selfNumber && r.year === selfYear)));
            for (const ref of allRefs.slice(0, maxCrossLaw)) {
                const fetched = await fetchCrossLawParagraph(ref, date);
                if (!fetched) {
                    crossLawNotes.push(formatCrossLawRefNote(ref, "nepodarilo sa stiahnuť"));
                    continue;
                }
                crossLawSections.push(fetched);
            }
            if (allRefs.length > maxCrossLaw) {
                crossLawNotes.push(`… a ďalších ${allRefs.length - maxCrossLaw} odkazov (zvýš max_cross_law_refs alebo zavolaj get_paragraph pre konkrétny zákon).`);
            }
        }
        const header = [
            `${law} – ${paragraph} (k ${resolvedDate})`,
            meta.ucinnyOd || meta.ucinnyDo ? `Účinnosť: ${meta.ucinnyOd ?? "?"} - ${meta.ucinnyDo ?? "?"}` : null,
        ]
            .filter(Boolean)
            .join("\n");
        const sameLawBlock = linkedSections.length
            ? `\n\nSúvisiace odkazy v rámci rovnakého zákona:\n\n${linkedSections.join("\n\n")}`
            : "";
        const crossLawBlock = crossLawSections.length
            ? `\n\nSúvisiace odkazy z iných zákonov:\n\n${crossLawSections.join("\n\n")}`
            : "";
        const crossLawNoteBlock = crossLawNotes.length
            ? `\n\nPoznámky:\n${crossLawNotes.map((n) => `- ${n}`).join("\n")}`
            : "";
        const fullBody = `${paraText}${sameLawBlock}${crossLawBlock}${crossLawNoteBlock}`;
        const windowed = sliceWindow(fullBody, maxChars, offsetChars);
        const windowEnd = windowed.offsetChars + windowed.returnedChars;
        const windowHeader = [
            `MCP_WINDOW_COMPLETE: ${windowed.hasMore ? "false" : "true"}`,
            `MCP_TOTAL_CHARS: ${windowed.totalChars}`,
            `MCP_RETURNED_CHARS: ${windowed.returnedChars}`,
            `Text window: ${windowed.offsetChars}-${windowEnd} / ${windowed.totalChars} chars`,
            windowed.hasMore ? `MCP_NEXT_OFFSET: ${windowEnd}` : `MCP_NEXT_OFFSET: none`,
            windowed.hasMore
                ? `POZOR: Toto je iba výrez paragrafu (vrátane súvisiacich odkazov), nie celý text.`
                : null,
        ]
            .filter(Boolean)
            .join("\n");
        return textResult(`${header}\n${windowHeader}\n\n${windowed.text}`);
    });
    server.tool("search", "Vyhľadá zákony v Zbierke zákonov SR podľa kľúčových slov. Režim 'autocomplete' hľadá v názvoch zákonov (rýchle). Režim 'fulltext' hľadá aj v nadpisoch paragrafov (pomalšie, ale komplexnejšie).", {
        query: z.string().describe("Hľadaný výraz"),
        mode: z.enum(["autocomplete", "fulltext"]).optional().describe("Režim vyhľadávania: 'autocomplete' (default) = rýchle vyhľadávanie v názvoch, 'fulltext' = vyhľadávanie aj v nadpisoch paragrafov"),
        limit: positiveInteger().max(25).optional().describe("Max počet výsledkov (default: 10, max: 25)"),
    }, async ({ query, mode, limit }) => {
        const searchMode = mode ?? "autocomplete";
        const maxResults = limit ?? 10;
        if (searchMode === "fulltext") {
            const results = await searchRozsirene(query, maxResults);
            if (!results.length)
                return textResult("Bez výsledkov.");
            const out = results
                .map((r) => {
                const header = `${r.cislo ?? r.iri} - ${r.nazov ?? ""}`.trim();
                const matchingNadpisy = r.nadpisy?.filter((n) => n.toLowerCase().includes(query.toLowerCase()));
                const nadpisyInfo = matchingNadpisy?.length
                    ? `\nZhodné nadpisy: ${matchingNadpisy.slice(0, 5).join(", ")}${matchingNadpisy.length > 5 ? "..." : ""}`
                    : "";
                return `${header}${nadpisyInfo}\nIRI: ${r.iri}`;
            })
                .join("\n\n");
            return textResult(out);
        }
        const items = await searchNavrhy(query, maxResults);
        if (!items.length)
            return textResult("Bez výsledkov.");
        const out = items
            .map((i) => {
            const label = i.menovka ?? i.hodnotaPola ?? i.iri;
            const desc = i.popis ? ` - ${i.popis}` : "";
            return `${label}${desc}\nIRI: ${i.iri}`;
        })
            .join("\n\n");
        return textResult(out);
    });
    server.tool("get_explanatory_reports", "Voliteľne vyhľadá dôvodové správy (sprievodné dokumenty) v eLegislatíve. Lightweight režim: ide len o metadata + download URL, nesťahuje obsah dokumentov.", {
        lp: z.string().optional().describe("LP identifikátor (napr. 'LP/2025/50'). Najrýchlejšia voľba."),
        law: z
            .string()
            .optional()
            .describe("Zákon (napr. '595/2003' alebo IRI). Použi spolu s resolve_lp=true, ak LP nepoznáš."),
        resolve_lp: z
            .boolean()
            .optional()
            .describe("Ak je zadaný iba law, skúsi mapovanie zákon -> LP (pomalšie, default false)."),
        include_history: z
            .boolean()
            .optional()
            .describe("Ak true, zahrnie viac historických verzií dôvodoviek; inak len najnovšie reprezentatívne súbory."),
        max_results: positiveInteger().max(20).optional().describe("Max počet výsledkov (default: 6)."),
    }, async ({ lp, law, resolve_lp, include_history, max_results }) => {
        const includeHistory = include_history ?? false;
        const maxResults = max_results ?? 6;
        let resolvedLp = lp?.trim() ?? "";
        if (!resolvedLp) {
            if (!law?.trim()) {
                return textResult("Zadaj buď 'lp' (odporúčané), alebo 'law'.");
            }
            if (!resolve_lp) {
                return textResult(`Pre law=${law} je potrebné doplniť 'lp', alebo zavolať nástroj s resolve_lp=true (mapovanie zákon -> LP je pomalšie).`);
            }
            const candidates = await findLpCandidatesForLaw(law, 5);
            if (!candidates.length) {
                return textResult(`Nenašiel som LP kandidátov pre ${law}. Skús zadať LP priamo (napr. LP/2025/50).`);
            }
            const selected = chooseConfidentLpCandidate(candidates);
            if (!selected) {
                const ranked = candidates
                    .map((candidate, index) => `${index + 1}. ${candidate.lp} — skóre ${candidate.score}: ${candidate.title}`)
                    .join("\n");
                return textResult(`Mapovanie ${law} → LP nie je dostatočne jednoznačné. Vyber kandidáta explicitne cez 'lp'.\n\n${ranked}`);
            }
            resolvedLp = selected.lp;
        }
        const data = await getExplanatoryReportsByLp(resolvedLp, {
            includeHistory,
            maxResults,
        });
        if (!data.reports.length) {
            return textResult(`${data.lp} (${data.title ?? "bez názvu"})\nNenašli sa dôvodové správy.`);
        }
        const out = data.reports
            .map((r, idx) => {
            const type = r.typ ? ` (${r.typ})` : "";
            const meta = [
                r.category !== "ine" ? `časť: ${r.category}` : null,
                r.stage ? `štádium: ${r.stage}` : null,
                r.createdAt ? `vytvorené: ${r.createdAt}` : null,
                typeof r.sizeBytes === "number" ? `veľkosť: ${r.sizeBytes} B` : null,
            ]
                .filter(Boolean)
                .join(" | ");
            return `${idx + 1}. ${r.nazov}${type}\n${meta}\n${r.downloadUrl}`;
        })
            .join("\n\n");
        const header = [
            `LP: ${data.lp}`,
            data.title ? `Materiál: ${data.title}` : null,
            `Počet dôvodových správ: ${data.reports.length}`,
        ]
            .filter(Boolean)
            .join("\n");
        return textResult(`${header}\n\n${out}`);
    });
    server.tool("get_explanatory_report_text", "Stiahne a vyextrahuje text konkrétnej dôvodovej správy (DOCX/PDF). Ak je text dlhý, vracia sa po oknách (offset_chars + max_chars). Keď je v hlavičke MCP_WINDOW_COMPLETE: false a potrebuješ úplné/komplexné posúdenie, zavolaj tool znova s offset_chars=MCP_NEXT_OFFSET.", {
        document_uuid: z.string().optional().describe("UUID sprievodného dokumentu (najpresnejšie)."),
        lp: z.string().optional().describe("LP identifikátor (napr. LP/2025/50), ak document_uuid nepoznáš."),
        category: z
            .enum(["any", "vseobecna", "osobitna"])
            .optional()
            .describe("Preferovaná časť dôvodovej správy pri výbere cez LP (default: any)."),
        max_chars: positiveInteger().max(120000).optional().describe("Max počet znakov extrahovaného textu (default: 20000)."),
        offset_chars: z.number().int().min(0).optional().describe("Offset od ktorého sa má text vrátiť (default: 0)."),
    }, async ({ document_uuid, lp, category, max_chars, offset_chars }) => {
        const maxChars = max_chars ?? 20_000;
        const offsetChars = offset_chars ?? 0;
        let docUuid = document_uuid?.trim() ?? "";
        let sourceLp = lp?.trim() ?? "";
        const wantedCategory = category ?? "any";
        let resolvedCategory;
        if (!docUuid) {
            if (!sourceLp) {
                return textResult("Zadaj 'document_uuid' alebo 'lp'.");
            }
            const reports = await getExplanatoryReportsByLp(sourceLp, {
                includeHistory: true,
                maxResults: 20,
            });
            const selected = selectExplanatoryReport(reports.reports, wantedCategory);
            if (!selected) {
                return textResult(`Pre ${sourceLp} sa nenašli žiadne dôvodové správy.`);
            }
            docUuid = selected.uuid;
            sourceLp = reports.lp;
            resolvedCategory = selected.category;
        }
        const extracted = await extractExplanatoryReportText(docUuid, { maxChars, offsetChars });
        const windowEnd = extracted.offsetChars + extracted.returnedChars;
        const categoryNote = resolvedCategory && wantedCategory !== "any" && resolvedCategory !== wantedCategory
            ? ` (požadovaná časť '${wantedCategory}' nebola dostupná)`
            : "";
        const header = [
            `Document UUID: ${docUuid}`,
            sourceLp ? `LP: ${sourceLp}` : null,
            resolvedCategory ? `Časť: ${resolvedCategory}${categoryNote}` : null,
            extracted.fileName ? `Súbor: ${extracted.fileName}` : null,
            `Formát: ${extracted.format}`,
            `Download: ${extracted.downloadUrl}`,
            `MCP_WINDOW_COMPLETE: ${extracted.hasMore ? "false" : "true"}`,
            `MCP_TOTAL_CHARS: ${extracted.totalChars}`,
            `MCP_RETURNED_CHARS: ${extracted.returnedChars}`,
            `Text window: ${extracted.offsetChars}-${windowEnd} / ${extracted.totalChars} chars`,
            extracted.hasMore ? `MCP_NEXT_OFFSET: ${windowEnd}` : `MCP_NEXT_OFFSET: none`,
            extracted.hasMore ? `POZOR: Toto je iba výrez dokumentu, nie celý text dôvodovej správy.` : null,
        ]
            .filter(Boolean)
            .join("\n");
        return textResult(`${header}\n\n${extracted.text}`);
    });
    server.tool("save_law_markdown", "Uloží znenie zákona/vyhlášky k dátumu do Markdown súboru na filesystem servera.", {
        law: z.string().describe("Číslo zákona (napr. 595/2003) alebo IRI."),
        date: z.string().optional().describe("Dátum YYYY-MM-DD (default: dnes)."),
        max_chars: positiveInteger().max(300000).optional().describe("Max počet znakov textu (default: 50000)."),
        output_path: z.string().optional().describe("Cesta k výstupnému .md súboru na filesysteme servera (default: ./exports/laws/...)."),
    }, async ({ law, date, max_chars, output_path }) => {
        const { baseIri, number, year } = parseLawBaseIri(law);
        const { versionIri, date: resolvedDate } = await getVersionIriForDate(baseIri, date);
        const meta = await getRozsireneByIri(versionIri);
        const portalHtml = await getPortalHtml(versionIri);
        const maxChars = max_chars ?? 50_000;
        const rendered = renderWholeLawTextChunk(portalHtml, { maxChars, offsetChars: 0 });
        const fileBase = `${number}-${year}_${resolvedDate}`;
        const defaultPath = path.join(exportRoot ? "laws" : "exports/laws", `${slug(fileBase)}.md`);
        const savePath = output_path?.trim() || defaultPath;
        const bodyText = rendered.hasMore ? `${rendered.text}\n\n…(truncated to ${maxChars} chars)…` : rendered.text;
        const md = [
            `# ${law} - znenie k ${resolvedDate}`,
            "",
            `- IRI: \`${versionIri}\``,
            meta.nazov ? `- Názov: ${meta.nazov}` : null,
            meta.typPredp_value ? `- Typ: ${meta.typPredp_value}` : null,
            meta.ucinnyOd || meta.ucinnyDo ? `- Účinnosť: ${meta.ucinnyOd ?? "?"} - ${meta.ucinnyDo ?? "?"}` : null,
            rendered.hasMore ? `- Poznámka: text bol skrátený na ${maxChars} znakov` : null,
            "",
            "## Text predpisu",
            "",
            bodyText,
            "",
        ]
            .filter(Boolean)
            .join("\n");
        const abs = await writeMarkdownFile(md, savePath, process.cwd(), exportRoot);
        return textResult(formatSavedMarkdownResult({
            absPath: abs,
            sourceKind: "law",
            sourceRef: law,
            sourceDate: resolvedDate,
            totalChars: rendered.totalChars,
            savedChars: rendered.returnedChars,
            truncated: rendered.hasMore,
        }));
    });
    server.tool("save_explanatory_report_markdown", "Stiahne dôvodovú správu (DOCX/PDF), vyextrahuje text a uloží ju do Markdown súboru na filesystem servera.", {
        document_uuid: z.string().optional().describe("UUID sprievodného dokumentu (najpresnejšie)."),
        lp: z.string().optional().describe("LP identifikátor (napr. LP/2025/50), ak document_uuid nepoznáš."),
        category: z
            .enum(["any", "vseobecna", "osobitna"])
            .optional()
            .describe("Preferovaná časť dôvodovej správy pri výbere cez LP (default: any)."),
        max_chars: positiveInteger().max(120000).optional().describe("Max počet znakov extrahovaného textu (default: 30000)."),
        output_path: z.string().optional().describe("Cesta k výstupnému .md súboru na filesysteme servera (default: ./exports/explanatory/...)."),
    }, async ({ document_uuid, lp, category, max_chars, output_path }) => {
        const maxChars = max_chars ?? 30_000;
        const wantedCategory = category ?? "any";
        let docUuid = document_uuid?.trim() ?? "";
        let sourceLp = lp?.trim() ?? "";
        let resolvedCategory = wantedCategory;
        if (!docUuid) {
            if (!sourceLp) {
                return textResult("Zadaj 'document_uuid' alebo 'lp'.");
            }
            const reports = await getExplanatoryReportsByLp(sourceLp, {
                includeHistory: true,
                maxResults: 20,
            });
            const selected = selectExplanatoryReport(reports.reports, wantedCategory);
            if (!selected) {
                return textResult(`Pre ${sourceLp} sa nenašli žiadne dôvodové správy.`);
            }
            docUuid = selected.uuid;
            sourceLp = reports.lp;
            resolvedCategory = selected.category;
        }
        const extracted = await extractExplanatoryReportText(docUuid, { maxChars });
        const defaultName = sourceLp
            ? `${slug(sourceLp)}_${slug(resolvedCategory)}`
            : `${slug(docUuid)}_${slug(resolvedCategory)}`;
        const defaultPath = path.join(exportRoot ? "explanatory" : "exports/explanatory", `${defaultName}.md`);
        const savePath = output_path?.trim() || defaultPath;
        const md = [
            `# Dôvodová správa`,
            "",
            sourceLp ? `- LP: ${sourceLp}` : null,
            `- Document UUID: \`${docUuid}\``,
            extracted.fileName ? `- Súbor: ${extracted.fileName}` : null,
            `- Formát: ${extracted.format}`,
            `- Download: ${extracted.downloadUrl}`,
            `- Kategória: ${resolvedCategory}`,
            extracted.hasMore ? `- Poznámka: text bol skrátený na ${maxChars} znakov` : null,
            "",
            "## Extrahovaný text",
            "",
            extracted.text,
            "",
        ]
            .filter(Boolean)
            .join("\n");
        const abs = await writeMarkdownFile(md, savePath, process.cwd(), exportRoot);
        return textResult(formatSavedMarkdownResult({
            absPath: abs,
            sourceKind: "explanatory_report",
            sourceRef: sourceLp || docUuid,
            sourceCategory: resolvedCategory,
            totalChars: extracted.totalChars,
            savedChars: extracted.returnedChars,
            truncated: extracted.hasMore,
        }));
    });
    server.tool("read_saved_markdown", "Načíta okno z markdown súboru uloženého týmto serverom. Použi to, keď klient nevidí filesystem MCP servera.", {
        path: z.string().describe("Cesta k .md súboru na filesysteme servera."),
        max_chars: positiveInteger().max(300000).optional().describe("Max počet znakov (default: 20000)."),
        offset_chars: z.number().int().min(0).optional().describe("Offset od ktorého sa má text vrátiť (default: 0)."),
    }, async ({ path: filePath, max_chars, offset_chars }) => {
        const result = await readMarkdownFileWindow(filePath, {
            maxChars: max_chars,
            offsetChars: offset_chars,
            exportRoot,
        });
        return textResult(formatReadMarkdownWindowResult(result));
    });
    server.tool("get_recent", "Získa posledných 20 vyhlásených predpisov z RSS feedu Slov-Lex. POZOR: RSS feed obsahuje len 20 najnovších položiek, nie kompletný archív.", {}, async () => {
        const items = await getRecentPredpisy();
        if (!items.length)
            return textResult("RSS feed je prázdny.");
        const out = items
            .map((i, idx) => {
            const date = i.pubDate ? ` (${i.pubDate})` : "";
            const creator = i.creator ? `\nVydal: ${i.creator}` : "";
            return `${idx + 1}. ${i.cislo}${date}\n${i.nazov}${creator}\n${i.link}`;
        })
            .join("\n\n");
        return textResult(`Posledných 20 vyhlásených predpisov:\n\n${out}`);
    });
    return server;
}
