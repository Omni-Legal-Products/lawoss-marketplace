export function buildTimeline(r) {
    const out = [];
    if (r.company.registered_on) {
        out.push({
            date: r.company.registered_on,
            dateLabel: fmt(r.company.registered_on),
            severity: 'info',
            title: 'Vznik firmy',
            detail: r.company.legal_form
                ? `Registrace jako ${r.company.legal_form}.`
                : undefined,
            source: 'ARES',
        });
    }
    if (r.company.dissolved_on) {
        out.push({
            date: r.company.dissolved_on,
            dateLabel: fmt(r.company.dissolved_on),
            severity: 'alert',
            title: 'Zánik firmy',
            source: 'ARES',
        });
    }
    for (const m of r.statutory_body ?? []) {
        if (m.since && m.is_person) {
            // Recent change → mark warning, older → info
            const days = daysAgo(m.since);
            out.push({
                date: m.since,
                dateLabel: fmt(m.since),
                severity: days < 30 ? 'warn' : 'info',
                title: `Jmenování: ${m.name}`,
                detail: m.role
                    ? `Role: ${m.role}.${days < 30 ? ' Změna v posledních 30 dnech.' : ''}`
                    : undefined,
                source: 'ARES VR',
            });
        }
        if (m.personal_insolvency) {
            // We don't have the exact date of the personal insolvency on the
            // typed payload; surface as "dnes" anchor with severity alert.
            out.push({
                date: r.retrieved_at,
                dateLabel: 'aktuální',
                severity: 'alert',
                title: `Osobní insolvence statutáře: ${m.name}`,
                detail: `Spis. zn. ${m.personal_insolvency.spisova_znacka}. Dle § 13 ZSVR nezpůsobilý řídit firmu.`,
                source: 'ISIR',
            });
        }
        for (const prior of m.prior_bankrupt_companies ?? []) {
            out.push({
                date: r.retrieved_at,
                dateLabel: 'aktuální',
                severity: 'warn',
                title: `${m.name} — historie u zkrachovalé firmy`,
                detail: `IČO ${prior.ico}${prior.name ? ` (${prior.name})` : ''}${prior.spisova_znacka ? `, ${prior.spisova_znacka}` : ''}.`,
                source: 'ARES + ISIR',
            });
        }
    }
    if (r.insolvency?.has_active_proceeding && r.insolvency.started_on) {
        out.push({
            date: r.insolvency.started_on,
            dateLabel: fmt(r.insolvency.started_on),
            severity: 'alert',
            title: 'Zahájení insolvenčního řízení firmy',
            detail: r.insolvency.spisova_znacka,
            source: 'ISIR',
        });
    }
    if (r.vat?.unreliable_since) {
        out.push({
            date: r.vat.unreliable_since,
            dateLabel: fmt(r.vat.unreliable_since),
            severity: 'alert',
            title: 'Označen jako nespolehlivý plátce DPH',
            detail: 'Platby na nezveřejněný účet zakládají ručení dle § 109 ZDPH.',
            source: 'ADIS / MFČR',
        });
    }
    // Anchor: today, when the report was retrieved.
    out.push({
        date: r.retrieved_at,
        dateLabel: 'dnes',
        severity: 'info',
        title: 'Tento DD report',
        detail: `Risk score ${r.risk_score?.value ?? '—'} / 100, ${r.red_flags.length} ${r.red_flags.length === 1 ? 'vlajka' : r.red_flags.length < 5 ? 'vlajky' : 'vlajek'}.`,
        source: 'cz-agents',
    });
    // Sort ascending. Dates that are full ISO sort correctly; "aktuální"
    // we coerce to retrieved_at for sorting purposes.
    out.sort((a, b) => {
        const da = a.dateLabel === 'aktuální' ? r.retrieved_at : a.date;
        const db = b.dateLabel === 'aktuální' ? r.retrieved_at : b.date;
        return da.localeCompare(db);
    });
    // Basic riskScore: alert events contribute 3pts, warn 1pt, cap at 100.
    const riskScore = Math.min(100, out.reduce((sum, e) => {
        if (e.severity === 'alert')
            return sum + 3;
        if (e.severity === 'warn')
            return sum + 1;
        return sum;
    }, 0));
    return { events: out, riskScore };
}
function fmt(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return iso.slice(0, 10);
    return d.toLocaleDateString('cs-CZ', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
    });
}
function daysAgo(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return 9999;
    return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}
//# sourceMappingURL=risk-timeline.js.map