import React, { useState } from 'react';
import Modal from './Modal';
import PayDialog from './PayDialog';
import { PaymentRequired, api } from '../lib/api';
import { useWallet } from '../lib/wallet-context';
import { useToast } from '../lib/toast-context';

export default function CreateGroupModal({ onCreated, onClose }) {
  const { address } = useWallet();
  const toast = useToast();
  const [form, setForm] = useState({
    name: '',
    description: '',
    postPriceSats: 20,
    readPriceDefault: 0,
    payTo: address ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [challenge, setChallenge] = useState(null);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data = await api.createGroup({
        name: form.name.trim().toLowerCase(),
        description: form.description.trim(),
        postPriceSats: Number(form.postPriceSats) || 0,
        readPriceDefault: Number(form.readPriceDefault) || 0,
        payTo: form.payTo.trim(),
      });
      toast.ok(`Group #${data.name} created`, 'Created');
      onCreated(data);
    } catch (e) {
      if (e instanceof PaymentRequired) {
        setChallenge(e);
      } else {
        setError(e.message);
        toast.err(e.message, 'Could not create group');
      }
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <PayDialog
        title={`Create #${form.name}`}
        challenge={challenge}
        onClose={() => setChallenge(null)}
        onPaid={(result) => {
          setChallenge(null);
          toast.ok(`Group #${result.data.name} created`, 'Created');
          onCreated(result.data);
        }}
      />
    );
  }

  return (
    <Modal
      title="Create a newsgroup"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !form.name.trim() || !form.payTo.trim()}>
            {busy ? (
              <>
                <span className="spinner" /> Creating…
              </>
            ) : (
              'Create · 500 sats'
            )}
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="field">
        <label>Group name</label>
        <input
          className="input"
          value={form.name}
          onChange={(e) => set('name', e.target.value.toLowerCase())}
          placeholder="e.g. bsv.builders"
          maxLength={61}
        />
        <span className="hint">Lowercase letters, digits, dots and dashes (3–61 chars).</span>
      </div>
      <div className="field">
        <label>Description</label>
        <input className="input" value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={280} placeholder="What is this group about?" />
      </div>
      <div className="field-row">
        <div className="field">
          <label>Post price (sats)</label>
          <input className="input" type="number" min="0" value={form.postPriceSats} onChange={(e) => set('postPriceSats', e.target.value)} />
          <span className="hint">What posters pay you per post.</span>
        </div>
        <div className="field">
          <label>Default read price (sats)</label>
          <input className="input" type="number" min="0" value={form.readPriceDefault} onChange={(e) => set('readPriceDefault', e.target.value)} />
          <span className="hint">0 = posts are free to read.</span>
        </div>
      </div>
      <div className="field">
        <label>Owner payout address</label>
        <input className="input" value={form.payTo} onChange={(e) => set('payTo', e.target.value)} placeholder="1..." />
        <span className="hint">
          Post fees are paid straight to this BSV address.{address ? ' Prefilled with your wallet address — change it to use an external wallet.' : ''}
        </span>
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--faint)' }}>
        Group creation costs <strong className="num" style={{ color: 'var(--accent)' }}>500 sats</strong> (anti-squat fee to the
        network operator).
      </p>
    </Modal>
  );
}
