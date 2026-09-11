import React, { useState } from 'react';
import Modal from './Modal';
import PayDialog from './PayDialog';
import { PaymentRequired, api } from '../lib/api';
import { useToast } from '../lib/toast-context';
import { sats } from '../lib/format';

export default function Composer({ group, parent, onPosted, onClose }) {
  const toast = useToast();
  const [subject, setSubject] = useState(parent ? `Re: ${parent.subject}` : '');
  const [body, setBody] = useState('');
  const [nick, setNick] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [challenge, setChallenge] = useState(null);

  const postPrice = group?.postPriceSats ?? 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        subject: subject.trim(),
        body: body.trim(),
      };
      if (nick.trim()) payload.nick = nick.trim();
      if (price !== '' && Number(price) > 0) payload.readPriceSats = Number(price);
      if (parent) payload.parentId = parent.id;
      const data = await api.post(group.name, payload);
      toast.ok(`Posted to #${group.name}`, 'Published');
      onPosted(data);
    } catch (e) {
      if (e instanceof PaymentRequired) {
        setChallenge(e);
      } else {
        setError(e.message);
        toast.err(e.message, 'Could not post');
      }
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <PayDialog
        title={`Post to #${group.name}`}
        challenge={challenge}
        onClose={() => setChallenge(null)}
        onPaid={(result) => {
          setChallenge(null);
          toast.ok(`Posted to #${group.name}`, 'Published');
          onPosted(result.data);
        }}
      />
    );
  }

  const valid = subject.trim().length > 0 && body.trim().length > 0;

  return (
    <Modal
      title={parent ? `Reply in #${group.name}` : `New post in #${group.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !valid}>
            {busy ? (
              <>
                <span className="spinner" /> Posting…
              </>
            ) : (
              `Post · ${sats(postPrice)} sats`
            )}
          </button>
        </>
      }
    >
      {error ? <div className="alert alert-error">{error}</div> : null}
      <div className="field">
        <label>Subject</label>
        <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder="What is this about?" />
      </div>
      <div className="field">
        <label>Body</label>
        <textarea
          className="textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={200000}
          placeholder="Plain text. Markdown is not interpreted — this is Usenet, after all."
        />
        <span className="hint">{body.length.toLocaleString()} / 200,000 characters</span>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Nickname (optional)</label>
          <input className="input" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={32} placeholder="Shown instead of your address" />
        </div>
        <div className="field">
          <label>Charge per read (optional)</label>
          <input
            className="input"
            type="number"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={group?.readPriceDefault ? `${group.readPriceDefault} (group default)` : 'Free'}
          />
          <span className="hint">Sats a reader pays to see this post. Blank = group default.</span>
        </div>
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--faint)' }}>
        Posting costs <strong className="num" style={{ color: 'var(--accent)' }}>{sats(postPrice)} sats</strong> paid to the group
        owner. You will sign one transaction in your browser wallet.
      </p>
    </Modal>
  );
}
