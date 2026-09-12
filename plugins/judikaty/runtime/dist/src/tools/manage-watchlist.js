import * as z from "zod/v4";
import { addWatchlistEntry, listWatchlistEntries, removeWatchlistEntry } from "../providers/nsud/law-index-store.js";
import { buildTreatmentFlag } from "./search-decisions/treatment-flags.js";
import { asToolResult } from "../server/response.js";
const InputShape = {
    action: z.enum(["add", "remove", "list"]).describe("add/remove sleduje spisovú značku; list vráti všetky s aktuálnym osudom"),
    spisovaZnacka: z.string().min(2).optional().describe("Spisová značka (povinná pre add/remove)"),
    note: z.string().max(300).optional().describe("Voliteľná poznámka (napr. názov kauzy)")
};
export async function runWatchlistAction(input) {
    if (input.action === "add") {
        if (!input.spisovaZnacka)
            throw new Error("spisovaZnacka is required for action=add");
        await addWatchlistEntry(input.spisovaZnacka, input.note);
    }
    if (input.action === "remove") {
        if (!input.spisovaZnacka)
            throw new Error("spisovaZnacka is required for action=remove");
        const removed = await removeWatchlistEntry(input.spisovaZnacka);
        return { action: "remove", removed };
    }
    const entries = await listWatchlistEntries();
    const withTreatment = [];
    for (const entry of entries) {
        withTreatment.push({ ...entry, treatment: await buildTreatmentFlag(entry.refRaw) });
    }
    return { action: input.action, entries: withTreatment };
}
export function registerManageWatchlistTool(server) {
    server.registerTool("manage_watchlist", {
        title: "Watchlist judikátov",
        description: "Sleduj spisové značky, o ktoré opieraš živé kauzy. action=add/remove/list; list vráti aj aktuálny osud každej značky (⚠️ zrušené / potvrdené / bez zásahu). Zmeny sledovaných značiek chodia v týždennom e-maile.",
        inputSchema: InputShape
    }, async (input) => asToolResult(await runWatchlistAction(z.object(InputShape).parse(input))));
}
//# sourceMappingURL=manage-watchlist.js.map