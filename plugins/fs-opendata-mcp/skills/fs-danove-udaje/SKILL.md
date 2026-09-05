---
name: fs-danove-udaje
description: Use for read-only checks of Slovak Financial Administration public lists, including VAT, tax-debtor, published-account, reliability and income-tax-registration questions.
---

# FS public tax-list checks

Use the smallest applicable tool and report the result's validity block:

- `fs_vat_status`
- `fs_tax_debtor_check`
- `fs_list_metadata`
- `fs_vat_bank_accounts`
- `fs_vat_tax_admin_account`
- `fs_tax_reliability_index`
- `fs_corporate_income_tax`
- `fs_income_tax_registration`
- `fs_full_due_diligence`

IČO must be exactly eight ASCII digits. IČ DPH must be `SK` plus exactly ten
ASCII digits. The debtor list searches by subject name; the VAT-account lists
search by IČ DPH. Do not substitute a different identifier.

Treat a no-hit as valid only when `sourceValidated=true`, `sourceTotal=0`,
`returnedCount=0`, `truncated=false`, and there are no validation warnings.
For `fs_full_due_diligence`, the six mandatory sections determine clean: an MCP
error, skip, invalid total, timeout or truncation in one of them is incomplete,
never clean. Corporate income tax is optional. An optional failure remains
visible in `sections.corporateIncomeTax` and does not gate clean or enter
`summary.incomplete`. Read `summary.status`, `findings` and `incomplete`; preserve
findings even when another mandatory section is incomplete.

These are public-source checks, not tax or legal advice. Use ORSR for corporate
identity and authority, RÚZ for financial statements, and the relevant
insolvency source for insolvency proceedings.
