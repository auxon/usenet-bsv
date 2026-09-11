/**
 * Minimal strict x402 v2 envelope helpers for the BSV `exact` binding.
 * Header names and flow match the x402 spec; only (scheme, network) is new.
 * Copied from bsv-wallets (proven) — do not diverge without updating the spec.
 */
export const X402_VERSION = 2;
export const BSV_SCHEME = "exact";
export const BSV_NETWORK = "bsv:mainnet";
export const BSV_ASSET = "native:BSV";

export interface BsvPaymentRequirements {
  x402Version: number;
  scheme: string;
  network: string;
  /** satoshis as a decimal string (atomic units, no decimals) */
  amount: string;
  payTo: string;
  asset: string;
  resource: { url: string; description: string; mimeType: string };
  extra: {
    satoshis: string;
    dustFloor: string;
    arcUrl: string;
    priceNote?: string;
    usdCents?: string;
    rateUsd?: string;
  };
}

export interface BsvPaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  /** signed raw tx hex, or BEEF hex when chains are needed */
  txHex: string;
  encoding: "raw-hex" | "beef-hex";
}

const te = new TextEncoder();
const td = new TextDecoder();

export function b64encodeJson(obj: unknown): string {
  const bytes = te.encode(JSON.stringify(obj));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64decodeJson<T>(b64: string): T {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(td.decode(bytes)) as T;
}

export function buildRequirements(args: {
  url: string;
  description: string;
  mimeType: string;
  satoshis: number;
  payTo: string;
  arcUrl: string;
  dustFloor: number;
  usdCents?: number | null;
  rateUsd?: number | null;
}): BsvPaymentRequirements {
  return {
    x402Version: X402_VERSION,
    scheme: BSV_SCHEME,
    network: BSV_NETWORK,
    amount: String(args.satoshis),
    payTo: args.payTo,
    asset: BSV_ASSET,
    resource: {
      url: args.url,
      description: args.description,
      mimeType: args.mimeType,
    },
    extra: {
      satoshis: String(args.satoshis),
      dustFloor: String(args.dustFloor),
      arcUrl: args.arcUrl,
      ...(args.usdCents ? { usdCents: String(args.usdCents) } : {}),
      ...(args.rateUsd ? { rateUsd: String(args.rateUsd) } : {}),
    },
  };
}
