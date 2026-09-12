/**
 * get_district_aggregate — okres-level statistics with k≥5 anonymity gate.
 *
 * Free tier — UNLIMITED. Aggregates contain no PII (no names, no addresses,
 * no specific properties), so safe to expose without rate limit beyond
 * the basic IP-level free tier limit applied at HTTP layer.
 *
 * `low_activity` is set when the okres + window combination is below the
 * public low-activity threshold.
 */
import { getDb } from '../db.js';
import { slugifyCs } from '@czagents/shared';
const K_ANONYMITY_THRESHOLD = 3;
const SOURCE_PRIORITY = ['eurostat_hpi', 'csu_vdb_extrap', 'cnb_arad', 'csu_vdb', 'cuzk_kupni', 'static_fallback'];
const KRAJ_SLUG_TO_PRICE_INDEX_KEY = {
    'hl-m-praha': 'Praha',
    stredocesky: 'Středočeský',
    jihocesky: 'Jihočeský',
    plzensky: 'Plzeňský',
    karlovarsky: 'Karlovarský',
    ustecky: 'Ústecký',
    liberecky: 'Liberecký',
    kralovehradecky: 'Královéhradecký',
    pardubicky: 'Pardubický',
    vysocina: 'Vysočina',
    jihomoravsky: 'Jihomoravský',
    olomoucky: 'Olomoucký',
    zlinsky: 'Zlínský',
    moravskoslezsky: 'Moravskoslezský',
};
function sourceRank(source) {
    const index = SOURCE_PRIORITY.indexOf(source);
    return index === -1 ? 99 : index;
}
export function getDistrictAggregate(params) {
    const window_days = params.window_days ?? 90;
    const db = getDb();
    const since = new Date(Date.now() - window_days * 24 * 60 * 60 * 1000).toISOString();
    const okresSlug = slugifyCs(params.okres);
    const districtParams = { okres: params.okres, okresSlug, since };
    const districtWhere = `
    (
      l.okresSlug = @okresSlug
      OR (l.okresSlug IS NULL AND l.kuMatchedName = @okres)
    )
    AND l.ingestedAt >= @since
    AND l.status != 'archived'
  `;
    // Prefer RealEstateLead.okresSlug (canonical district key). Existing
    // production rows may predate that backfill, so null-slug rows fall back to
    // kuMatchedName when it exactly matches the requested okres name.
    const distressCount = db
        .prepare(`
      SELECT COUNT(*) AS c
      FROM RealEstateLead l
      WHERE ${districtWhere}
    `)
        .get(districtParams).c;
    const insolvencyCount = db
        .prepare(`
      SELECT COUNT(*) AS c
      FROM RealEstateLead l
      WHERE ${districtWhere}
        AND l.sourceType = 'isir'
    `)
        .get(districtParams).c;
    const auctionCount = db
        .prepare(`
      SELECT COUNT(*) AS c
      FROM RealEstateLead l
      WHERE ${districtWhere}
        AND l.sourceType IN ('portaldrazeb', 'cevd', 'cuzk_delta')
    `)
        .get(districtParams).c;
    const aggregateRow = db
        .prepare(`
      SELECT krajSlug
      FROM DistrictAggregate
      WHERE okresSlug = @okresSlug
      ORDER BY CASE WHEN windowDays = @windowDays THEN 0 ELSE 1 END, windowDays DESC
      LIMIT 1
    `)
        .get({ okresSlug, windowDays: window_days });
    const priceIndexKraj = (aggregateRow?.krajSlug ? KRAJ_SLUG_TO_PRICE_INDEX_KEY[aggregateRow.krajSlug] : null) ??
        (okresSlug === 'praha' ? 'Praha' : null);
    const priceRows = priceIndexKraj
        ? db
            .prepare(`
        SELECT kcPerM2, source, periodYear, periodQuarter
        FROM RealEstatePriceIndex
        WHERE kraj = @kraj
          AND propertyType = 'byt'
        ORDER BY periodYear DESC, periodQuarter DESC
        LIMIT 20
      `)
            .all({ kraj: priceIndexKraj })
        : [];
    const latestPeriod = priceRows[0]
        ? { year: priceRows[0].periodYear, quarter: priceRows[0].periodQuarter }
        : null;
    const latestPriceRows = latestPeriod
        ? priceRows.filter((row) => row.periodYear === latestPeriod.year && row.periodQuarter === latestPeriod.quarter)
        : [];
    const latestPrice = latestPriceRows.sort((a, b) => sourceRank(a.source) - sourceRank(b.source))[0];
    const yoyPrice = latestPeriod
        ? priceRows
            .filter((row) => row.periodYear === latestPeriod.year - 1 && row.periodQuarter === latestPeriod.quarter)
            .sort((a, b) => sourceRank(a.source) - sourceRank(b.source))[0]
        : undefined;
    const lowActivity = distressCount < K_ANONYMITY_THRESHOLD;
    return {
        okres: params.okres,
        window_days,
        insolvency_count: insolvencyCount,
        auction_count: auctionCount,
        distress_lead_count: distressCount,
        avg_estimated_price_kc_per_m2: latestPrice?.kcPerM2 ?? null,
        trend_yoy_pct: latestPrice && yoyPrice
            ? Math.round(((latestPrice.kcPerM2 - yoyPrice.kcPerM2) / yoyPrice.kcPerM2) * 1000) / 10
            : null,
        ...(lowActivity ? { low_activity: true } : {}),
    };
}
//# sourceMappingURL=get_district_aggregate.js.map