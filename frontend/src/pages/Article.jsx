import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PaymentRequired, api } from '../lib/api';
import { buildThreads, copyText, fmtDate, linkifyParts, sats, shortAddr, timeAgo } from '../lib/format';
import { useWallet } from '../lib/wallet-context';
import { useToast } from '../lib/toast-context';
import PayDialog from '../components/PayDialog';
import Composer from '../components/Composer';
import Modal from '../components/Modal';
import CopyChip from '../components/CopyChip';

function LinkedText({ text }) {
  const parts = linkifyParts(text ?? '');
  return parts.map((p, i) =>
    p.href ? (
      <a key={i} href={p.href} target="_blank" rel="noreferrer">
        {p.text}
      </a>
    ) : (
      <React.Fragment key={i}>{p.text}</React.Fragment>
    ),
  );
}

function ReplyList({ nodes, groupName }) {
  if (!nodes.length) return null;
  return (
    <div style={{ display: 'grid', gap: '0.7rem' }}>
      {nodes.map((n) => (
        <div key={n.id} className="card card-pad" style={{ padding: '0.95rem 1.1rem' }}>
          <Link to={`/g/${encodeURIComponent(groupName)}/a/${n.id}`} style={{ fontWeight: 600, fontSize: '0.9rem' }}>
            {n.subject}
          </Link>
          <div style={{ color: 'var(--muted)', fontSize: '0.83rem', margin: '0.3rem 0 0.5rem' }}>{n.preview}</div>
          <div className="thread-meta" style={{ marginTop: 0 }}>
            <span>{shortAddr(n.from ?? n.author)}</span>
            <span className="sep" />
            <span>{timeAgo(n.createdAt)}</span>
            {n.readPriceSats > 0 ? (
              <>
                <span className="sep" />
                <span style={{ color: 'var(--accent)' }}>{sats(n.readPriceSats)} sats</span>
              </>
            ) : null}
          </div>
          <div style={{ marginTop: n.children.length ? '0.85rem' : 0, paddingLeft: n.children.length ? '0.9rem' : 0, borderLeft: n.children.length ? '1px solid var(--line)' : 'none' }}>
            <ReplyList nodes={n.children} groupName={groupName} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Article() {
  const { name, id } = useParams();
  const navigate = useNavigate();
  const { wallet, openModal } = useWallet();
  const toast = useToast();

  const [preview, setPreview] = useState(null);
  const [article, setArticle] = useState(null);
  const [group, setGroup] = useState(null);
  const [feed, setFeed] = useState([]);
  const [challenge, setChallenge] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [error, setError] = useState(null);
  const [replying, setReplying] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [proof, setProof] = useState(null);
  const [proofLoading, setProofLoading] = useState(false);

  useEffect(() => {
    setPreview(null);
    setArticle(null);
    setChallenge(null);
    setPayOpen(false);
    setError(null);
    setProof(null);

    api
      .articlePreview(id)
      .then((p) => {
        setPreview(p);
        return api.article(id).then(setArticle, (e) => {
          if (e instanceof PaymentRequired) setChallenge(e);
          else throw e;
        });
      })
      .catch((e) => setError(e.message));

    api.group(name).then(setGroup).catch(() => {});
    api
      .feed(name, { limit: 200 })
      .then((f) => setFeed(f.articles ?? []))
      .catch(() => {});
  }, [name, id]);

  const replies = useMemo(() => {
    if (!article || !feed.length) return [];
    const tree = buildThreads(feed);
    const find = (list) => {
      for (const n of list) {
        if (n.id === article.id) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return find(tree)?.children ?? [];
  }, [article, feed]);

  async function loadProof() {
    if (proof) return;
    setProofLoading(true);
    try {
      setProof(await api.proof(id));
    } catch (e) {
      toast.err(e.message, 'Proof unavailable');
    } finally {
      setProofLoading(false);
    }
  }

  async function submitReport() {
    try {
      await api.report(id, reportReason.trim());
      toast.ok('Report recorded. Three distinct reporters hide an article.', 'Reported');
      setReportOpen(false);
      setReportReason('');
    } catch (e) {
      if (e instanceof PaymentRequired) {
        setChallenge(e);
        setReportOpen(false);
        setPayOpen(true);
      } else {
        toast.err(e.message, 'Report failed');
      }
    }
  }

  function unlock() {
    if (challenge) {
      setPayOpen(true);
      return;
    }
    api.article(id).then(setArticle, (e) => {
      if (e instanceof PaymentRequired) {
        setChallenge(e);
        setPayOpen(true);
      } else {
        toast.err(e.message, 'Could not load article');
      }
    });
  }

  if (error) {
    return (
      <div className="page page-narrow">
        <div className="alert alert-error">{error}</div>
        <Link className="btn btn-ghost" to={`/g/${encodeURIComponent(name)}`}>
          ← #{name}
        </Link>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="page page-narrow">
        <div className="load-row">
          <div className="skeleton" style={{ height: 36, width: '60%' }} />
          <div className="skeleton" style={{ height: 200 }} />
        </div>
      </div>
    );
  }

  const shown = article ?? preview;
  const txid = shown.createdTx || article?.createdTx;
  const shownPrice = article ? (article.priceSats ?? 0) : (preview.readPriceSats ?? 0);

  return (
    <div className="page page-narrow">
      <Link
        to={`/g/${encodeURIComponent(name)}`}
        style={{ fontSize: '0.83rem', color: 'var(--muted)' }}
      >
        ← #{name}
      </Link>

      <header className="article-head" style={{ marginTop: '1rem' }}>
        <span className="article-meta">
          {article ? (
            <>
              <span>{shortAddr(article.from ?? article.author)}</span>
              <span className="sep" />
            </>
          ) : null}
          <span title={fmtDate(shown.createdAt)}>{timeAgo(shown.createdAt)}</span>
          {shownPrice > 0 ? (
            <>
              <span className="sep" />
              <span style={{ color: 'var(--accent)' }}>
                {sats(shownPrice)} sats {article ? '· unlocked' : ''}
              </span>
            </>
          ) : (
            <>
              <span className="sep" />
              <span style={{ color: 'var(--green)' }}>free</span>
            </>
          )}
          {!article ? (
            <>
              <span className="sep" />
              <span className="badge badge-amber">locked preview</span>
            </>
          ) : null}
        </span>
        <h1>{shown.subject}</h1>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <CopyChip value={shown.messageId} prefix="msg" />
          <CopyChip value={shown.digest} prefix="sha256" />
          {txid ? (
            <a
              className="chip"
              href={`https://whatsonchain.com/tx/${txid}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--muted)' }}
            >
              {shortAddr(txid, 8, 6)} ↗
            </a>
          ) : null}
        </div>
      </header>

      {article ? (
        <>
          <div className="article-body">
            <LinkedText text={article.body} />
          </div>
          <div className="article-foot">
            <button className="btn btn-secondary btn-sm" onClick={() => setReplying(true)}>
              Reply · {group ? sats(group.postPriceSats) : '…'} sats
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setReportOpen(true)}>
              Report
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                await copyText(`${window.location.origin}/usenetbsv/g/${name}/a/${id}`);
                toast.ok('Link copied');
              }}
            >
              Copy link
            </button>
          </div>

          <details className="proof" onToggle={(e) => e.target.open && loadProof()}>
            <summary>⛓ Integrity proof {proof?.anchored ? '· anchored' : ''}</summary>
            <div className="proof-body">
              {proofLoading ? (
                <span style={{ color: 'var(--faint)' }}>Loading proof…</span>
              ) : proof ? (
                <>
                  <div className="proof-row">
                    <span className="k">Article hash</span>
                    <span className="v">{proof.digest}</span>
                  </div>
                  {proof.anchored ? (
                    <>
                      <div className="proof-row">
                        <span className="k">Anchor batch</span>
                        <span className="v">{proof.anchorId}</span>
                      </div>
                      <div className="proof-row">
                        <span className="k">Merkle root</span>
                        <span className="v">{proof.root}</span>
                      </div>
                      <div className="proof-row">
                        <span className="k">Batch size</span>
                        <span className="v">{proof.count} articles</span>
                      </div>
                    </>
                  ) : (
                    <span style={{ color: 'var(--faint)' }}>Not included in an anchor batch yet.</span>
                  )}
                  <div className="proof-row">
                    <span className="k">Created by tx</span>
                    <span className="v">
                      {proof.createdTx ? (
                        <a href={`https://whatsonchain.com/tx/${proof.createdTx}`} target="_blank" rel="noreferrer">
                          {proof.createdTx}
                        </a>
                      ) : (
                        '—'
                      )}
                    </span>
                  </div>
                </>
              ) : null}
            </div>
          </details>

          <div className="section-head">
            <h2 style={{ fontSize: '1.05rem' }}>
              {replies.length > 0 ? `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : 'Replies'}
            </h2>
          </div>
          {replies.length === 0 ? (
            <p style={{ color: 'var(--faint)', fontSize: '0.85rem' }}>No replies yet.</p>
          ) : (
            <ReplyList nodes={replies} groupName={name} />
          )}
        </>
      ) : (
        <div className="lock">
          <div className="lock-preview">{preview.preview}</div>
          <div className="lock-bar">
            <div>
              <div className="price num">
                {sats(preview.readPriceSats)} <small>sats to unlock</small>
              </div>
            </div>
            <div className="grow" />
            <button className="btn btn-ghost" onClick={() => setReportOpen(true)}>
              Report
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!wallet) {
                  openModal();
                  return;
                }
                unlock();
              }}
            >
              {wallet ? `Unlock for ${sats(preview.readPriceSats)} sats` : 'Connect wallet to unlock'}
            </button>
          </div>
        </div>
      )}

      {challenge && payOpen ? (
        <PayDialog
          title="Unlock article"
          challenge={challenge}
          onClose={() => setPayOpen(false)}
          onPaid={(result) => {
            setArticle(result.data);
            setPayOpen(false);
            setChallenge(null);
          }}
        />
      ) : null}

      {replying && group ? (
        <Composer
          group={group}
          parent={{ id: article?.id ?? preview.id, subject: shown.subject }}
          onClose={() => setReplying(false)}
          onPosted={(posted) => {
            setReplying(false);
            toast.ok('Reply posted');
            navigate(`/g/${encodeURIComponent(name)}/a/${posted.id}`);
          }}
        />
      ) : null}

      {reportOpen ? (
        <Modal
          title="Report article"
          onClose={() => setReportOpen(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setReportOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={submitReport}>
                Report · 5 sats
              </button>
            </>
          }
        >
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
            Reporting costs a small fee to prevent griefing. Articles reported by three distinct payers are hidden
            from feeds. The payment settles on-chain and the article's integrity proof remains.
          </p>
          <div className="field" style={{ marginTop: '1rem' }}>
            <label>Reason (optional)</label>
            <input
              className="input"
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              maxLength={280}
              placeholder="Spam, abuse, illegal content…"
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
