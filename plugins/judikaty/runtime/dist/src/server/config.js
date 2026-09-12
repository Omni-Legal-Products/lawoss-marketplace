import * as z from "zod/v4";
import { isCanonicalIssuerUrl, isValidOAuthScope } from "./oauth-validation.js";
import { parseTrustedProxyCidrs } from "./trusted-proxy.js";
const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1 MiB
const DEFAULT_RATE_LIMIT_RPM = 120;
const DEFAULT_RATE_LIMIT_BURST = 30;
const DEFAULT_QUERY_TIMEOUT_MS = 20_000;
const DEFAULT_WATCHDOG_STALL_MS = 45_000;
const DEFAULT_QUERY_POOL_SIZE = 2;
const DEFAULT_MAX_DYNAMIC_CLIENTS = 256;
const DEFAULT_DYNAMIC_CLIENT_TTL_SECONDS = 2_592_000;
const DEFAULT_UNUSED_CLIENT_TTL_SECONDS = 3_600;
const DEFAULT_MAX_CLIENTS_PER_IDENTITY = 8;
const DEFAULT_READINESS_CHECK_INTERVAL_SECONDS = 30;
const DEFAULT_MAX_LIVE_GRANTS = 512;
const DEFAULT_MAX_LIVE_GRANTS_PER_CLIENT = 16;
const positiveInt = z.preprocess((value) => {
    if (value === undefined || value === "")
        return undefined;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}, z.number().int().min(0).optional());
const strictlyPositiveInt = z.preprocess((value) => {
    if (value === undefined || value === "")
        return undefined;
    return typeof value === "number" ? value : Number(value);
}, z.number().int().positive().optional());
const grantLimit = strictlyPositiveInt.refine((value) => value === undefined || value >= 2, "OAuth live grant limits must be at least 2.");
const ApplicationServerConfigSchema = z.object({
    name: z.string().default("slovak-judiciary"),
    version: z.string().default("0.1.0"),
    authMode: z.literal("oauth").default("oauth"),
    maxBodyBytes: positiveInt.transform((value) => value ?? DEFAULT_MAX_BODY_BYTES),
    rateLimitPerMinute: positiveInt.transform((value) => value ?? DEFAULT_RATE_LIMIT_RPM),
    rateLimitBurst: positiveInt.transform((value) => value ?? DEFAULT_RATE_LIMIT_BURST),
    /**
     * Hard ceiling for a single offloaded full-text query. A query that overruns
     * is cancelled by terminating the worker thread, so the request fails instead
     * of pinning a thread indefinitely.
     */
    queryTimeoutMs: positiveInt.transform((value) => value ?? DEFAULT_QUERY_TIMEOUT_MS),
    /** Worker threads serving offloaded queries. search_decision_text issues two at once. */
    queryPoolSize: positiveInt.transform((value) => value ?? DEFAULT_QUERY_POOL_SIZE),
    /** Kill-and-restart threshold for a stalled event loop; 0 disables the watchdog. */
    watchdogStallMs: positiveInt.transform((value) => value ?? DEFAULT_WATCHDOG_STALL_MS),
    oauthIssuerUrl: z.string().url().refine((value) => isCanonicalIssuerUrl(value), "OAUTH_ISSUER_URL must be a canonical HTTPS origin without credentials, path, query or fragment.").optional(),
    oauthTokenStorePath: z.string().min(1).optional(),
    oauthAuthorizationPassword: z.string().optional(),
    oauthAccessTokenTtlSeconds: positiveInt.transform((value) => value ?? 3600),
    oauthRefreshTokenTtlSeconds: positiveInt.transform((value) => value ?? 15_552_000),
    oauthAuthorizationCodeTtlSeconds: positiveInt.transform((value) => value ?? 300),
    oauthLoginSessionTtlSeconds: positiveInt.transform((value) => value ?? 86_400),
    oauthScopes: z.string().default("mcp:tools").refine((value) => { const scopes = value.split(/\s+/).filter(Boolean); return scopes.includes("mcp:tools") && new Set(scopes).size === scopes.length && scopes.every(isValidOAuthScope); }, "OAUTH_SCOPES must contain unique valid scopes and include mcp:tools."),
    oauthEnableDynamicClientRegistration: z.preprocess((value) => typeof value === "string" ? value.toLowerCase() === "true" : value, z.boolean().default(true)),
    oauthMaxDynamicClients: strictlyPositiveInt.transform((value) => value ?? DEFAULT_MAX_DYNAMIC_CLIENTS),
    oauthDynamicClientTtlSeconds: strictlyPositiveInt.transform((value) => value ?? DEFAULT_DYNAMIC_CLIENT_TTL_SECONDS),
    oauthUnusedClientTtlSeconds: strictlyPositiveInt.transform((value) => value ?? DEFAULT_UNUSED_CLIENT_TTL_SECONDS),
    oauthMaxClientsPerIdentity: strictlyPositiveInt.transform((value) => value ?? DEFAULT_MAX_CLIENTS_PER_IDENTITY),
    oauthReadinessCheckIntervalSeconds: strictlyPositiveInt.transform((value) => value ?? DEFAULT_READINESS_CHECK_INTERVAL_SECONDS),
    oauthMaxLiveGrants: grantLimit.transform((value) => value ?? DEFAULT_MAX_LIVE_GRANTS),
    oauthMaxLiveGrantsPerClient: grantLimit.transform((value) => value ?? DEFAULT_MAX_LIVE_GRANTS_PER_CLIENT),
    trustedProxyCidrs: z.string().default("").refine((value) => { try {
        parseTrustedProxyCidrs(value);
        return true;
    }
    catch {
        return false;
    } }, "TRUSTED_PROXY_CIDRS must contain valid IP/CIDR entries.")
});
export const ServerConfigSchema = ApplicationServerConfigSchema
    .refine((value) => value.authMode !== "oauth" || Boolean(value.oauthTokenStorePath), { message: "OAUTH_TOKEN_STORE_PATH is required when MCP_AUTH_MODE=oauth.", path: ["oauthTokenStorePath"] })
    .refine((value) => value.authMode !== "oauth" || Boolean(value.oauthIssuerUrl), { message: "OAUTH_ISSUER_URL is required when MCP_AUTH_MODE=oauth.", path: ["oauthIssuerUrl"] })
    .refine((value) => value.authMode !== "oauth" || (value.oauthAuthorizationPassword?.length ?? 0) >= 16, { message: "OAUTH_AUTHORIZATION_PASSWORD must contain at least 16 characters.", path: ["oauthAuthorizationPassword"] });
