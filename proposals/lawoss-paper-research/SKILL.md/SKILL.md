---
name: lawoss-paper-research
description: Use for designing or conducting legal-science research intended for a paper, article, thesis, or comparable academic publication when the user asks for research questions, methodology, literature, source mapping, synthesis, or an outline. Do not use for a standalone legal lookup, citation check, legal advice, or pleading draft.
---

# LAWOSS paper research

Help prepare traceable legal scholarship. This skill supports academic research and writing; it is not legal advice and does not replace the focused LAWOSS legal research or citation skills.

## Activation

Activate only when the user’s stated purpose is an academic or publication-oriented legal paper and the task needs at least one substantive research component such as framing research questions, choosing a method, reviewing literature, mapping authorities, synthesizing evidence, or building an argument outline. If that purpose is unclear, ask one short question before invoking research workflows.

Do not activate for:

- a standalone request for the current or historical text of a provision;
- checking the accuracy or treatment of one decision or citation;
- formatting citations under ISO 690 without a paper-research task;
- practical advice about a client’s matter, contract review, or drafting a pleading;
- a non-legal academic paper.

Route those tasks to the appropriate focused workflow: `legal-research`, `legal-source-routing`, `law-drift-analysis`, `judikatura-citation-builder`, `iso-690-sk-citations`, or the relevant drafting skill. Add this skill only when the user also requests an academic paper or research design.

## Confidentiality gate — first step, before tools

Before opening, extracting, summarizing, or searching any attachment, inspect only the user’s message for clear signs that the task includes client, matter-specific, privileged, confidential, internal, unpublished, or identifying information. Filenames or labels such as “client”, “case file”, “internal”, or “privileged” are enough to stop; do not open the file to determine whether it is safe.

If such material is mentioned or supplied, stop before analysis and before calling browser, MCP, scholarly indexes, or other external tools. Do not quote, paraphrase, transform, outline, embed, or search for its contents. State that no attachment was processed and no external search was run. Ask for a fully synthetic scenario or a generalized question stripped of facts, names, dates, document language, metadata, and other details that could identify a person or matter. “Anonymized” is not sufficient when re-identification remains reasonably possible. If uncertain, stop and ask.

Proceed only from a clearly public, fictional, or safely generalized input. Keep search queries generic; never send client or matter-specific details to a connector. This gate does not itself authorize a search: use research tools only when the sanitized task calls for source retrieval.

## Research workflow

1. **Fix the brief.** Record the publication type, topic, jurisdictions, relevant date or period, audience, language, requested depth, and exclusions. Do not infer a jurisdiction or temporal version the user did not specify; ask when it matters.
2. **Frame the inquiry.** State a primary research question and any subsidiary questions. Select and explain a doctrinal, comparative, empirical, historical, or interdisciplinary method only as supported by the task and available evidence. Mark assumptions and limits.
3. **Plan and route sources.** Keep primary legal authorities distinct from academic literature and other context. For Slovak, Czech, EU, and ECHR authorities, follow `legal-source-routing` and `legal-research`; use `law-drift-analysis` when the law’s wording or effect at a past date matters. Use scholarly indexes for academic literature when available. Consensus may help discover literature but is not authority for what the law says and does not replace reading the cited work.
4. **Verify each source.** Record source type, issuing body or author, identifier, jurisdiction, date/version, retrieval route and date, relevant pinpoint, and whether the primary text or full text was actually available. Distinguish “retrieved and checked”, “metadata only”, “not found”, “unavailable”, and “not checked”. Never turn a search target or an unverified reference into a finding.
5. **Synthesize with traceability.** Tie each material proposition to a verified source or mark it as an inference, hypothesis, or open question. Include contrary authority or literature found. When a connector, identifier, pinpoint, or full text is unavailable, say so and leave the proposition unverified; do not fill gaps from memory or invent a plausible source list.
6. **Prepare the paper structure.** Build an outline whose section claims point back to the source map. Treat citation formatting as a handoff to `iso-690-sk-citations`, and only format sources whose bibliographic details have been checked. Preserve unresolved citation fields as unresolved.

## Expected output

Adapt the length to the task, but include the applicable items:

- research brief, scope, date, and limitations;
- research questions and chosen method, with reasons;
- source map separating legal authorities, academic literature, and context;
- synthesis that labels verified findings, inferences, disagreements, and open questions;
- retrieval gaps, unavailable full texts, and unverified propositions;
- argument outline with claims linked to mapped sources;
- citation handoff listing verified metadata and fields still to check.

Do not claim comprehensive coverage unless the searched sources, dates, jurisdictions, and exclusions support that claim. Do not invent quotations, pinpoint references, authorities, literature, or treatment status. Keep human review explicit before publication or legal reliance.
