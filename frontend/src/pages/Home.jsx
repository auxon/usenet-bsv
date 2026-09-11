import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { sats } from '../lib/format';
import ArticleRow from '../components/ArticleRow';

function Stat({ value, label, accent }) {
  return (
    <div className="stat">
      <div className={`v ${accent ? 'amber' : ''}`}>{value}</div>
      <div className="k">{label}</div>
    </div>
  );
}

export default function Home() {
  const [stats, setStats] = useState(null);
  const [groups, setGroups] = useState(null);
  const [latest, setLatest] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.stats(), api.groups(), api.latest(8), api.pricing()])
      .then(([st, gr, la, pr]) => {
        setStats(st);
        setGroups(gr.groups ?? []);
        setLatest(la.articles ?? []);
        setPricing(pr);
      })
      .catch((e) => setError(e.message));
  }, []);

  const p = pricing?.prices ?? {};

  return (
    <div className="page">
      <header className="hero">
        <div className="hero-grid">
          <div>
            <span className="hero-eyebrow">
              <span className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
              x402 · Bitcoin SV · NNTP
            </span>
            <h1>
              Newsgroups where <span className="grad">every action settles in sats.</span>
            </h1>
            <p className="hero-lede">
              UsenetBSV is a federated discussion network with micropayments built into the protocol. Posting,
              reading, and relaying are paid per action over x402 on BSV mainnet. No accounts, no ads, no
              subscriptions — your paying address is your identity.
            </p>
            <div className="hero-cta">
              <Link className="btn btn-primary btn-lg" to="/groups">
                Browse groups
              </Link>
              <Link className="btn btn-secondary btn-lg" to="/api">
                How payments work
              </Link>
            </div>
            <p className="hero-note">Free feeds and previews · paid actions quote a 402 with price and payTo · ~20 sats to post</p>
          </div>

          <div className="terminal" aria-hidden="true">
            <div className="terminal-bar">
              <i /><i /><i />
              <span>x402 in practice</span>
            </div>
            <div className="terminal-body">
              <span className="ln"><span className="t-dim">$</span> curl -s -X POST .../groups/bsv.devs/post</span>
              <span className="ln t-dim">&lt; HTTP/2 402 Payment Required</span>
              <span className="ln"><span className="t-amber">payment-required:</span> eyJ4NDAyVmVyc2lvbiI6Mi...</span>
              <span className="ln t-dim">{'{'}</span>
              <span className="ln t-dim">{'  '}"error": "payment_required",</span>
              <span className="ln"><span className="t-dim">{'  '}"priceSats":</span> <span className="t-blue">20</span><span className="t-dim">,</span></span>
              <span className="ln t-dim">{'  '}"payTo": "1DHBH964…z8Y4"</span>
              <span className="ln t-dim">{'}'}</span>
              <span className="ln"> </span>
              <span className="ln t-dim"># wallet signs a BSV tx, retries with the proof</span>
              <span className="ln"><span className="t-dim">$</span> curl ... -H "PAYMENT-SIGNATURE: …"</span>
              <span className="ln t-green">&lt; HTTP/2 201 Created</span>
              <span className="ln t-dim">{'{'}</span>
              <span className="ln t-dim">{'  '}"messageId": "&lt;ua_9f3c…@usenet-bsv&gt;",</span>
              <span className="ln t-dim">{'  '}"settlement": {'{'} "transaction": "b7e1…" {'}'}</span>
              <span className="ln t-dim">{'}'}</span>
            </div>
          </div>
        </div>

        <div className="stats">
          <Stat value={stats ? sats(stats.groups) : '…'} label="Groups" />
          <Stat value={stats ? sats(stats.articles) : '…'} label="Articles" />
          <Stat value={stats ? sats(stats.satsSettled) : '…'} label="Sats settled" accent />
          <Stat value={stats ? sats(stats.payments) : '…'} label="On-chain payments" />
        </div>
      </header>

      {error ? <div className="alert alert-error" style={{ marginTop: '1.5rem' }}>{error}</div> : null}

      <div className="section-head">
        <h2>How it works</h2>
        <Link className="link-more" to="/api">
          Full API docs →
        </Link>
      </div>
      <div className="steps">
        <div className="card step">
          <div className="n">1</div>
          <h3>Browse for free</h3>
          <p>
            Feeds, thread lists, and message previews cost nothing. Anyone can read the network without a wallet or
            an account.
          </p>
        </div>
        <div className="card step">
          <div className="n">2</div>
          <h3>Get a 402 quote</h3>
          <p>
            Paid actions answer <code>HTTP 402</code> with a <code>PAYMENT-REQUIRED</code> header: price in sats,
            recipient address, network.
          </p>
        </div>
        <div className="card step">
          <div className="n">3</div>
          <h3>Pay &amp; retry</h3>
          <p>
            The client signs a BSV transaction, retries with <code>PAYMENT-SIGNATURE</code>, and the server verifies,
            broadcasts, and serves the result.
          </p>
        </div>
      </div>

      <div className="section-head">
        <h2>Latest from the network</h2>
        <Link className="link-more" to="/latest">
          View all →
        </Link>
      </div>
      {latest === null ? (
        <div className="load-row">
          <div className="skeleton" /><div className="skeleton" /><div className="skeleton" />
        </div>
      ) : latest.length === 0 ? (
        <div className="empty">
          <h3>No posts yet</h3>
          <p>
            Be the first — <Link to="/groups">create a group</Link> or check the API.
          </p>
        </div>
      ) : (
        <div className="thread-list">
          {latest.map((a) => (
            <ArticleRow key={a.id} article={a} groupName={a.groupName} showGroup replies={a.replyCount ?? 0} />
          ))}
        </div>
      )}

      <div className="section-head">
        <h2>Groups</h2>
        <Link className="link-more" to="/groups">
          All groups →
        </Link>
      </div>
      {groups === null ? (
        <div className="load-row">
          <div className="skeleton" style={{ height: 120 }} /><div className="skeleton" style={{ height: 120 }} />
        </div>
      ) : groups.length === 0 ? (
        <div className="empty">
          <h3>No groups yet</h3>
          <p>
            Create the first one from the <Link to="/groups">groups page</Link>.
          </p>
        </div>
      ) : (
        <div className="grid-cards">
          {groups.slice(0, 6).map((g) => (
            <Link key={g.id} to={`/g/${encodeURIComponent(g.name)}`} className="card card-hover group-card">
              <div className="name">{g.name}</div>
              <div className="desc">{g.description || 'No description yet.'}</div>
              <div className="meta">
                <span className="badge badge-amber">post {sats(g.postPriceSats)} sats</span>
                {g.readPriceDefault > 0 ? (
                  <span className="badge badge-blue">read {sats(g.readPriceDefault)} sats</span>
                ) : (
                  <span className="badge badge-green">read free</span>
                )}
                <span className="count">{sats(g.articleCount)} posts</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="section-head">
        <h2>Pricing</h2>
        <span className="link-more">every price set per group or per article</span>
      </div>
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Action</th>
              <th>Price</th>
              <th>Paid to</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Create a group</td>
              <td className="num">{sats(p.groupCreate)} sats</td>
              <td>Network operator</td>
            </tr>
            <tr>
              <td>Post to a group</td>
              <td className="num">
                {sats(p.postDefault)} sats <span style={{ color: 'var(--faint)' }}>default · owner sets</span>
              </td>
              <td>Group owner</td>
            </tr>
            <tr>
              <td>Read a priced article</td>
              <td className="num">{p.readDefault > 0 ? `${sats(p.readDefault)} sats default` : 'Author sets · default free'}</td>
              <td>Group owner</td>
            </tr>
            <tr>
              <td>Relay push / pull (federation)</td>
              <td className="num">{sats(p.relay)} sats per batch</td>
              <td>Network operator</td>
            </tr>
            <tr>
              <td>Report an article</td>
              <td className="num">{sats(p.report)} sats · 3 reports hide it</td>
              <td>Network operator</td>
            </tr>
            <tr>
              <td>Claim a nickname</td>
              <td className="num">{sats(p.nick)} sats</td>
              <td>Network operator</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="section-head">
        <h2>Talk NNTP too</h2>
      </div>
      <div className="card card-pad" style={{ display: 'flex', gap: '1.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <p style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            A public NNTP gateway is live at <code className="inline">2.29.11.72:119</code>:{' '}
            <code className="inline">GROUP</code>, <code className="inline">XOVER</code>,{' '}
            <code className="inline">ARTICLE</code>, <code className="inline">POST</code>. Paid actions answer{' '}
            <code className="inline">480</code>; clients present the x402 ticket with{' '}
            <code className="inline">AUTHINFO PAY</code>.
          </p>
        </div>
        <Link className="btn btn-ghost" to="/nntp">
          NNTP setup →
        </Link>
      </div>
    </div>
  );
}
