const BASE = '/usenetbsv';

function b64encodeJson(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decodeJson(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export class PaymentRequired extends Error {
  constructor({ url, init, requirements, body }) {
    const price = body?.priceSats ?? requirements?.amount ?? '?';
    super(`Payment required — ${price} sats`);
    this.name = 'PaymentRequired';
    this.url = url;
    this.init = init;
    this.requirements = requirements;
    this.body = body;
    this.priceSats = Number.parseInt(String(price), 10) || 0;
    this.payTo = requirements?.payTo ?? body?.payTo ?? '';
  }

  /**
   * Sign the x402 challenge with the browser wallet and retry the request.
   * Verification + broadcast happen server-side; this only builds the tx.
   */
  async pay(wallet, onStage = () => {}) {
    if (!wallet) throw new Error('No wallet connected.');
    if (!this.requirements?.payTo) throw new Error('Challenge is missing payment requirements.');
    const txHex = await wallet.buildPayment(this.requirements.payTo, this.priceSats, onStage);
    const payload = { x402Version: 2, scheme: 'exact', network: 'bsv:mainnet', txHex, encoding: 'raw-hex' };
    onStage('settling');
    const res = await fetch(this.url, {
      ...this.init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.init?.headers || {}),
        'PAYMENT-SIGNATURE': b64encodeJson(payload),
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      throw new Error(data?.detail || data?.errorReason || `Payment failed (${res.status})`);
    }
    onStage('done');
    return { data, response: res };
  }
}

async function request(path, init = {}) {
  const url = BASE + path;
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    const header = res.headers.get('PAYMENT-REQUIRED');
    if (header) {
      let requirements = null;
      try {
        requirements = b64decodeJson(header);
      } catch {
        /* malformed header */
      }
      throw new PaymentRequired({ url, init, requirements, body });
    }
    throw new Error(body?.error || 'Payment required');
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.detail || j?.error) msg = j.detail || j.error;
    } catch {
      /* no body */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  health: () => request('/health'),
  pricing: () => request('/pricing'),
  stats: () => request('/api/stats'),
  manifest: () => request('/api/manifest'),
  nntp: () => request('/api/nntp'),
  latest: (limit = 20) => request(`/api/latest?limit=${limit}`),
  groups: () => request('/api/groups'),
  group: (ref) => request(`/api/groups/${encodeURIComponent(ref)}`),
  feed: (ref, { since = 0, limit = 200 } = {}) =>
    request(`/api/groups/${encodeURIComponent(ref)}/feed?since=${since}&limit=${limit}`),
  articlePreview: (id) => request(`/api/article/${encodeURIComponent(id)}?preview=1`),
  article: (id) => request(`/api/article/${encodeURIComponent(id)}`),
  proof: (id) => request(`/api/article/${encodeURIComponent(id)}/proof`),
  createGroup: (payload) => request('/api/groups', { method: 'POST', body: JSON.stringify(payload) }),
  post: (ref, payload) =>
    request(`/api/groups/${encodeURIComponent(ref)}/post`, { method: 'POST', body: JSON.stringify(payload) }),
  report: (id, reason) =>
    request(`/api/article/${encodeURIComponent(id)}/report`, { method: 'POST', body: JSON.stringify({ reason }) }),
  nick: (nick) =>
    request('/api/identities/nick', { method: 'POST', body: JSON.stringify({ nick }) }),
};
