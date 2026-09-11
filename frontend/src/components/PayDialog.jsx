import React, { useState } from 'react';
import Modal from './Modal';
import CopyChip from './CopyChip';
import { useWallet } from '../lib/wallet-context';
import { useToast } from '../lib/toast-context';
import { sats, shortAddr } from '../lib/format';

const STAGES = [
  ['fetching', 'Fetching wallet UTXOs'],
  ['building', 'Building transaction'],
  ['signing', 'Signing with your key'],
  ['settling', 'Broadcasting & verifying via ARC'],
  ['done', 'Settled on-chain'],
];

export default function PayDialog({ challenge, onPaid, onClose, title = 'Confirm payment' }) {
  const { wallet, balance, openModal, refresh } = useWallet();
  const toast = useToast();
  const [stage, setStage] = useState(null);
  const [error, setError] = useState(null);
  const busy = stage !== null && stage !== 'done';

  const price = challenge?.priceSats ?? 0;
  const insufficient = balance !== null && balance < price + 60;

  async function pay() {
    setError(null);
    try {
      const result = await challenge.pay(wallet, (s) => setStage(s));
      toast.ok(`Paid ${sats(price)} sats · ${result.data?.settlement?.transaction?.slice(0, 12) ?? ''}…`, 'Settled');
      await refresh();
      onPaid(result);
    } catch (e) {
      setError(e.message);
      setStage(null);
      toast.err(e.message, 'Payment failed');
    }
  }

  return (
    <Modal
      title={title}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={pay} disabled={busy || !wallet || insufficient}>
            {busy ? (
              <>
                <span className="spinner" /> Paying…
              </>
            ) : (
              `Pay ${sats(price)} sats`
            )}
          </button>
        </>
      }
    >
      <div className="kv">
        <div className="row">
          <span className="k">Resource</span>
          <span className="v">{challenge?.body?.description ?? challenge?.requirements?.resource?.description ?? challenge?.url ?? '—'}</span>
        </div>
        <div className="row">
          <span className="k">Amount</span>
          <span className="v num" style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {sats(price)} sats
          </span>
        </div>
        <div className="row">
          <span className="k">Recipient</span>
          <span className="v">{challenge?.payTo ? <CopyChip value={challenge.payTo} /> : '—'}</span>
        </div>
        <div className="row">
          <span className="k">Wallet balance</span>
          <span className="v num">
            {wallet ? (balance === null ? '…' : `${sats(balance)} sats`) : 'No wallet connected'}
          </span>
        </div>
        <div className="row">
          <span className="k">Network</span>
          <span className="v">
            <span className="badge badge-amber">
              <span className="dot" /> x402 · bsv:mainnet
            </span>
          </span>
        </div>
      </div>

      {!wallet ? (
        <div className="alert alert-info" style={{ marginTop: '1rem' }}>
          You need a wallet to pay. Create a browser wallet, fund it with sats, and retry.
          <div style={{ marginTop: '0.6rem' }}>
            <button className="btn btn-secondary btn-sm" onClick={openModal}>
              Set up wallet
            </button>
          </div>
        </div>
      ) : null}

      {wallet && insufficient ? (
        <div className="alert alert-error" style={{ marginTop: '1rem' }}>
          Not enough sats (need ~{sats(price + 60)} incl. network fee).{' '}
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: '0.4rem' }} onClick={openModal}>
            Fund wallet
          </button>
        </div>
      ) : null}

      {stage ? (
        <div className="pay-steps">
          {STAGES.map(([key, label]) => {
            const idx = STAGES.findIndex(([k]) => k === stage);
            const thisIdx = STAGES.findIndex(([k]) => k === key);
            const cls = thisIdx < idx || stage === 'done' && key === 'done' ? 'done' : thisIdx === idx ? 'active' : '';
            return (
              <div key={key} className={`pay-step ${cls}`}>
                <span className="ic">{cls === 'done' ? '✓' : thisIdx === idx ? '•' : ''}</span>
                {label}
              </div>
            );
          })}
        </div>
      ) : null}

      {error ? <div className="alert alert-error" style={{ marginTop: '0.8rem' }}>{error}</div> : null}

      <p style={{ fontSize: '0.74rem', color: 'var(--faint)', marginTop: '0.9rem' }}>
        Your browser signs a BSV transaction and retries the request with a{' '}
        <code className="inline">PAYMENT-SIGNATURE</code> header. The server verifies and broadcasts it; the receipt
        comes back in <code className="inline">PAYMENT-RESPONSE</code>.
      </p>
    </Modal>
  );
}
