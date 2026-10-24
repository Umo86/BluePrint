/**
 * The Cloudflare R2 address that browsers upload to and are sent to for downloads.
 * Buckets created with a jurisdiction (for example the EU) have their own address:
 * https://<account id>.eu.r2.cloudflarestorage.com
 *
 * Free of server-only imports so the proxy can use it for the Content Security Policy.
 */
export const R2_JURISDICTIONS = ['eu', 'fedramp'] as const;
export type R2Jurisdiction = (typeof R2_JURISDICTIONS)[number];

export function r2Origin(accountId: string | null | undefined, jurisdiction?: string | null): string | null {
  if (!accountId || !/^[0-9a-f]{32}$/i.test(accountId)) return null;
  const j = jurisdiction?.trim().toLowerCase() || null;
  if (j && !(R2_JURISDICTIONS as readonly string[]).includes(j)) return null;
  return `https://${accountId.toLowerCase()}${j ? `.${j}` : ''}.r2.cloudflarestorage.com`;
}
