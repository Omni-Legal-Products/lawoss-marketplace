// Coverage guards for the reviewed Czech edition. Missing data is never a negative finding.
import { stat } from 'node:fs/promises';
export function serverEnvironment(server, env) {
  return { ...env, ...(server === 'adis' ? { ADIS_SOAP_ENABLED: '1' } : {}), ...(['isir', 'dd'].includes(server) ? { ISIR_SOAP_ENABLED: '1', ADIS_SOAP_ENABLED: '1' } : {}) };
}
export function coverageNote(server) {
  return ({sanctions:'Requires populated EU and OFAC sanctions sources refreshed within seven days; coverage must be checked before screening.',isir:'Only the live event feed is verified. Corporate and person screening are unavailable.',dd:'Risk conclusions are unavailable because the reviewed edition has incomplete upstream coverage.',realestate:'Requires an operator dataset. No current portable dataset is bundled.','eu-registry':'GB requires a Companies House key. Poland supports exact identifiers only. DE/NL use GLEIF coverage.'})[server] || '';
}
export async function blockedCall(server, name, args, env, inspectSanctions) {
  if (server === 'dd') return coverageNote(server);
  if (server === 'isir' && name !== 'poll_isir_events') return coverageNote(server);
  if (server === 'realestate') return coverageNote(server);
  if (server === 'sanctions') {
    if (!env.SANCTIONS_DB || !(await stat(env.SANCTIONS_DB).catch(() => null))?.isFile()) return 'SANCTIONS_DB must point to a populated database; no screening was performed.';
    const coverage = await inspectSanctions(env.SANCTIONS_DB).catch(() => []);
    if (!['eu','ofac'].every(source => coverage.some(row => row.source === source)) || coverage.some(row => !row.ok || !row.source_count || Date.now() - row.refreshed_at > 7 * 86400000)) return 'Sanctions coverage is absent, failed or older than seven days; refresh each configured source before screening.';
  }
  const country = String(args.country ?? args.jurisdiction ?? '').toUpperCase();
  if (server === 'eu-registry' && !country) return 'Select an explicit country; unscoped search cannot establish complete country coverage.';
  if (server === 'eu-registry' && ['GB','UK'].includes(country) && !env.CH_API_KEY) return 'Companies House requires CH_API_KEY; no UK search was performed.';
  if (server === 'eu-registry' && country === 'PL' && name === 'search_company') return 'Polish name search is unavailable; use get_company with an exact KRS identifier.';
  return null;
}
