import { P2PKH, PrivateKey, Script, Transaction } from '@bsv/sdk';

const WOC = 'https://api.whatsonchain.com/v1/bsv/main';
const WIF_STORAGE_KEY = 'usenetbsv.wallet.wif';

export function generateWif() {
  return PrivateKey.fromRandom().toWif();
}

export function loadWif() {
  try {
    return localStorage.getItem(WIF_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeWif(wif) {
  try {
    localStorage.setItem(WIF_STORAGE_KEY, wif);
  } catch {
    /* private mode */
  }
}

export function clearWif() {
  try {
    localStorage.removeItem(WIF_STORAGE_KEY);
  } catch {
    /* noop */
  }
}

async function fetchParentTx(txid) {
  const res = await fetch(`${WOC}/tx/${txid}/hex`);
  if (!res.ok) throw new Error(`parent tx fetch failed (${res.status})`);
  const text = (await res.text()).trim().replace(/^"|"$/g, '');
  return Transaction.fromHex(text);
}

/**
 * Browser burner wallet: keys live in localStorage, payments are P2PKH txs
 * signed with @bsv/sdk. Nothing is broadcast until the x402 retry, where the
 * merchant verifies and settles through ARC.
 */
export class BurnerWallet {
  constructor(wif) {
    this.wif = wif;
    this.key = PrivateKey.fromWif(wif);
    this.address = this.key.toAddress().toString();
  }

  async utxos() {
    const res = await fetch(`${WOC}/address/${this.address}/unspent`);
    if (!res.ok) throw new Error(`UTXO fetch failed (${res.status})`);
    const data = await res.json();
    const selfScript = new P2PKH().lock(this.address).toHex();
    return (Array.isArray(data) ? data : [])
      .map((u) => ({
        txid: u.tx_hash ?? u.txid,
        vout: u.tx_pos ?? u.vout ?? 0,
        satoshis: u.value ?? u.satoshis ?? 0,
        script: u.script ?? selfScript,
      }))
      .filter((u) => u.txid && u.satoshis > 1)
      .sort((a, b) => a.satoshis - b.satoshis);
  }

  async balance() {
    const list = await this.utxos();
    return list.reduce((sum, u) => sum + u.satoshis, 0);
  }

  /** Build + sign a P2PKH payment. Returns raw tx hex for the x402 payload. */
  async buildPayment(payTo, amountSats, onStage = () => {}) {
    onStage('fetching');
    const utxos = await this.utxos();
    const feeFor = (n) => Math.max(40, 20 * n + 20);

    const picked = [];
    let total = 0;
    for (const u of utxos) {
      picked.push(u);
      total += u.satoshis;
      if (total >= amountSats + feeFor(picked.length)) break;
    }
    const fee = feeFor(picked.length);
    if (total < amountSats + fee) {
      throw new Error(
        `Insufficient funds: ${total} sats available, ${amountSats + fee} needed (price + network fee). Fund the wallet and retry.`,
      );
    }

    onStage('building');
    const tx = new Transaction();
    for (const u of picked) {
      let sourceTransaction;
      try {
        sourceTransaction = await fetchParentTx(u.txid);
      } catch {
        sourceTransaction = undefined;
      }
      tx.addInput({
        sourceTransaction,
        sourceTXID: u.txid,
        sourceOutputIndex: u.vout,
        unlockingScriptTemplate: new P2PKH().unlock(this.key, 'all', false, u.satoshis, Script.fromHex(u.script)),
        sequence: 0xffffffff,
      });
    }
    tx.addOutput({ lockingScript: new P2PKH().lock(payTo), satoshis: amountSats });
    const change = total - amountSats - fee;
    if (change >= 2) tx.addOutput({ lockingScript: new P2PKH().lock(this.address), satoshis: change });

    onStage('signing');
    await tx.sign();
    return tx.toHex();
  }
}