function environmentConfig(environment) {
    return {
        name: environment.MCP_SERVER_NAME,
        version: environment.MCP_SERVER_VERSION,
        authMode: environment.MCP_AUTH_MODE,
        maxBodyBytes: environment.MCP_MAX_BODY_BYTES,
        rateLimitPerMinute: environment.MCP_RATE_LIMIT_RPM,
        rateLimitBurst: environment.MCP_RATE_LIMIT_BURST,
        queryTimeoutMs: environment.MCP_QUERY_TIMEOUT_MS,
        queryPoolSize: environment.MCP_QUERY_POOL_SIZE,
        watchdogStallMs: environment.MCP_WATCHDOG_STALL_MS,
        oauthIssuerUrl: environment.OAUTH_ISSUER_URL,
        oauthTokenStorePath: environment.OAUTH_TOKEN_STORE_PATH,
        oauthAuthorizationPassword: environment.OAUTH_AUTHORIZATION_PASSWORD,
        oauthAccessTokenTtlSeconds: environment.OAUTH_ACCESS_TOKEN_TTL_SECONDS,
        oauthRefreshTokenTtlSeconds: environment.OAUTH_REFRESH_TOKEN_TTL_SECONDS,
        oauthAuthorizationCodeTtlSeconds: environment.OAUTH_AUTHORIZATION_CODE_TTL_SECONDS,
        oauthLoginSessionTtlSeconds: environment.OAUTH_LOGIN_SESSION_TTL_SECONDS,
        oauthScopes: environment.OAUTH_SCOPES,
        oauthEnableDynamicClientRegistration: environment.OAUTH_ENABLE_DYNAMIC_CLIENT_REGISTRATION,
        oauthMaxDynamicClients: environment.OAUTH_MAX_DYNAMIC_CLIENTS,
        oauthDynamicClientTtlSeconds: environment.OAUTH_DYNAMIC_CLIENT_TTL_SECONDS,
        oauthUnusedClientTtlSeconds: environment.OAUTH_UNUSED_CLIENT_TTL_SECONDS,
        oauthMaxClientsPerIdentity: environment.OAUTH_MAX_CLIENTS_PER_IDENTITY,
        oauthReadinessCheckIntervalSeconds: environment.OAUTH_READINESS_CHECK_INTERVAL_SECONDS,
        oauthMaxLiveGrants: environment.OAUTH_MAX_LIVE_GRANTS,
        oauthMaxLiveGrantsPerClient: environment.OAUTH_MAX_LIVE_GRANTS_PER_CLIENT,
        trustedProxyCidrs: environment.TRUSTED_PROXY_CIDRS
    };
}
export function parseServerConfig(environment, transport = "http") {
    const input = environmentConfig(environment);
    return transport === "stdio"
        ? ApplicationServerConfigSchema.parse(input)
        : ServerConfigSchema.parse(input);
}
export function loadServerConfig(options = {}) {
    return options.transport === "stdio"
        ? parseServerConfig(process.env, "stdio")
        : parseServerConfig(process.env, "http");
}
//# sourceMappingURL=config.js.map