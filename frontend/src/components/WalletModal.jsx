import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import { useWallet } from '../lib/wallet-context';
import { copyText, sats } from '../lib/format';

export default function WalletModal() {
  const { wallet, address, balance, balanceError, connect, disconnect, refresh, modalOpen, closeModal } = useWallet();
  const [qr, setQr] = useState(null);
  const [showWif, setShowWif] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!wallet || !address) {
      setQr(null);
      return undefined;
    }
    import('qrcode')
      .then((mod) => mod.default.toDataURL(`bsv:${address}`, { width: 220, margin: 1, color: { dark: '#000', light: '#fff' } }))
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [wallet, address]);

  if (!modalOpen) return null;

  async function copyAddress() {
    await copyText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <Modal title={wallet ? 'Browser wallet' : 'Create a wallet'} onClose={closeModal}>
      {!wallet ? (
        <>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            UsenetBSV has no sign-up. To post, create a group, or unlock paid articles you need an address with
            sats. This wallet is generated in your browser — the key never leaves this device.
          </p>
          <ul style={{ color: 'var(--muted)', fontSize: '0.86rem', paddingLeft: '1.2rem', margin: '0.9rem 0' }}>
            <li>Key stored in this browser's localStorage (burner wallet)</li>
            <li>Fund it with any BSV wallet — small amounts are fine</li>
            <li>Payments are standard P2PKH transactions settled via x402</li>
          </ul>
          <button className="btn btn-primary btn-block" onClick={connect}>
            Generate browser wallet
          </button>
        </>
      ) : (
        <>
          <div className="qr-box">{qr ? <img src={qr} alt="Wallet address QR" width={200} height={200} /> : <div style={{ width: 200, height: 200 }} className="skeleton" />}</div>
          <div className="kv" style={{ marginTop: '1.1rem' }}>
            <div className="row">
              <span className="k">Address</span>
              <span className="v mono" style={{ fontSize: '0.78rem' }}>{address}</span>
            </div>
            <div className="row">
              <span className="k">Balance</span>
              <span className="v num" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                {balance === null ? '…' : `${sats(balance)} sats`}
              </span>
            </div>
          </div>
          {balanceError ? <div className="alert alert-error" style={{ marginTop: '0.7rem' }}>{balanceError}</div> : null}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
            <button className="btn btn-primary btn-sm" onClick={copyAddress}>
              {copied ? 'Copied ✓' : 'Copy address'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
              Refresh balance
            </button>
            <a
              className="btn btn-ghost btn-sm"
              href={`https://whatsonchain.com/address/${address}`}
              target="_blank"
              rel="noreferrer"
            >
              Explorer ↗
            </a>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--faint)', marginTop: '0.9rem' }}>
            Send sats to this address from any BSV wallet. Balances refresh every 30 seconds. Keep amounts small —
            this is a hot wallet in your browser.
          </p>
          <div style={{ marginTop: '1rem', borderTop: '1px solid var(--line)', paddingTop: '0.9rem' }}>
            {showWif ? (
              <div className="alert alert-error" style={{ wordBreak: 'break-all' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>Private key (WIF) — keep secret</div>
                <code style={{ fontSize: '0.74rem' }}>{wallet.wif}</code>
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowWif((v) => !v)}>
                {showWif ? 'Hide private key' : 'Export private key'}
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  if (confirm('Disconnect this wallet? The key stays in this browser until you clear site data. Make sure you exported it if you funded it.')) {
                    disconnect();
                    closeModal();
                  }
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
