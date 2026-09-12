import { Agent, setGlobalDispatcher } from "undici";
let installed = false;
/**
 * Install a single keep-alive HTTP agent shared by every outbound fetch.
 *
 * Node's built-in fetch creates a fresh TCP+TLS connection per call by default.
 * Every NS SR / Ministry / Constitutional Court call we make pays that ~100-200 ms
 * handshake cost. A pooled agent with keep-alive eliminates almost all of it for
 * the common case where the indexer or a request hits the same host repeatedly.
 *
 * Safe to call more than once; tests that swap `globalThis.fetch` are not affected
 * because they replace the function entirely rather than using the dispatcher.
 */
export function ensureKeepAliveAgentInstalled() {
    if (installed)
        return;
    installed = true;
    const agent = new Agent({
        keepAliveTimeout: 30_000,
        keepAliveMaxTimeout: 60_000,
        connections: 32,
        pipelining: 1,
        // Generous request timeout; the existing fetchJson retry layer covers shorter cases.
        headersTimeout: 60_000,
        bodyTimeout: 120_000
    });
    setGlobalDispatcher(agent);
}
//# sourceMappingURL=fetch-agent.js.map