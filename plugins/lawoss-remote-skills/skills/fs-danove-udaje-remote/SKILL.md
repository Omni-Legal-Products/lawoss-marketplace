---
name: fs-danove-udaje-remote
description: Vzdialená verzia pre self-hosted server LAWOSS. Use for read-only checks of Slovak Financial Administration public lists, including VAT, tax-debtor, published-account, reliability and income-tax-registration questions.
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

Pitfalls:

- `ds_dphz` is the list of payers for whom grounds for cancelling the VAT
  registration arose. They are still registered; never call it a cancelled
  registration. Read `cancellationGroundsPublished` / `cancellationGrounds`.
- `isDeregistered` covers only deleted payers (`ds_dphv`) and may be `null`:
  unknown, not "no" — see `unverifiedLists`.
- A debtor no-hit means the exact names in `searchedNames` are absent from the
  list version in `validity.listUpdateDates`; it is not proof of no arrears. A
  hit is a name match only — compare the address. Passing only `ico` lets the
  tool resolve the name the Financial Administration uses.
- Quote the list date from `validity.listUpdateDates`, not today's date.
- `FS_AUTH` means the local `FS_API_KEY` is missing or rejected, not a source outage.

These are public-source checks, not tax or legal advice. Use ORSR for corporate
identity and authority, RÚZ for financial statements, and the relevant
insolvency source for insolvency proceedings.

## Vzdialený režim

Táto verzia skillu je pre pripojenie na self-hosted server LAWOSS. Nástroje bežia na serveri, nie na tvojom počítači: nič lokálne neinštaluj a nepoužívaj lokálne CLI. Pripojenie a prihlásenie spravuje server, takže pokyny vyššie o lokálnom `stdio`, inštalácii alebo vlastnom nasadení sa na toto pripojenie nevzťahujú. Ak sa postup vyššie líši od tejto časti, platí táto časť.

Server ponúka všetky nástroje, ktoré tento skill spomína; žiadny z nich nie je vyhradený lokálnemu pluginu.

Nástroj, ktorý server vyhradil lokálnemu pluginu alebo ho ešte nepreveril, v zozname nástrojov nevidíš a jeho volanie vráti chybu „Tento nástroj je dostupný len v lokálnom plugine.“ Nie je to prázdny výsledok ani výpadok zdroja. Volanie neopakuj a pokračuj dostupnými nástrojmi. Ak používateľ potrebuje súbor na disku alebo uložený stav, odporuč mu lokálny plugin `fs-opendata-mcp` z katalógu LAWOSS.
