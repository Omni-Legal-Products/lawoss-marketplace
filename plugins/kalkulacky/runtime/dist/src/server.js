// Vstupný bod pre stdio transport (napr. pripojenie z Claude Desktop / lokálny
// MCP klient). Data sa cachujú v src/data/tables-cache.ts a znovu načítajú, keď
// sa zmenia dátové súbory (overlay refresh) — pozri tables-cache.ts.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/register.js";
import { getTables } from "./data/tables-cache.js";
import { ecbVekUpozornenie } from "./domain/urok.js";
import { todayIso } from "./domain/dates.js";
export async function main(tablesFn = getTables) {
    // Eager, explicit call so a broken repo/overlay fails loudly at startup —
    // before connecting the transport at all — instead of surfacing as an
    // error on the first tool call. registerTools() also loads eagerly for its
    // static description text, but that's an implementation detail we don't
    // want this fail-fast guarantee to depend on.
    const tables = tablesFn();
    // Lokálny stdio režim nemá týždenný refresh do overlay — vek tabuľky ECB
    // treba povedať nahlas hneď pri štarte (stderr sa v MCP klientoch loguje).
    const upozornenie = ecbVekUpozornenie(tables.ecb, todayIso());
    if (upozornenie)
        console.error(`[kalkulacky-sk-mcp] UPOZORNENIE: ${upozornenie}`);
    const server = new McpServer({ name: "kalkulacky-sk-mcp", version: "0.2.0" });
    registerTools(server, tablesFn);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("kalkulacky-sk-mcp MCP server running on stdio");
}
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error("Fatal error in main():", error);
        process.exit(1);
    });
}
//# sourceMappingURL=server.js.map