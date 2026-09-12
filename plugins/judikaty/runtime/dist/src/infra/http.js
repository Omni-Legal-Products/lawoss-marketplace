export class HttpError extends Error {
    status;
    url;
    bodyPreview;
    constructor(input) {
        super(`HTTP ${input.status} for ${input.url}`);
        this.name = "HttpError";
        this.status = input.status;
        this.url = input.url;
        this.bodyPreview = input.bodyPreview;
    }
}
export class EmptyResponseError extends Error {
    status;
    url;
    constructor(input) {
        super(`Empty response body (HTTP ${input.status}) for ${input.url}`);
        this.name = "EmptyResponseError";
        this.status = input.status;
        this.url = input.url;
    }
}
export async function fetchJson(input, init, options) {
    const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
    const initialDelayMs = Math.max(0, options?.initialDelayMs ?? 200);
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const response = await fetch(input, init);
            if (!response.ok) {
                const bodyPreview = await response.text();
                const error = new HttpError({
                    status: response.status,
                    url: response.url,
                    bodyPreview: bodyPreview.slice(0, 1000)
                });
                if (attempt < maxAttempts && isRetryableStatus(response.status)) {
                    await delay(computeBackoffDelayMs(initialDelayMs, attempt));
                    continue;
                }
                throw error;
            }
            if (response.status === 204) {
                throw new EmptyResponseError({ status: response.status, url: response.url });
            }
            try {
                return (await response.json());
            }
            catch (error) {
                if (error instanceof SyntaxError) {
                    throw new EmptyResponseError({ status: response.status, url: response.url });
                }
                throw error;
            }
        }
        catch (error) {
            lastError = error;
            if (attempt >= maxAttempts || !isRetryableFetchError(error)) {
                throw error;
            }
            await delay(computeBackoffDelayMs(initialDelayMs, attempt));
        }
    }
    throw lastError instanceof Error ? lastError : new Error("Unexpected fetchJson failure.");
}
function isRetryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}
function isRetryableFetchError(error) {
    if (error instanceof EmptyResponseError) {
        return false;
    }
    if (error instanceof HttpError) {
        return isRetryableStatus(error.status);
    }
    if (!(error instanceof Error)) {
        return false;
    }
    return error.name === "TypeError" || error.name === "AbortError";
}
function computeBackoffDelayMs(initialDelayMs, attempt) {
    return initialDelayMs * 2 ** (attempt - 1);
}
async function delay(ms) {
    if (ms <= 0) {
        return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=http.js.map