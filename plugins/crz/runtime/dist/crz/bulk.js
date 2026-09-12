/**
 * Optional CLI helper to ingest the data.gov.sk bulk CRZ XML dataset.
 *
 * Usage:
 *   npm run bulk -- --in <path-to-xml-or-dir> --out <out.jsonl>
 *
 * Not exposed as an MCP tool. Designed for one-off corpus building.
 */
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
function parseArgs(argv) {
    let input = "";
    let output = "";
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--in")
            input = argv[++i] ?? "";
        if (argv[i] === "--out")
            output = argv[++i] ?? "";
    }
    if (!input || !output) {
        console.error("Usage: npm run bulk -- --in <file-or-dir> --out <out.jsonl>");
        process.exit(2);
    }
    return { input, output };
}
async function* iterXmlFiles(p) {
    const s = await stat(p);
    if (s.isFile() && p.toLowerCase().endsWith(".xml")) {
        yield p;
        return;
    }
    if (s.isDirectory()) {
        for (const name of await readdir(p)) {
            const sub = path.join(p, name);
            const ss = await stat(sub);
            if (ss.isFile() && name.toLowerCase().endsWith(".xml"))
                yield sub;
        }
    }
}
function extract(xml, tag) {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
    if (!m)
        return undefined;
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1").replace(/\s+/g, " ").trim() || undefined;
}
async function ingestFile(file, write) {
    const raw = await readFile(file, "utf8");
    // CRZ dumps wrap many <zmluva> elements. Iterate them.
    const re = /<zmluva\b[\s\S]*?<\/zmluva>/gi;
    let count = 0;
    let match;
    while ((match = re.exec(raw)) !== null) {
        const block = match[0];
        const obj = {
            id: extract(block, "id"),
            cislo_zmluvy: extract(block, "cislo_zmluvy"),
            nazov: extract(block, "nazov") ?? extract(block, "predmet"),
            dodavatel: extract(block, "dodavatel") ?? extract(block, "dodavatel_nazov"),
            objednavatel: extract(block, "objednavatel") ?? extract(block, "objednavatel_nazov"),
            ico_dodavatel: extract(block, "dodavatel_ico"),
            ico_objednavatel: extract(block, "objednavatel_ico"),
            datum_uzavretia: extract(block, "datum_uzavretia"),
            datum_zverejnenia: extract(block, "datum_zverejnenia"),
            cena: extract(block, "cena"),
            rezort: extract(block, "rezort"),
        };
        await write(JSON.stringify(obj) + "\n");
        count++;
    }
    return count;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    let total = 0;
    const chunks = [];
    const writer = async (line) => { chunks.push(line); };
    for await (const f of iterXmlFiles(args.input)) {
        const n = await ingestFile(f, writer);
        total += n;
        console.error(`[bulk] ${path.basename(f)}: ${n} contracts`);
    }
    await writeFile(args.output, chunks.join(""), "utf8");
    console.error(`[bulk] wrote ${total} contracts → ${args.output}`);
}
main().catch((err) => { console.error(err); process.exit(1); });
//# sourceMappingURL=bulk.js.map