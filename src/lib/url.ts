const TRACKING_PARAM =
  /^(utm_|fbclid$|gclid$|gclsrc$|dclid$|mc_eid$|mc_cid$|igshid$|_ga$|_gl$|vero_id$|yclid$|msclkid$|ref$|ref_src$|spm$)/i;

export interface PageKey {
  origin: string;
  urlKey: string;
  href: string;
  hostname: string;
}

/**
 * Identity for a page. The hash is ignored because mail and docs apps
 * shuffle it without changing the form. Known ad-tracking params are dropped
 * so a reload with a new campaign tag still finds the draft.
 */
export function pageKey(input: string): PageKey | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const params = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAM.test(key));
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const search = new URLSearchParams(params).toString();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const urlKey = path + (search ? `?${search}` : '');
  return {
    origin: url.origin,
    urlKey,
    href: `${url.origin}${urlKey}`,
    hostname: url.hostname,
  };
}

export function isWebOrigin(origin: string): boolean {
  return origin.startsWith('https://') || origin.startsWith('http://');
}
