import zlib from "node:zlib";
/** Inflated content-stream bound; a notice's text is capped at 128 KiB anyway. */
const MAX_INFLATED_BYTES = 4 * 1024 * 1024;
// With maxOutputLength, Node's inflateSync fails on real OV streams ("invalid
// distance too far back") once the output outgrows chunkSize, so one chunk
// holds the whole bound.
const INFLATE_BOUND = { maxOutputLength: MAX_INFLATED_BYTES, chunkSize: MAX_INFLATED_BYTES };
/**
 * Dependency-free PDF text extractor for OV notice PDFs. The source writes
 * text with Type0 / Identity-H fonts as hex glyph strings (<0027…> Tj), which
 * only a font's ToUnicode CMap turns into characters; reading literal strings
 * alone returned an empty text for every notice. Text runs are placed by their
 * text-matrix position and grouped into lines, so "Label:" and its value — two
 * separate runs at the same height — end up on one line.
 *
 * Falls back to the plain literal-string scan for PDFs without a page tree.
 */
export function extractPdfText(pdf) {
    const raw = pdf.toString("latin1");
    try {
        const doc = new PdfDocument(raw);
        const pages = doc.pages();
        if (pages.length > 0) {
            const text = pages.map(renderPageText).join("\n\n");
            if (text.trim())
                return text;
        }
    }
    catch {
        // Fall through to the literal-string scan.
    }
    return extractLiteralText(raw);
}
/** Legacy scan: literal (…) Tj / […] TJ strings in every stream. */
function extractLiteralText(raw) {
    const chunks = [];
    const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let m;
    let any = false;
    while ((m = streamRe.exec(raw)) !== null) {
        any = true;
        const bytes = Buffer.from(m[1], "latin1");
        let content = "";
        try {
            content = zlib.inflateSync(bytes, INFLATE_BOUND).toString("latin1");
        }
        catch {
            content = bytes.toString("latin1");
        }
        chunks.push(extractTextOperators(content));
    }
    const joined = chunks.join("\n");
    if (joined.trim().length > 0)
        return recoverUtf8(joined);
    return any ? joined : recoverUtf8(extractTextOperators(raw));
}
const isDict = (v) => typeof v === "object" && v !== null && !Array.isArray(v) && "dict" in v;
const nameOf = (v) => typeof v === "object" && v !== null && !Array.isArray(v) && "name" in v ? v.name : undefined;
const PDF_WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const PDF_DELIM = new Set("()<>[]{}/%".split("").map((c) => c.charCodeAt(0)));
class PdfLexer {
    s;
    pos;
    constructor(s, start = 0) {
        this.s = s;
        this.pos = start;
    }
    skipWs() {
        const s = this.s;
        while (this.pos < s.length) {
            const c = s.charCodeAt(this.pos);
            if (PDF_WS.has(c))
                this.pos += 1;
            else if (c === 0x25) {
                while (this.pos < s.length && s[this.pos] !== "\n" && s[this.pos] !== "\r")
                    this.pos += 1;
            }
            else
                break;
        }
    }
    /** Next value; operators come back as { kw }, end of input as undefined. */
    value() {
        this.skipWs();
        const s = this.s;
        if (this.pos >= s.length)
            return undefined;
        const c = s[this.pos];
        if (c === "<" && s[this.pos + 1] === "<") {
            this.pos += 2;
            const dict = new Map();
            for (;;) {
                this.skipWs();
                if (s.startsWith(">>", this.pos)) {
                    this.pos += 2;
                    return { dict };
                }
                const key = this.value();
                if (key === undefined)
                    return { dict };
                const val = this.value();
                const k = nameOf(key);
                if (k !== undefined && val !== undefined)
                    dict.set(k, val);
            }
        }
        if (c === "<") {
            const end = s.indexOf(">", this.pos);
            const hex = s.slice(this.pos + 1, end < 0 ? s.length : end).replace(/[^0-9a-fA-F]/g, "");
            this.pos = end < 0 ? s.length : end + 1;
            return { str: Buffer.from(hex.length % 2 ? `${hex}0` : hex, "hex").toString("latin1") };
        }
        if (c === "(")
            return { str: this.literal() };
        if (c === "[") {
            this.pos += 1;
            const arr = [];
            for (;;) {
                this.skipWs();
                if (s[this.pos] === "]") {
                    this.pos += 1;
                    return arr;
                }
                const v = this.value();
                if (v === undefined)
                    return arr;
                arr.push(v);
            }
        }
        if (c === "/") {
            this.pos += 1;
            return { name: this.token() };
        }
        if (c === "]" || c === ">" || c === ")" || c === "{" || c === "}") {
            this.pos += 1;
            return { kw: c };
        }
        const tok = this.token();
        if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
            // "12 0 R" is a reference.
            if (/^\d+$/.test(tok)) {
                const save = this.pos;
                const gen = this.token(true);
                const r = /^\d+$/.test(gen) ? this.token(true) : "";
                if (r === "R")
                    return { ref: Number(tok) };
                this.pos = save;
            }
            return Number(tok);
        }
        if (tok === "true" || tok === "false")
            return tok === "true";
        if (tok === "null")
            return null;
        return { kw: tok };
    }
    token(skipLeadingWs = false) {
        if (skipLeadingWs)
            this.skipWs();
        const s = this.s;
        const start = this.pos;
        while (this.pos < s.length) {
            const c = s.charCodeAt(this.pos);
            if (PDF_WS.has(c) || PDF_DELIM.has(c))
                break;
            this.pos += 1;
        }
        if (this.pos === start && this.pos < s.length)
            this.pos += 1; // stray delimiter
        return s.slice(start, this.pos);
    }
    literal() {
        const s = this.s;
        let depth = 0;
        let out = "";
        this.pos += 1;
        while (this.pos < s.length) {
            const c = s[this.pos++];
            if (c === "\\") {
                const n = s[this.pos++];
                if (n === undefined)
                    break;
                if (n === "n")
                    out += "\n";
                else if (n === "r")
                    out += "\r";
                else if (n === "t")
                    out += "\t";
                else if (n === "b")
                    out += "\b";
                else if (n === "f")
                    out += "\f";
                else if (/[0-7]/.test(n)) {
                    let oct = n;
                    while (oct.length < 3 && /[0-7]/.test(s[this.pos] ?? ""))
                        oct += s[this.pos++];
                    out += String.fromCharCode(parseInt(oct, 8) & 0xff);
                }
                else if (n === "\r") {
                    if (s[this.pos] === "\n")
                        this.pos += 1;
                }
                else if (n !== "\n")
                    out += n;
            }
            else if (c === "(") {
                depth += 1;
                out += c;
            }
            else if (c === ")") {
                if (depth === 0)
                    break;
                depth -= 1;
                out += c;
            }
            else
                out += c;
        }
        return out;
    }
}
class PdfDocument {
    raw;
    objects = new Map();
    fontCache = new Map();
    constructor(raw) {
        this.raw = raw;
        const header = /(\d+)\s+(\d+)\s+obj\b/g;
        let m;
        while ((m = header.exec(raw)) !== null) {
            const lexer = new PdfLexer(raw, m.index + m[0].length);
            const value = lexer.value();
            const obj = { value };
            const after = /^\s*stream\r?\n/.exec(raw.slice(lexer.pos, lexer.pos + 16));
            if (after && isDict(value)) {
                const dataStart = lexer.pos + after[0].length;
                const length = value.dict.get("Length");
                let dataEnd = -1;
                if (typeof length === "number" && /^\s*endstream/.test(raw.slice(dataStart + length, dataStart + length + 12))) {
                    dataEnd = dataStart + length;
                }
                else {
                    dataEnd = raw.indexOf("endstream", dataStart);
                    if (dataEnd < 0)
                        dataEnd = raw.length;
                    while (dataEnd > dataStart && (raw[dataEnd - 1] === "\n" || raw[dataEnd - 1] === "\r"))
                        dataEnd -= 1;
                }
                obj.stream = raw.slice(dataStart, dataEnd);
                header.lastIndex = dataEnd;
            }
            else {
                header.lastIndex = lexer.pos;
            }
            this.objects.set(Number(m[1]), obj);
        }
    }
    resolve(v, depth = 0) {
        if (depth < 8 && typeof v === "object" && v !== null && !Array.isArray(v) && "ref" in v) {
            return this.resolve(this.objects.get(v.ref)?.value, depth + 1);
        }
        return v;
    }
    streamOf(v) {
        if (typeof v !== "object" || v === null || Array.isArray(v) || !("ref" in v))
            return "";
        const obj = this.objects.get(v.ref);
        if (!obj?.stream || !isDict(obj.value))
            return obj?.stream ?? "";
        const filter = this.resolve(obj.value.dict.get("Filter"));
        const filters = Array.isArray(filter) ? filter.map(nameOf) : [nameOf(filter)];
        let data = Buffer.from(obj.stream, "latin1");
        for (const f of filters) {
            if (f === undefined)
                continue;
            if (f !== "FlateDecode")
                return "";
            data = zlib.inflateSync(data, INFLATE_BOUND);
        }
        return data.toString("latin1");
    }
    pages() {
        const out = [];
        const catalog = [...this.objects.values()]
            .map((o) => o.value)
            .find((v) => isDict(v) && nameOf(v.dict.get("Type")) === "Catalog");
        const root = isDict(catalog) ? catalog.dict.get("Pages") : undefined;
        const visit = (node, resources, depth) => {
            const n = this.resolve(node);
            if (!isDict(n) || depth > 32)
                return;
            const res = n.dict.get("Resources") ?? resources;
            const type = nameOf(n.dict.get("Type"));
            if (type === "Pages") {
                const kids = this.resolve(n.dict.get("Kids"));
                if (Array.isArray(kids))
                    for (const kid of kids)
                        visit(kid, res, depth + 1);
                return;
            }
            if (type !== "Page")
                return;
            const contents = this.resolve(n.dict.get("Contents"));
            const parts = Array.isArray(contents) ? contents : [n.dict.get("Contents")];
            out.push({
                contents: parts.map((p) => this.streamOf(p)).join("\n"),
                fonts: this.fonts(res),
            });
        };
        visit(root, undefined, 0);
        return out;
    }
    widths(font) {
        const widths = new Map();
        const descendants = this.resolve(font.dict.get("DescendantFonts"));
        const cid = this.resolve(Array.isArray(descendants) ? descendants[0] : undefined);
        if (isDict(cid)) {
            const dw = this.resolve(cid.dict.get("DW"));
            const w = this.resolve(cid.dict.get("W"));
            if (Array.isArray(w)) {
                // [c [w1 w2 …]] or [cFirst cLast w]
                for (let i = 0; i < w.length;) {
                    const first = this.resolve(w[i]);
                    const next = this.resolve(w[i + 1]);
                    if (typeof first !== "number")
                        break;
                    if (Array.isArray(next)) {
                        next.forEach((v, j) => {
                            const n = this.resolve(v);
                            if (typeof n === "number")
                                widths.set(first + j, n);
                        });
                        i += 2;
                    }
                    else {
                        const width = this.resolve(w[i + 2]);
                        if (typeof next !== "number" || typeof width !== "number")
                            break;
                        for (let c = first; c <= next && c - first <= 0xffff; c += 1)
                            widths.set(c, width);
                        i += 3;
                    }
                }
            }
            return { widths, defaultWidth: typeof dw === "number" ? dw : 1000 };
        }
        const firstChar = this.resolve(font.dict.get("FirstChar"));
        const simple = this.resolve(font.dict.get("Widths"));
        if (typeof firstChar === "number" && Array.isArray(simple)) {
            simple.forEach((v, j) => {
                const n = this.resolve(v);
                if (typeof n === "number")
                    widths.set(firstChar + j, n);
            });
        }
        return { widths, defaultWidth: 500 };
    }
    fonts(resources) {
        const out = new Map();
        const res = this.resolve(resources);
        const fontDict = isDict(res) ? this.resolve(res.dict.get("Font")) : undefined;
        if (!isDict(fontDict))
            return out;
        for (const [name, ref] of fontDict.dict) {
            const id = typeof ref === "object" && ref !== null && !Array.isArray(ref) && "ref" in ref ? ref.ref : -1;
            const cached = this.fontCache.get(id);
            if (cached) {
                out.set(name, cached);
                continue;
            }
            const font = this.resolve(ref);
            if (!isDict(font))
                continue;
            const toUnicodeRef = font.dict.get("ToUnicode");
            const cmap = toUnicodeRef ? parseToUnicode(this.streamOf(toUnicodeRef)) : null;
            const twoByte = nameOf(font.dict.get("Subtype")) === "Type0";
            const parsed = {
                codeBytes: cmap?.codeBytes ?? (twoByte ? 2 : 1),
                toUnicode: cmap?.map ?? null,
                ...this.widths(font),
            };
            if (id >= 0)
                this.fontCache.set(id, parsed);
            out.set(name, parsed);
        }
        return out;
    }
}
/** Parse a ToUnicode CMap: bfchar and bfrange (both destination forms). */
export function parseToUnicode(cmap) {
    if (!/begincmap/.test(cmap))
        return null;
    const space = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(cmap);
    const codeBytes = space ? Math.max(1, space[1].length / 2) : 2;
    const map = new Map();
    const unicode = (hex) => {
        const units = [];
        for (let i = 0; i + 4 <= hex.length; i += 4)
            units.push(parseInt(hex.slice(i, i + 4), 16));
        if (hex.length % 4 === 2)
            units.push(parseInt(hex.slice(-2), 16));
        return String.fromCharCode(...units);
    };
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
            map.set(parseInt(pair[1], 16), unicode(pair[2]));
        }
    }
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
        for (const r of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
            const lo = parseInt(r[1], 16);
            const hi = parseInt(r[2], 16);
            if (hi < lo || hi - lo > 0xffff)
                continue;
            if (r[3].startsWith("[")) {
                const dsts = [...r[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((d) => unicode(d[1]));
                dsts.forEach((d, i) => {
                    if (lo + i <= hi)
                        map.set(lo + i, d);
                });
            }
            else {
                const base = unicode(r[3].slice(1, -1));
                if (!base)
                    continue;
                const last = base.charCodeAt(base.length - 1);
                for (let code = lo; code <= hi; code += 1) {
                    map.set(code, base.slice(0, -1) + String.fromCharCode(last + (code - lo)));
                }
            }
        }
    }
    return { codeBytes, map };
}
function decodeShown(bytes, font) {
    if (!font?.toUnicode)
        return recoverUtf8(bytes);
    const map = font.toUnicode;
    return codesOf(bytes, font.codeBytes)
        .map((code) => map.get(code) ?? "")
        .join("");
}
function codesOf(bytes, codeBytes) {
    const codes = [];
    for (let i = 0; i + codeBytes <= bytes.length; i += codeBytes) {
        let code = 0;
        for (let j = 0; j < codeBytes; j += 1)
            code = code * 256 + bytes.charCodeAt(i + j);
        codes.push(code);
    }
    return codes;
}
/** Interpret one page's content stream and lay the runs out as lines. */
function renderPageText(page) {
    const runs = [];
    const lexer = new PdfLexer(page.contents);
    const operands = [];
    let tm = [1, 0, 0, 1, 0, 0];
    let tlm = [1, 0, 0, 1, 0, 0];
    // Graphics state: the current transformation matrix, saved by q / restored by Q.
    let ctm = [1, 0, 0, 1, 0, 0];
    const ctmStack = [];
    let leading = 0;
    let charSpacing = 0;
    let fontSize = 0;
    let font;
    const moveLine = (tx, ty) => {
        tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4] + tx * tlm[0] + ty * tlm[2], tlm[5] + tx * tlm[1] + ty * tlm[3]];
        tm = tlm;
    };
    // Horizontal advance of a string in text space, then moved along tm.
    const advance = (bytes) => {
        if (!font)
            return 0;
        const codes = codesOf(bytes, font.codeBytes);
        const glyphs = codes.reduce((sum, c) => sum + (font.widths.get(c) ?? font.defaultWidth), 0);
        return (glyphs / 1000) * fontSize + charSpacing * codes.length;
    };
    const push = (text, width) => {
        const scale = (Math.hypot(tm[0], tm[1]) || 1) * (Math.hypot(ctm[0], ctm[1]) || 1);
        // Text-space origin mapped through the CTM to page coordinates.
        const x = ctm[0] * tm[4] + ctm[2] * tm[5] + ctm[4];
        const y = ctm[1] * tm[4] + ctm[3] * tm[5] + ctm[5];
        tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + width * tm[0], tm[5] + width * tm[1]];
        if (text)
            runs.push({ x, endX: x + width * scale, y, size: fontSize * scale, seq: runs.length, text });
    };
    const show = (v) => {
        if (typeof v === "object" && v !== null && !Array.isArray(v) && "str" in v) {
            push(decodeShown(v.str, font), advance(v.str));
        }
        else if (Array.isArray(v)) {
            let text = "";
            let width = 0;
            for (const part of v) {
                if (typeof part === "number") {
                    width -= (part / 1000) * fontSize;
                    if (part <= -250)
                        text += " "; // a wide negative kern is a word gap
                }
                else if (typeof part === "object" && part !== null && !Array.isArray(part) && "str" in part) {
                    text += decodeShown(part.str, font);
                    width += advance(part.str);
                }
            }
            push(text, width);
        }
    };
    const num = (i) => {
        const v = operands[operands.length - i];
        return typeof v === "number" ? v : 0;
    };
    for (;;) {
        const v = lexer.value();
        if (v === undefined)
            break;
        if (!(typeof v === "object" && v !== null && !Array.isArray(v) && "kw" in v)) {
            operands.push(v);
            continue;
        }
        switch (v.kw) {
            case "q":
                ctmStack.push(ctm);
                break;
            case "Q":
                ctm = ctmStack.pop() ?? [1, 0, 0, 1, 0, 0];
                break;
            case "cm": {
                const [a, b, c, d, e, f] = [num(6), num(5), num(4), num(3), num(2), num(1)];
                ctm = [
                    a * ctm[0] + b * ctm[2],
                    a * ctm[1] + b * ctm[3],
                    c * ctm[0] + d * ctm[2],
                    c * ctm[1] + d * ctm[3],
                    e * ctm[0] + f * ctm[2] + ctm[4],
                    e * ctm[1] + f * ctm[3] + ctm[5],
                ];
                break;
            }
            case "BT":
                tm = [1, 0, 0, 1, 0, 0];
                tlm = tm;
                break;
            case "Tf":
                font = page.fonts.get(nameOf(operands[operands.length - 2]) ?? "");
                fontSize = num(1);
                break;
            case "Tc":
                charSpacing = num(1);
                break;
            case "Td":
                moveLine(num(2), num(1));
                break;
            case "TD":
                leading = -num(1);
                moveLine(num(2), num(1));
                break;
            case "TL":
                leading = num(1);
                break;
            case "Tm":
                tlm = [num(6), num(5), num(4), num(3), num(2), num(1)];
                tm = tlm;
                break;
            case "T*":
                moveLine(0, -leading);
                break;
            case "Tj":
            case "TJ":
                show(operands[operands.length - 1]);
                break;
            case "'":
                moveLine(0, -leading);
                show(operands[operands.length - 1]);
                break;
            case '"':
                moveLine(0, -leading);
                show(operands[operands.length - 1]);
                break;
            case "BI": {
                // Inline image: skip binary data up to EI.
                const end = page.contents.indexOf("EI", lexer.pos);
                lexer.pos = end < 0 ? page.contents.length : end + 2;
                break;
            }
            default:
                break;
        }
        operands.length = 0;
    }
    return layoutRuns(runs);
}
/** Group runs into lines by height (top to bottom), left to right within a line. */
function layoutRuns(runs) {
    const lines = [];
    for (const run of runs) {
        const line = lines.find((l) => Math.abs(l.y - run.y) < 2);
        if (line)
            line.runs.push(run);
        else
            lines.push({ y: run.y, runs: [run] });
    }
    return lines
        .sort((a, b) => b.y - a.y)
        .map((l) => l.runs
        .sort((a, b) => a.x - b.x || a.seq - b.seq)
        .reduce((acc, r) => {
        // A space only where the page leaves a visible gap; runs that
        // continue a word (a comma, a letter-spaced heading) join directly.
        const gap = acc.endX === null ? 0 : r.x - acc.endX;
        const spaced = acc.text && !/\s$/.test(acc.text) && !/^\s/.test(r.text) && gap > Math.max(r.size, 1) * 0.3;
        return { text: acc.text + (spaced ? " " : "") + r.text, endX: r.endX };
    }, { text: "", endX: null }).text
        // The source spaces many words with U+00A0; plain spaces keep the
        // text searchable.
        .replace(/[ \t\u00a0]+/g, " ")
        .trim())
        .filter((line) => line.length > 0)
        .join("\n");
}
/**
 * PDF literal strings are read as latin1 bytes. When the producer emitted UTF-8
 * bytes (common for Slovak diacritics), re-decode the latin1 string through
 * UTF-8 to recover characters like č, š, ž, á. If the bytes are not valid UTF-8
 * the original string is returned unchanged.
 */
