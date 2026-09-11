export interface Env {
  NETWORK?: string;
  PAY_TO?: string;
  ARC_URL?: string;
  WOC_URL?: string;
  ARC_API_KEY?: string;
  FEE_SATS?: string;
  DUST_FLOOR_SATS?: string;
  PRICE_GROUP_CREATE_SATS?: string;
  PRICE_POST_DEFAULT_SATS?: string;
  PRICE_READ_DEFAULT_SATS?: string;
  PRICE_RELAY_SATS?: string;
  PRICE_REPORT_SATS?: string;
  PRICE_NICK_SATS?: string;
  RATE_LIMIT_PER_MIN?: string;
  GATEWAY_PORT?: string;
  GATEWAY_HOST?: string;
  /** Public NNTP gateway advertised via /api/nntp + /api/manifest. */
  NNT_GATEWAY_HOST?: string;
  NNT_GATEWAY_PORT?: string;
  NNT_GATEWAY_FALLBACK_PORT?: string;
  /** D1 database binding (required for groups/articles; tests inject a mock). */
  USENET_DB?: unknown;
  /** KV binding for rate limits + usage metering (optional — open/meterless without it). */
  METER?: unknown;
  /** Static assets binding for the SPA bundle (frontend/dist). */
  ASSETS?: unknown;
}

export function str(env: Env, key: keyof Env, fallback: string): string {
  const v = env[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

export function num(env: Env, key: keyof Env, fallback: number): number {
  const v = env[key];
  const n = typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
