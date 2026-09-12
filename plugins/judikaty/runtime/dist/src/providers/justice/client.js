import { fetchJson } from "../../infra/http.js";
import { getDecisionCache } from "../../infra/decision-detail-cache.js";
import { normalizeLawReference } from "../../domain/slovlex.js";
import { buildTextWindow, downloadPdfToCache, extractPdfText, removeCachedPdf } from "../../infra/pdf.js";
import { DocumentUnavailableError } from "../../domain/errors.js";
import { JusticeCourtAutocompleteItemSchema, JusticeCourtDetailSchema, JusticeDecisionAutocompleteItemSchema, JusticeDecisionDetailSchema, JusticeDecisionListResponseSchema } from "./schemas.js";
const JUSTICE_BASE_URL = "https://obcan.justice.sk/pilot/api/ress-isu-service/v1";
export class JusticeClient {
    async searchDecisions(input) {
        const url = new URL(`${JUSTICE_BASE_URL}/rozhodnutie`);
        if (input.query)
            url.searchParams.set("query", input.query);
        if (input.courtType)
            url.searchParams.append("typSuduFacetFilter", input.courtType);
        if (input.legalArea) {
            url.searchParams.append("oblastPravnejUpravyFacetFilter", input.legalArea);
        }
        if (input.legalSubArea) {
            url.searchParams.append("podOblastPravnejUpravyFacetFilter", input.legalSubArea);
        }
        if (input.decisionForm) {
            url.searchParams.append("formaRozhodnutiaFacetFilter", input.decisionForm);
        }
        if (input.decisionNature) {
            url.searchParams.append("povahaRozhodnutiaFacetFilter", input.decisionNature);
        }
        if (input.citedLaw) {
            url.searchParams.append("odkazovanePredpisy", input.citedLaw);
        }
        if (input.dateFrom)
            url.searchParams.set("vydaniaOd", input.dateFrom);
        if (input.dateTo)
            url.searchParams.set("vydaniaDo", input.dateTo);
        if (input.ecli)
            url.searchParams.set("ecli", input.ecli);
        if (input.spisovaZnacka)
            url.searchParams.set("spisovaZnacka", input.spisovaZnacka);
        if (input.identifikacneCisloSpisu) {
            url.searchParams.set("cisloSpisu", input.identifikacneCisloSpisu);
        }
        if (input.courtId)
            url.searchParams.set("guidSud", input.courtId);
        if (input.offset)
            url.searchParams.set("page", String(Math.floor(input.offset / input.limit)));
        else
            url.searchParams.set("page", "0");
        url.searchParams.set("size", String(input.limit));
        const response = await fetchJson(url);
        return JusticeDecisionListResponseSchema.parse(response);
    }
    async getDecisionDetail(input) {
        return getDecisionCache("justice", "detail").getOrLoad(input.id, async () => {
            const url = new URL(`${JUSTICE_BASE_URL}/rozhodnutie/${input.id}`);
            const response = await fetchJson(url);
            return JusticeDecisionDetailSchema.parse(response);
        });
    }
    async autocompleteDecisions(input) {
        const url = new URL(`${JUSTICE_BASE_URL}/rozhodnutie/autocomplete`);
        url.searchParams.set("query", input.query);
        if (input.courtId)
            url.searchParams.set("guidSud", input.courtId);
        if (input.limit)
            url.searchParams.set("limit", String(input.limit));
        const response = await fetchJson(url);
        return JusticeDecisionAutocompleteItemSchema.array().parse(response);
    }
    async autocompleteCourts(input) {
        const seedQuery = input.query ?? input.courtType ?? input.region ?? input.district;
        if (!seedQuery) {
            return [];
        }
        const url = new URL(`${JUSTICE_BASE_URL}/sud/autocomplete`);
        url.searchParams.set("query", seedQuery);
        url.searchParams.set("limit", String(input.limit));
        const response = await fetchJson(url);
        return JusticeCourtAutocompleteItemSchema.array().parse(response);
    }
    async getCourtDetail(id) {
        const url = new URL(`${JUSTICE_BASE_URL}/sud/${id}`);
        const response = await fetchJson(url);
        return JusticeCourtDetailSchema.parse(response);
    }
    async findDecisionsByLaw(input) {
        const normalized = normalizeLawReference(input.paragraph ? { law: input.law, paragraph: input.paragraph } : { law: input.law });
        return this.searchDecisions({
            provider: "justice",
            query: normalized.searchToken ? undefined : input.law,
            courtId: undefined,
            courtType: undefined,
            courtName: undefined,
            ecli: undefined,
            spisovaZnacka: undefined,
            identifikacneCisloSpisu: undefined,
            dateFrom: undefined,
            dateTo: undefined,
            legalArea: undefined,
            legalSubArea: undefined,
            decisionForm: undefined,
            decisionNature: undefined,
            citedLaw: normalized.searchToken ?? undefined,
            limit: input.limit,
            offset: input.offset,
            view: input.view
        });
    }
    async getProviderHealth() {
        try {
            const response = await this.searchDecisions({
                provider: "justice",
                limit: 1,
                offset: 0,
                view: "compact"
            });
            return {
                ok: response.numFound >= 0,
                notes: [`Live search reachable. numFound=${response.numFound}`]
            };
        }
        catch (error) {
            return {
                ok: false,
                notes: [error instanceof Error ? error.message : "Unknown provider health error."]
            };
        }
    }
    async downloadDecisionDocument(input) {
        const detail = await this.getDecisionDetail({ id: input.id });
        const documentUrl = detail.dokument?.url;
        if (!documentUrl) {
            throw new DocumentUnavailableError(input.id);
        }
        const downloaded = await downloadPdfToCache({
            provider: "justice",
            url: documentUrl,
            preferredFileName: detail.dokument?.name ?? "decision.pdf"
        });
        return {
            provider: "justice",
            id: input.id,
            fileName: detail.dokument?.name ?? null,
            contentType: detail.dokument?.fileExtension
                ? `application/${detail.dokument.fileExtension.toLowerCase()}`
                : "application/pdf",
            sourceUrl: documentUrl,
            savedPath: downloaded.savedPath,
            sizeBytes: detail.dokument?.size ?? downloaded.sizeBytes
        };
    }
    async getDecisionText(input) {
        const downloaded = await this.downloadDecisionDocument({
            provider: "justice",
            id: input.id
        });
        if (!downloaded.savedPath) {
            throw new DocumentUnavailableError(input.id);
        }
        // Delete the PDF once its text is out, the way the NS and ÚS clients already do.
        // This was missing here, and the nightly disposition enricher reads up to 3,000
        // justice PDFs a night — 85,744 files and 6.44 GB had accumulated by 2026-08-04.
        // `download_decision_document` deliberately keeps its file; only this path, which
        // exists purely to get at the text, cleans up.
        let text;
        try {
            text = await extractPdfText(downloaded.savedPath);
        }
        finally {
            await removeCachedPdf(downloaded.savedPath);
        }
        return buildTextWindow({
            provider: "justice",
            id: input.id,
            text,
            offsetChars: input.offsetChars,
            maxChars: input.maxChars,
            sourceMode: "pdf_extract"
        });
    }
}
//# sourceMappingURL=client.js.map