function recoverUtf8(s) {
    if (!/[\u0080-ÿ]/.test(s))
        return s; // pure ASCII — nothing to recover
    try {
        const bytes = Buffer.from(s, "latin1");
        const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        // Heuristic: prefer the decode that yields fewer replacement chars.
        const badIn = (s.match(/�/g) ?? []).length;
        const badOut = (decoded.match(/�/g) ?? []).length;
        return badOut <= badIn ? decoded : s;
    }
    catch {
        return s;
    }
}
/** Pull text out of PDF show-text operators: (str)Tj and [(a)(b)]TJ. */
function extractTextOperators(content) {
    const out = [];
    // (string) Tj
    const tjRe = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    let m;
    while ((m = tjRe.exec(content)) !== null)
        out.push(unescapePdfString(m[1]));
    // [ (a) (b) ... ] TJ
    const tjArrRe = /\[((?:[^\]\\]|\\.)*)\]\s*TJ/g;
    while ((m = tjArrRe.exec(content)) !== null) {
        const inner = m[1];
        const strRe = /\(((?:\\.|[^\\)])*)\)/g;
        let s;
        const parts = [];
        while ((s = strRe.exec(inner)) !== null)
            parts.push(unescapePdfString(s[1]));
        out.push(parts.join(""));
    }
    return out.join("\n");
}
function unescapePdfString(s) {
    return s
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
        .replace(/\\(\d{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}
