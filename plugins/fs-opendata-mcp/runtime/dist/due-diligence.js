import { normalizeIcDph } from "./fs-client.js";
import { safeError } from "./redaction.js";
const mandatory = ["vatStatus", "taxDebtor", "taxReliability", "vatBankAccounts", "vatTaxAdminAccount", "incomeTaxRegistration"];
export function isUsable(section) {
    return Boolean(section && typeof section === "object" && !("error" in section) && !("skipped" in section));
}
function settle(result) { return result.status === "fulfilled" ? result.value : { error: safeError(result.reason) }; }
function valid(value) {
    if (!value || typeof value !== "object" || !("validity" in value))
        return false;
    const source = value.validity;
    return Boolean(source?.sourceValidated && !source.truncated && source.truncationReason === null && typeof source.returnedCount === "number" && typeof source.sourceTotal === "number" && source.returnedCount <= source.sourceTotal);
}
function first(records, ...keys) {
    for (const record of records ?? [])
        for (const key of keys)
            if (typeof record[key] === "string" && String(record[key]).trim())
                return String(record[key]).trim();
    return null;
}
export function resolveIdentity(vat, reliability, income) {
    const vatRows = isUsable(vat) ? [...vat.registered, ...vat.deregistered] : [];
    const icDph = normalizeIcDph(vatRows.find((row) => row.icDph)?.icDph ?? null) ?? normalizeIcDph(first(isUsable(reliability) ? reliability.records : [], "ic_dph"));
    const name = vatRows.find((row) => row.name)?.name?.trim() ?? first(isUsable(reliability) ? reliability.records : [], "nazov_subjektu", "nazov_ds") ?? first(isUsable(income) ? income.records : [], "nazov_subjektu", "nazov_ds");
    return { icDph: icDph ?? null, name: name ?? null };
}
export function extractReliabilityIndex(section) { return first(isUsable(section) ? section.records : [], "ids"); }
export function summarise(sections) {
    const findings = [];
    const vat = sections.vatStatus;
    const debtor = sections.taxDebtor;
    if (isUsable(vat) && !vat.isVatPayer)
        findings.push("not_vat_payer");
    if (isUsable(debtor) && debtor.isDebtor)
        findings.push("tax_debtor");
    const incomplete = mandatory.filter((name) => {
        const section = sections[name];
        return !isUsable(section) || !valid(section);
    });
    const status = findings.length ? "findings" : incomplete.length ? "incomplete" : "clean";
    const note = status === "clean" ? "All six mandatory source sections were validated, complete, and non-truncated." : status === "findings" ? "Findings are present; incomplete sections, if any, remain listed." : "One or more sections are incomplete; this is not a clean result.";
    return { status, findings, incomplete, note };
}
export async function runFullDueDiligence(ico, deps, now = () => new Date().toISOString()) {
    const [vatResult, reliabilityResult, incomeResult, corporateResult] = await Promise.allSettled([
        deps.getVatStatus({ ico }), deps.getTaxReliabilityIndex({ ico }), deps.getIncomeTaxRegistration({ ico }), deps.getCorporateIncomeTax({ ico }),
    ]);
    const vatStatus = settle(vatResult);
    const taxReliability = settle(reliabilityResult);
    const incomeTaxRegistration = settle(incomeResult);
    const corporateIncomeTax = settle(corporateResult);
    const resolved = resolveIdentity(vatStatus, taxReliability, incomeTaxRegistration);
    const skipped = { skipped: true, reason: "identifier_unavailable" };
    const [debtResult, bankResult, adminResult] = await Promise.allSettled([
        resolved.name ? deps.checkTaxDebtor({ name: resolved.name }) : Promise.resolve(skipped),
        resolved.icDph ? deps.getVatBankAccounts({ icDph: resolved.icDph }) : Promise.resolve(skipped),
        resolved.icDph ? deps.getVatTaxAdminAccount({ icDph: resolved.icDph }) : Promise.resolve(skipped),
    ]);
    const sections = { vatStatus, taxDebtor: settle(debtResult), taxReliability, vatBankAccounts: settle(bankResult), vatTaxAdminAccount: settle(adminResult), incomeTaxRegistration, corporateIncomeTax };
    if (isUsable(vatStatus)) {
        const index = extractReliabilityIndex(taxReliability);
        if (index) {
            vatStatus.reliabilityIndex = index;
            vatStatus.reliabilityNote = "Index doplnený z validovaného ds_iz_ran.";
        }
    }
    return { ok: true, retrievedAt: now(), resolved, sections, summary: summarise(sections) };
}
