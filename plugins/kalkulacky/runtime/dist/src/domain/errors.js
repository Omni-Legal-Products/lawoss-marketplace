export class CalcError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = "CalcError";
    }
}
//# sourceMappingURL=errors.js.map