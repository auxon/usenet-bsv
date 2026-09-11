import { Hono } from "hono";
import { Transaction } from "@bsv/sdk";
import {
  BSV_ASSET,
  BSV_NETWORK,
  BSV_SCHEME,
  X402_VERSION,
  b64decodeJson,
  type BsvPaymentPayload,
  type BsvPaymentRequirements,
} from "./bsv-x402.ts";
import { str, type Env } from "./env.ts";

export interface VerifyOk {
  success: true;
  payer: string;
  txid: string;
  txHex: string;
  amount: number;
}

export type VerifyResult =
  | VerifyOk
  | { success: false; errorReason: string; payer?: string; transaction?: string; network?: string };

function fail(errorReason: string): VerifyResult {
  return { success: false, errorReason, network: BSV_NETWORK };
}

/** Structural verify: requirements match + tx pays payTo + sane fee. Full SPV needs BEEF proofs (documented). */
export async function verifyBsvPayment(
  requirements: BsvPaymentRequirements,
  payload: BsvPaymentPayload,
): Promise<VerifyResult> {
  if (requirements.x402Version !== X402_VERSION) return fail("invalid_x402_version");
  if (requirements.scheme !== BSV_SCHEME) return fail("invalid_scheme");
  if (requirements.network !== BSV_NETWORK) return fail("invalid_network");
  const want = Number.parseInt(requirements.amount, 10);
  if (!Number.isFinite(want) || want <= 0) return fail("invalid_payment_requirements");
  if (!requirements.payTo || requirements.payTo.length < 26) return fail("invalid_payment_requirements");
  if (payload.x402Version !== X402_VERSION || payload.scheme !== BSV_SCHEME || payload.network !== BSV_NETWORK) {
    return fail("invalid_payload");
  }
  if (!payload.txHex || payload.txHex.length < 100 || payload.txHex.length > 2_000_000) {
    return fail("invalid_payload");
  }

  let tx: Transaction;
  try {
    tx = Transaction.fromHex(payload.txHex);
  } catch {
    return fail("invalid_payload");
  }

  let paid = 0;
  let txid = "";
  try {
    txid = tx.id("hex");
    const { P2PKH } = await import("@bsv/sdk");
    const expected = new P2PKH().lock(requirements.payTo).toHex();
    for (const out of tx.outputs) {
      try {
        if (out.lockingScript.toHex() === expected) paid += out.satoshis ?? 0;
      } catch {
        continue;
      }
    }
  } catch {
    return fail("invalid_payload");
  }

  if (paid < want) return fail("invalid_exact_bsv_payment_recipient_mismatch");

  let outTotal = 0;
  for (const o of tx.outputs) outTotal += o.satoshis ?? 0;
  if (outTotal <= 0 || outTotal > 100_000_000) return fail("invalid_payload");

  let payer = "bsv:unknown";
  if (tx.inputs.length > 0) {
    const first = tx.inputs[0]!;
    const ref = first.sourceTXID ?? first.sourceTransaction?.id("hex") ?? "";
    if (ref) payer = `bsv:input:${ref.slice(0, 16)}`;
  }

  return { success: true, payer, txid, txHex: payload.txHex, amount: paid };
}

export async function arcBroadcast(env: Env, rawTxHex: string): Promise<{ txid: string; raw: unknown }> {
  const base = str(env, "ARC_URL", "https://arc.gorillapool.io/v1").replace(/\/$/, "");
  const apiKey = str(env, "ARC_API_KEY", "");
  const res = await fetch(`${base}/tx`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}`, "X-API-Key": apiKey, api_key: apiKey } : {}),
      "XDeployment-ID": "usenet-bsv-v1",
    },
    body: JSON.stringify({ rawTx: rawTxHex }),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { raw: text.slice(0, 2000) };
  }
  if (!res.ok) {
    const err = new Error(`ARC rejected (${res.status}): ${text.slice(0, 500)}`) as Error & {
      status?: number;
      body?: unknown;
    };
    err.status = res.status;
    err.body = json;
    throw err;
  }
  const txid =
    (json["txid"] as string) ?? (json["txId"] as string) ?? (json["hash"] as string) ?? "";
  return { txid, raw: json };
}

export function mountFacilitator(app: Hono<{ Bindings: Env }>): void {
  app.get("/supported", (c) => {
    return c.json({
      kinds: [{ x402Version: X402_VERSION, scheme: BSV_SCHEME, network: BSV_NETWORK }],
      extensions: [],
      signers: {},
      asset: BSV_ASSET,
    });
  });

  app.post("/verify", async (c) => {
    let body: { paymentPayload?: BsvPaymentPayload; paymentRequirements?: BsvPaymentRequirements };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ success: false, errorReason: "invalid_payload", network: BSV_NETWORK }, 400);
    }
    if (!body.paymentPayload || !body.paymentRequirements) {
      return c.json({ success: false, errorReason: "invalid_payment_requirements", network: BSV_NETWORK }, 400);
    }
    const r = await verifyBsvPayment(body.paymentRequirements, body.paymentPayload);
    if (!r.success) return c.json({ ...r, network: BSV_NETWORK }, 402);
    return c.json({ success: true, payer: r.payer, transaction: r.txid, network: BSV_NETWORK });
  });

  app.post("/settle", async (c) => {
    let body: { paymentPayload?: BsvPaymentPayload; paymentRequirements?: BsvPaymentRequirements };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ success: false, errorReason: "invalid_payload", network: BSV_NETWORK }, 400);
    }
    if (!body.paymentPayload || !body.paymentRequirements) {
      return c.json({ success: false, errorReason: "invalid_payment_requirements", network: BSV_NETWORK }, 400);
    }
    const v = await verifyBsvPayment(body.paymentRequirements, body.paymentPayload);
    if (!v.success) return c.json({ ...v, network: BSV_NETWORK }, 402);

    try {
      const { txid } = await arcBroadcast(c.env, v.txHex);
      if (!txid) {
        return c.json(
          { success: false, errorReason: "settlement_pending", payer: v.payer, transaction: v.txid, network: BSV_NETWORK },
          202,
        );
      }
      return c.json({ success: true, payer: v.payer, transaction: txid, network: BSV_NETWORK });
    } catch (e) {
      const err = e as Error & { status?: number };
      const msg = String(err?.message ?? "broadcast failed").slice(0, 500);
      if (err?.status === undefined || (err.status >= 500 && err.status <= 599) || /timeout|abort|network/i.test(msg)) {
        return c.json(
          { success: false, errorReason: "settlement_pending", payer: v.payer, transaction: v.txid, network: BSV_NETWORK },
          202,
        );
      }
      return c.json(
        { success: false, errorReason: "invalid_transaction_state", payer: v.payer, transaction: v.txid, network: BSV_NETWORK, detail: msg },
        402,
      );
    }
  });
}
