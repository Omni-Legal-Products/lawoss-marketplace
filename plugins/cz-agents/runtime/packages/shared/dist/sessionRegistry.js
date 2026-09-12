import { TtlMap } from './cache.js';
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 10_000;
/**
 * Retains MCP transports while clients reuse a session. Abandoned sessions are
 * closed after TTL; the hard cap prevents hostile session churn from retaining
 * SDK server state indefinitely.
 */
export function createSessionRegistry() {
    return new SessionRegistry({
        ttlMs: positiveEnv('MCP_SESSION_TTL_MS', DEFAULT_SESSION_TTL_MS),
        maxSize: positiveEnv('MCP_SESSION_MAX', DEFAULT_MAX_SESSIONS),
        sweepIntervalMs: 60_000,
        onEvict: (_id, transport) => {
            void transport.close().catch((err) => {
                console.error('[cz-agents/shared] failed to close evicted MCP transport:', err);
            });
        },
    });
}
class SessionRegistry extends TtlMap {
    get(id) {
        const transport = super.get(id);
        if (transport)
            this.set(id, transport);
        return transport;
    }
}
function positiveEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
//# sourceMappingURL=sessionRegistry.js.map