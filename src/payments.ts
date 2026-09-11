import { P2PKH } from "@bsv/sdk";
import { BSV_NETWORK, b64decodeJson, b64encodeJson, buildRequirements, type BsvPaymentPayload } from "./bsv-x402.ts";
import { arcBroadcast, verifyBsvPayment } from "./facilitator.ts";
import { num, str, type Env } from "./env.ts";
import { meter } from "./meter.ts";

export function isValidAddress(addr: unknown): boolean {
  if (typeof addr !== "string" || addr.length < 26 || addr.length > 35) return false;
  try {
    new P2PKH().lock(addr);
    return true;
  } catch {
    return false;
  }
}

export function paymentRequiredResponse(
  env: Env,
  resourceUrl: string,
  description: string,
  priceSats: number,
  payTo?: string,
) {
  const req = buildRequirements({
    url: resourceUrl,
    description,
    mimeType: "application/json",
    satoshis: priceSats,
    payTo: payTo ?? str(env, "PAY_TO", ""),
    arcUrl: str(env, "ARC_URL", "https://arc.gorillapool.io/v1"),
    dustFloor: num(env, "DUST_FLOOR_SATS", 1),
  });
  return { requirements: req, header: b64encodeJson(req) };
}

export interface Settled {
  payer: string;
  txid: string;
  settledTxid: string;
  priceSats: number;
}

/**
 * Shared paid gate: 402 without signature, structural verify, ARC-broadcast
 * settle BEFORE serving. No result is served unless the payment hits the network.
 * On ARC 5xx/timeout post-broadcast the payment is treated as pending-but-served
 * (same fail-open as bsv-wallets) and metered.
 */
export async function verifyAndSettle(
  env: Env,
  resourceUrl: string,
  description: string,
  priceSats: number,
  payTo: string,
  paymentSignatureB64: string | null,
): Promise<{ ok: true; settled: Settled } | { ok: false; response: Response }> {
  const deny = (body: unknown, status: number, extraHeaders: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...extraHeaders },
    });
  const { requirements, header } = paymentRequiredResponse(env, resourceUrl, description, priceSats, payTo);
  if (!paymentSignatureB64) {
    return {
      ok: false,
      response: deny({ error: "payment_required", priceSats, payTo, network: BSV_NETWORK }, 402, {
        "PAYMENT-REQUIRED": header,
      }),
    };
  }
  let payload: BsvPaymentPayload;
  try {
    payload = b64decodeJson<BsvPaymentPayload>(paymentSignatureB64);
  } catch {
    return { ok: false, response: deny({ success: false, errorReason: "invalid_payload", network: BSV_NETWORK }, 402) };
  }
  const v = await verifyBsvPayment(requirements, payload);
  if (!v.success) {
    return { ok: false, response: deny({ ...v, network: BSV_NETWORK }, 402) };
  }
  try {
    const { txid: settledTxid } = await arcBroadcast(env, v.txHex);
    if (!settledTxid) throw new Error("ARC accepted but returned no txid");
    void meter(env, endpointName(resourceUrl), priceSats);
    return { ok: true, settled: { payer: v.payer, txid: v.txid, settledTxid, priceSats } };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    const status = (e as { status?: number })?.status;
    if (status === undefined || (status >= 500 && status <= 599) || /timeout|abort|network/i.test(msg)) {
      void meter(env, endpointName(resourceUrl), priceSats);
      return { ok: true, settled: { payer: v.payer, txid: v.txid, settledTxid: v.txid, priceSats } };
    }
    return {
      ok: false,
      response: deny(
        { success: false, errorReason: "invalid_transaction_state", detail: msg, network: BSV_NETWORK },
        402,
      ),
    };
  }
}

export function settlementHeader(settled: Settled) {
  return b64encodeJson({ success: true, payer: settled.payer, transaction: settled.settledTxid, network: BSV_NETWORK });
}

function endpointName(resourceUrl: string): string {
  try {
    const segs = new URL(resourceUrl).pathname.split("/").filter(Boolean);
    return segs.slice(-2).join("-") || "unknown";
  } catch {
    return "unknown";
  }
}
