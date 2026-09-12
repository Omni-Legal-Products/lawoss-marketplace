import { buildTextWindow, downloadPdfToCache, extractPdfText, removeCachedPdf } from "../../infra/pdf.js";
import { EmptyResponseError, fetchJson } from "../../infra/http.js";
import { getDecisionCache } from "../../infra/decision-detail-cache.js";
import { UstavnyAccessTokenSchema, UstavnyCodelistResponseSchema, UstavnyContentResponseSchema, UstavnyDecisionItemSchema, UstavnySearchResponseSchema } from "./schemas.js";
const USTAVNY_BASE_URL = "https://www.ustavnysud.sk";
const USTAVNY_DOC_TYPE = "USSR_DECISION_MK";
const NEGATIVE_TOKEN_TTL_MS = 5 * 60 * 1000;
export class UstavnyDetailUnavailableError extends Error {
    documentId;
    constructor(documentId, cause) {
        super(`ÚS DMS details unavailable for document ${documentId}`);
        this.name = "UstavnyDetailUnavailableError";
        this.documentId = documentId;
        if (cause !== undefined) {
            this.cause = cause;
        }
    }
}
function buildSyntheticDecisionItem(documentId) {
    return UstavnyDecisionItemSchema.parse({ documentId });
}
function resolveUstavnyCredentials() {
    const clientId = process.env.USTAVNY_CLIENT_ID?.trim();
    const clientSecret = process.env.USTAVNY_CLIENT_SECRET?.trim();
    return clientId && clientSecret ? { clientId, clientSecret } : null;
}
export class UstavnyClient {
    #tokenCache = null;
    async searchDecisions(input) {
        const response = await this.#fetchAuthorizedJson(`${USTAVNY_BASE_URL}/o/v1/dms/search`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(buildSearchPayload(input))
        });
        return UstavnySearchResponseSchema.parse(response);
    }
    async getDecisionDetail(id) {
        return getDecisionCache("ustavny", "detail").getOrLoad(id, async () => {
            try {
                const response = await this.#fetchAuthorizedJson(`${USTAVNY_BASE_URL}/o/v1/dms/details`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        docId: id,
                        docType: USTAVNY_DOC_TYPE
                    })
                });
                return UstavnyDecisionItemSchema.parse(response);
            }
            catch (error) {
                if (error instanceof EmptyResponseError) {
                    throw new UstavnyDetailUnavailableError(id, error);
                }
                throw error;
            }
        });
    }
    async getDecisionContent(id) {
        const response = await this.#fetchAuthorizedJson(`${USTAVNY_BASE_URL}/o/v1/dms/content`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                highlightText: "",
                documentId: id,
                docType: USTAVNY_DOC_TYPE
            })
        });
        const parsed = UstavnyContentResponseSchema.parse(response);
        try {
            return Buffer.from(parsed.content, "base64").toString("utf-8");
        }
        catch {
            return null;
        }
    }
    async getDecisionWithContent(id) {
        let detail;
        let detailUnavailable = false;
        try {
            detail = await this.getDecisionDetail(id);
        }
        catch (error) {
            if (error instanceof UstavnyDetailUnavailableError) {
                detail = buildSyntheticDecisionItem(id);
                detailUnavailable = true;
            }
            else {
                throw error;
            }
        }
        try {
            const contentHtml = await this.getDecisionContent(id);
            const textContent = htmlToPlainText(contentHtml ?? "");
            if (textContent) {
                return {
                    detail,
                    textContent,
                    textSourceMode: "inline",
                    contentError: null,
                    detailUnavailable
                };
            }
        }
        catch (error) {
            const fallback = await this.#tryPdfTextFallback(id, detail, error);
            if (fallback) {
                return { ...fallback, detailUnavailable };
            }
            return {
                detail,
                textContent: null,
                textSourceMode: "none",
                contentError: error instanceof Error ? error.message : "Failed to load HTML content.",
                detailUnavailable
            };
        }
        const fallback = await this.#tryPdfTextFallback(id, detail, "HTML content was empty.");
        if (fallback) {
            return { ...fallback, detailUnavailable };
        }
        return {
            detail,
            textContent: null,
            textSourceMode: "none",
            contentError: "HTML content was empty.",
            detailUnavailable
        };
    }
    async resolveDecisionIdentity(input) {
        if (input.providerId) {
            return input.providerId;
        }
        const response = await this.searchDecisions({
            provider: "ustavny",
            ecli: input.ecli,
            spisovaZnacka: input.spisovaZnacka,
            limit: 1,
            offset: 0,
            view: "compact"
        });
        return response.documents[0]?.documentId ?? null;
    }
    async downloadDecisionDocument(input) {
        const detail = await this.getDecisionDetail(input.id);
        const documentUrl = buildUstavnyDocumentUrl(input.id);
        const downloaded = await downloadPdfToCache({
            provider: "ustavny",
            url: documentUrl,
            preferredFileName: buildUstavnyFileName(detail)
        });
        return {
            provider: "ustavny",
            id: input.id,
            fileName: buildUstavnyFileName(detail),
            contentType: "application/pdf",
            sourceUrl: documentUrl,
            savedPath: downloaded.savedPath,
            sizeBytes: detail.size ?? downloaded.sizeBytes
        };
    }
    async getDecisionText(input) {
        const resolved = await this.getDecisionWithContent(input.id);
        const text = resolved.textContent ?? "";
        return buildTextWindow({
            provider: "ustavny",
            id: input.id,
            text,
            offsetChars: input.offsetChars,
            maxChars: input.maxChars,
            sourceMode: resolved.textSourceMode === "pdf_extract" ? "pdf_extract" : "inline"
        });
    }
    async getProviderHealth() {
        try {
            const codelist = await this.#fetchAuthorizedJson(`${USTAVNY_BASE_URL}/o/v1/codelist/decision`);
            const parsed = UstavnyCodelistResponseSchema.parse(codelist);
            return {
                ok: Object.keys(parsed.codelist).length > 0,
                notes: [`OAuth and codelist endpoints reachable. codelists=${Object.keys(parsed.codelist).length}`]
            };
        }
        catch (error) {
            return {
                ok: false,
                notes: [error instanceof Error ? error.message : "Unknown provider health error."]
            };
        }
    }
    async #fetchAuthorizedJson(url, init) {
        const token = await this.#getAccessToken();
        const withAuth = (bearer) => {
            const headers = new Headers(init?.headers);
            if (bearer) {
                headers.set("Authorization", `Bearer ${bearer}`);
            }
            return { ...init, headers };
        };
        try {
            return await fetchJson(url, withAuth(token));
        }
        catch (error) {
            if (typeof error === "object" &&
                error !== null &&
                "status" in error &&
                error.status === 401) {
                this.#tokenCache = null;
                const refreshedToken = await this.#getAccessToken();
                return fetchJson(url, withAuth(refreshedToken));
            }
            throw error;
        }
    }
    async #tryPdfTextFallback(id, detail, reason) {
        try {
            const document = await this.downloadDecisionDocument({
                provider: "ustavny",
                id
            });
            if (!document.savedPath) {
                return null;
            }
            const textContent = await extractPdfText(document.savedPath);
            if (!textContent.trim()) {
                await removeCachedPdf(document.savedPath);
                return null;
            }
            await removeCachedPdf(document.savedPath);
            return {
                detail,
                textContent,
                textSourceMode: "pdf_extract",
                contentError: reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "HTML content was unavailable."
            };
        }
        catch {
            return null;
        }
    }
    async #getAccessToken() {
        if (this.#tokenCache && Date.now() < this.#tokenCache.expiresAt) {
            return this.#tokenCache.accessToken;
        }
        const credentials = resolveUstavnyCredentials();
        if (!credentials) {
            this.#tokenCache = { accessToken: null, expiresAt: Date.now() + NEGATIVE_TOKEN_TTL_MS };
            return null;
        }
        const { clientId, clientSecret } = credentials;
        const url = new URL(`${USTAVNY_BASE_URL}/o/oauth2/token`);
        url.searchParams.set("grant_type", "client_credentials");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("client_secret", clientSecret);
        try {
            const response = await fetchJson(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: "client_credentials"
                })
            });
            const parsed = UstavnyAccessTokenSchema.parse(response);
            this.#tokenCache = {
                accessToken: parsed.access_token,
                expiresAt: Date.now() + Math.max((parsed.expires_in ?? 3600) - 60, 60) * 1000
            };
            return parsed.access_token;
        }
        catch {
            // The ÚS DMS API currently accepts unauthenticated requests, so a dead
            // credential must not abort the run. Negative-cache the failure to avoid
            // hammering the token endpoint on every subsequent request.
            this.#tokenCache = { accessToken: null, expiresAt: Date.now() + NEGATIVE_TOKEN_TTL_MS };
            return null;
        }
    }
}
export function buildUstavnyDocumentUrl(id) {
    return `${USTAVNY_BASE_URL}/docDownload/${id}`;
}
function buildSearchPayload(input) {
    const filterNameValue = [];
    const sanitizedSpis = normalizeFileReference(input.spisovaZnacka);
    const sanitizedFileId = normalizeRegistryNumber(input.identifikacneCisloSpisu);
    if (input.query) {
        filterNameValue.push({
            type: "FULLTEXT",
            fieldValue: input.query
        });
    }
    if (sanitizedSpis) {
        filterNameValue.push({
            type: "STRING",
            fieldName: "mkRSAPNumberOfFileNorm",
            fieldValue: sanitizedSpis
        });
    }
    if (input.ecli) {
        filterNameValue.push({
            type: "STRING",
            fieldName: "mkECLI",
            fieldValue: input.ecli
        });
    }
    if (sanitizedFileId) {
        filterNameValue.push({
            type: "STRING",
            fieldName: "mkRVPNumberOfFile",
            fieldValue: sanitizedFileId
        });
    }
    if (input.decisionForm) {
        filterNameValue.push({
            type: "STRING",
            fieldName: "mkFormOfDecision",
            fieldValue: input.decisionForm
        });
    }
    if (input.decisionNature) {
        filterNameValue.push({
            type: "STRING",
            fieldName: "mkTypeOfDecision",
            fieldValue: input.decisionNature
        });
    }
    if (input.legalArea) {
        filterNameValue.push({
            type: "STRING",
            fieldName: "mkMaterialRegister",
            fieldValue: input.legalArea
        });
    }
    if (input.legalSubArea) {
        filterNameValue.push({
            type: "STRING",
            fieldName: "mkWordRegister",
            fieldValue: input.legalSubArea
        });
    }
    if (input.citedLaw) {
        filterNameValue.push({
            type: "STRING",
            fieldName: "mkComplainedLegalRegulation",
            fieldValue: input.citedLaw
        });
    }
    if (input.dateFrom || input.dateTo) {
        filterNameValue.push({
            type: "DATE_RANGE",
            fieldName: "mkDateOfDecision",
            fieldValue: {
                FROM: input.dateFrom ?? null,
                TO: input.dateTo ?? null
            }
        });
    }
    return {
        docType: USTAVNY_DOC_TYPE,
        start: input.offset,
        pageSize: input.limit,
        searchFilter: {
            filterNameValue
        },
        facetFilter: {
            facetFilterNameValue: []
        },
        facets: [
            "mkCause",
            "mkTypeOfProposer",
            "mkFormOfDecision",
            "mkDifferentView",
            "mkWordRegister",
            "mkDecisionInTermsOf",
            "mkTypeOfNegotiation",
            "mkTypeOfDecision"
        ],
        fieldsToReturn: [
            "id",
            "mkDocumentType",
            "mkRVPNumberOfFile",
            "mkRSAPNumberOfFile",
            "mkFileReference",
            "mkReferences",
            "mkClauseTitle",
            "mkClauseText",
            "mkIncludeToZnaU",
            "mkWebTitle",
            "mkArticle",
            "mkLetter",
            "mkClause",
            "objectTypeId",
            "mkECLI",
            "mkDateOfLegalForce",
            "mkPublicationDate",
            "mkDateOfDecision",
            "mkTypeOfProposer",
            "mkTypeOfProceeding",
            "mkFormOfDecision",
            "mkTypeOfDecision",
            "mkTypeOfNegotiation",
            "mkDecisionInTermsOf",
            "mkResultOfNegotiation",
            "mkCause",
            "mkWordRegister",
            "mkMaterialRegister",
            "mkComplainedLegalRegulation",
            "mkJudgeReporter",
            "mkDifferentView",
            "mkUnderage",
            "mkFileNumberOfDefendantProceeding"
        ],
        clustering: false
    };
}
function normalizeFileReference(value) {
    if (!value?.trim()) {
        return null;
    }
    return value
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[./]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
}
function normalizeRegistryNumber(value) {
    if (!value?.trim()) {
        return null;
    }
    return value.replace(/^RVP\s*/i, "").trim();
}
function buildUstavnyFileName(item) {
    return `${(item.mkRSAPNumberOfFile ?? "ustavny-rozhodnutie").replace(/[/:]+/g, "_")}.pdf`;
}
function htmlToPlainText(value) {
    return value
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
export const _UstavnyClientInternals = {
    buildSearchPayload,
    htmlToPlainText,
    normalizeFileReference,
    normalizeRegistryNumber,
    resolveUstavnyCredentials
};
//# sourceMappingURL=client.js.map