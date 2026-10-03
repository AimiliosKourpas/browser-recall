// URL normalisation for the `pages.url` unique key (ARCHITECTURE §5.1): http(s) only (A6), fragments and tracking parameters
// stripped, host lower-cased (URL does it). Token-like parameters are a capture-policy concern (M6), not stripped here.

export const MAX_URL_LENGTH = 2048;

const TRACKING_PARAM = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|igshid|mc_eid|mc_cid|_ga|_gl|vero_id|oly_enc_id|oly_anon_id)$/i;

export interface NormalizedUrl {
  url: string;
  domain: string;
}

/** Returns undefined for non-http(s) URLs (chrome://, chrome-extension://, file:, data:, blob:, javascript:…), invalid URLs and over-long URLs. */
export function normalizeUrl(input: string): NormalizedUrl | undefined {
  if (input.length > MAX_URL_LENGTH * 2) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  if (!parsed.hostname) return undefined;
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  for (const key of [...parsed.searchParams.keys()]) if (TRACKING_PARAM.test(key)) parsed.searchParams.delete(key);
  const url = parsed.toString().replace(/\?$/, '');
  if (url.length > MAX_URL_LENGTH) return undefined;
  return { url, domain: parsed.hostname };
}

export function isIndexableUrl(input: string): boolean {
  return normalizeUrl(input) !== undefined;
}
