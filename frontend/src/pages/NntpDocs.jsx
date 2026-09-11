import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { copyText } from '../lib/format';

function CodeBlock({ children, copy }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-wrap">
      <button
        className="copy-btn"
        onClick={async () => {
          await copyText(copy ?? (typeof children === 'string' ? children : ''));
          setCopied(true);
          setTimeout(() => setCopied(false), 1300);
        }}
      >
        {copied ? 'copied ✓' : 'copy'}
      </button>
      <pre className="code">{children}</pre>
    </div>
  );
}

export default function NntpDocs() {
  const [nntp, setNntp] = useState(null);

  useEffect(() => {
    api.nntp().then(setNntp).catch(() => {});
  }, []);

  const host = nntp?.host ?? '2.29.11.72';
  const port = nntp?.port ?? 119;
  const fallback = nntp?.fallbackPort ?? 8119;

  return (
    <div className="page page-narrow docs">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.025em', marginBottom: '0.5rem' }}>
        NNTP gateway
      </h1>
      <p>
        Classic newsreaders can talk to UsenetBSV through the public NNTP gateway. It proxies to the same HTTP API,
        so every paid action is still verified and settled in the worker — the gateway holds no keys.
      </p>

      <h2>Connect</h2>
      <div className="panel" style={{ marginBottom: '1rem' }}>
        <div className="kv">
          <div className="row">
            <span className="k">Host</span>
            <span className="v mono">{host}</span>
          </div>
          <div className="row">
            <span className="k">Port</span>
            <span className="v mono">
              {port} <span style={{ color: 'var(--faint)' }}>(standard)</span> · {fallback}{' '}
              <span style={{ color: 'var(--faint)' }}>(fallback)</span>
            </span>
          </div>
          <div className="row">
            <span className="k">Encryption</span>
            <span className="v mono">none (plain TCP, v1)</span>
          </div>
          <div className="row">
            <span className="k">Account</span>
            <span className="v mono">none — pay per action with AUTHINFO PAY</span>
          </div>
        </div>
      </div>
      <p>Try it from a terminal:</p>
      <CodeBlock copy={`nc ${host} ${port}`}>{`nc ${host} ${port}
200 usenet-bsv NNTP gateway ready (AUTHINFO PAY for paid actions)`}</CodeBlock>

      <h2>Run your own gateway</h2>
      <p>The gateway is also in the repo if you want to host one next to your reader:</p>
      <CodeBlock>
        {`cd usenet-bsv
USENET_BASE_URL=https://entangleit.com/usenetbsv \\
GATEWAY_PORT=1119 GATEWAY_HOST=0.0.0.0 \\
node gateway/nntp-gateway.mjs`}
      </CodeBlock>

      <h2>Paid actions</h2>
      <p>
        When an action requires payment the gateway answers <code className="inline">480</code> with the price and
        recipient. Pay out-of-band with any x402 BSV client, then present the ticket and retry:
      </p>
      <CodeBlock>
        {`$ telnet ${host} ${port}
200 usenet-bsv NNTP gateway ready

GROUP bsv.builders
211 1 1 1 bsv.builders

POST
340 Send article; end with <CR-LF>.<CR-LF>
# ... send headers + body + "." ...
480 Payment required price=25 payTo=1DHB…; send AUTHINFO PAY then retry POST

X-PAYREQ
282 Pending PAYMENT-REQUIRED follows
eyJ4NDAyVmVyc2lvbiI6MixzY2hlbWU6ImV4YWN0Ii...   # base64 challenge

# build + sign the BSV tx, wrap it as the x402 payload
AUTHINFO PAY eyJ4NDAyVmVyc2lvbiI6MixzY2hlbWU6...   # base64 PAYMENT-SIGNATURE
281 Payment signature accepted; retry the paid command

POST
340 Send article; end with <CR-LF>.<CR-LF>
# ... resend ...
240 Posted <ua_9f3c…@usenet-bsv> tx=b7e1…
`}
      </CodeBlock>
      <p>
        Pure-NNTP clients that cannot pay mid-session can fetch the full challenge with{' '}
        <code className="inline">X-PAYREQ</code>, pay externally, then continue.
      </p>

      <h2>Commands</h2>
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Command</th>
              <th>Behaviour</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>CAPABILITIES</code></td><td>READER, POST, OVER, HDR, AUTHINFO PAY, X-PAYREQ</td></tr>
            <tr><td><code>LIST [ACTIVE|NEWSGROUPS]</code></td><td>Group list with counts</td></tr>
            <tr><td><code>GROUP &lt;name&gt;</code></td><td>Select a group, load the latest 200 articles</td></tr>
            <tr><td><code>XOVER / OVER [range]</code></td><td>Overview lines for the range</td></tr>
            <tr><td><code>ARTICLE / HEAD / BODY [n|&lt;msgid&gt;]</code></td><td>Read; 402-backed articles return 480 until paid</td></tr>
            <tr><td><code>POST</code></td><td>340 → send headers + body; 480 if the post is paid, 240 on success</td></tr>
            <tr><td><code>CHECK / TAKETHIS</code></td><td>Federation: paid relay push, same ticket flow</td></tr>
            <tr><td><code>AUTHINFO PAY &lt;sig&gt;</code></td><td>Attach an x402 PAYMENT-SIGNATURE to the session</td></tr>
            <tr><td><code>X-PAYREQ</code></td><td>Return the last pending PAYMENT-REQUIRED challenge</td></tr>
          </tbody>
        </table>
      </div>

      <h2>Why a gateway</h2>
      <ul>
        <li>Reuses every paid endpoint — one verification and settlement path.</li>
        <li>No keys or wallet in the gateway process; it is a stateless proxy.</li>
        <li>Newsreaders keep working; the wallet-aware client pays once per action.</li>
      </ul>

      <p style={{ color: 'var(--faint)', fontSize: '0.82rem' }}>
        Plain TCP on port {port} (fallback {fallback}). TLS/NNTPS is on the roadmap.
      </p>
    </div>
  );
}
