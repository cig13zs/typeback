/** Financial and payment sites where saved keystrokes are more risk than help. */
export const DEFAULT_BLOCKLIST: readonly string[] = [
  'bankofamerica.com',
  'chase.com',
  'wellsfargo.com',
  'citi.com',
  'citibank.com',
  'capitalone.com',
  'americanexpress.com',
  'discover.com',
  'paypal.com',
  'venmo.com',
  'stripe.com',
  'coinbase.com',
  'binance.com',
  'kraken.com',
  'robinhood.com',
  'fidelity.com',
  'schwab.com',
  'vanguard.com',
  'etrade.com',
  'usbank.com',
  'pnc.com',
  'td.com',
  'hsbc.com',
  'barclays.com',
  'barclays.co.uk',
  'lloydsbank.com',
  'natwest.com',
  'santander.com',
  'santander.co.uk',
  'ally.com',
  'sofi.com',
  'chime.com',
  'n26.com',
  'revolut.com',
  'monzo.com',
  'wise.com',
  'westernunion.com',
  'cash.app',
];

export function normalizeBlockRule(rule: string): string {
  let value = rule.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '');
  value = value.split('/')[0] ?? '';
  value = value.replace(/:\d+$/, '');
  value = value.replace(/^\*\./, '').replace(/^\.+/, '').replace(/\.+$/, '');
  if (!/^[a-z0-9.-]+$/.test(value)) return '';
  if (!value.includes('.')) return '';
  return value;
}

export function parseBlocklist(text: string): string[] {
  const seen = new Set<string>();
  const rules: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const rule = normalizeBlockRule(line);
    if (!rule || seen.has(rule)) continue;
    seen.add(rule);
    rules.push(rule);
  }
  return rules;
}

export function hostBlocked(hostname: string, list: readonly string[]): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  for (const raw of list) {
    const rule = normalizeBlockRule(raw);
    if (!rule) continue;
    if (host === rule || host.endsWith(`.${rule}`)) return true;
  }
  return false;
}
