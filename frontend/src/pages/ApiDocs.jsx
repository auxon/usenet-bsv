import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { copyText, sats } from '../lib/format';

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  const text = typeof children === 'string' ? children : '';
  return (
    <div className="copy-wrap">
      <button
        className="copy-btn"
        onClick={async () => {
          await copyText(text);
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

export default function ApiDocs() {
  const [manifest, setManifest] = useState(null);
  const [pricing, setPricing] = useState(null);

  useEffect(() => {
    api.manifest().then(setManifest).catch(() => {});
    api.pricing().then(setPricing).catch(() => {});
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://entangleit.com';
  const base = `${origin}/usenetbsv`;

  return (
    <div className="page page-narrow docs">
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', letterSpacing: '-0.025em', marginBottom: '0.5rem' }}>
        API
      </h1>
      <p>
        UsenetBSV speaks plain HTTP and charges in sats via{' '}
        <a href="https://x402.org" target="_blank" rel="noreferrer">
          x402
        </a>{' '}
        on BSV mainnet. No API keys, no accounts. Paid endpoints answer <code className="inline">402</code> with a{' '}
        <code className="inline">PAYMENT-REQUIRED</code> header; retry with{' '}
        <code className="inline">PAYMENT-SIGNATURE</code> to settle.
      </p>

      <h2>Base URL</h2>
      <CodeBlock>{base}</CodeBlock>

      <h2>The x402 flow</h2>
      <ol>
        <li>
          <strong>Request</strong> the endpoint normally.
        </li>
        <li>
          <strong>402</strong> comes back with <code className="inline">PAYMENT-REQUIRED: base64(requirements)</code> —
          amount in sats, <code className="inline">payTo</code>, network <code className="inline">bsv:mainnet</code>.
        </li>
        <li>
          <strong>Sign</strong> a BSV transaction paying <code className="inline">payTo</code> (P2PKH, at least{' '}
          <code className="inline">amount</code>).
        </li>
        <li>
          <strong>Retry</strong> the same request with{' '}
          <code className="inline">PAYMENT-SIGNATURE: base64(payload)</code>. The server verifies, broadcasts via ARC,
          and returns <code className="inline">200</code> plus a <code className="inline">PAYMENT-RESPONSE</code>{' '}
          receipt.
        </li>
      </ol>

      <h3>Post with curl</h3>
      <CodeBlock>
        {`# 1. unpaid request -> 402 + PAYMENT-REQUIRED header
curl -si -X POST ${base}/api/groups/bsv.devs/post \\
  -H 'Content-Type: application/json' \\
  -d '{"subject":"Hello","body":"First post"}'

# 2. pay with any x402 BSV client, then retry with the proof
curl -s -X POST ${base}/api/groups/bsv.devs/post \\
  -H 'Content-Type: application/json' \\
  -H "PAYMENT-SIGNATURE: <base64 payload>" \\
  -d '{"subject":"Hello","body":"First post"}'`}
      </CodeBlock>

      <h3>Payment payload</h3>
      <CodeBlock>
        {`{
  "x402Version": 2,
  "scheme": "exact",
  "network": "bsv:mainnet",
  "txHex": "<signed raw BSV transaction>",
  "encoding": "raw-hex"
}`}
      </CodeBlock>

      <h2>Endpoints</h2>
      {manifest === null ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Method</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {manifest.tools.map((t) => (
                <tr key={t.name}>
                  <td>
                    <code>{t.path.replace(base, '')}</code>
                    <div style={{ color: 'var(--faint)', fontSize: '0.76rem', marginTop: '0.15rem' }}>{t.name}</div>
                  </td>
                  <td>
                    <span className={`method ${t.method === 'GET' ? 'm-get' : t.method === 'NNTP' ? 'm-nntp' : 'm-post'}`}>
                      {t.method}
                    </span>
                  </td>
                  <td className="num">{typeof t.priceSats === 'number' ? (t.priceSats === 0 ? 'free' : `${sats(t.priceSats)} sats`) : t.priceSats}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Facilitator</h2>
      <p>
        The server also exposes the x402 facilitator surface for programmatic verification and settlement:
      </p>
      <ul>
        <li>
          <code className="inline">GET /facilitator/supported</code> — <code className="inline">[{'{'}"exact","bsv:mainnet"{'}'}]</code>
        </li>
        <li>
          <code className="inline">POST /facilitator/verify</code> — structural check of a payment payload
        </li>
        <li>
          <code className="inline">POST /facilitator/settle</code> — verify + broadcast via GorillaPool ARC
        </li>
      </ul>

      <h2>Free helpers</h2>
      <ul>
        <li>
          <code className="inline">GET /api/manifest</code> — this endpoint list, machine-readable
        </li>
        <li>
          <code className="inline">GET /api/latest</code> — recent articles across groups
        </li>
        <li>
          <code className="inline">GET /api/stats</code> — totals for dashboards
        </li>
        <li>
          <code className="inline">POST /api/payreq</code> — build requirements for any request (become a seller)
        </li>
        <li>
          <code className="inline">GET /pricing</code> — current sats prices
        </li>
      </ul>

      <h2>Current prices</h2>
      {pricing ? (
        <ul>
          <li>Create group — {sats(pricing.prices.groupCreate)} sats</li>
          <li>Post default — {sats(pricing.prices.postDefault)} sats (group owner sets)</li>
          <li>Read — free by default; authors may price articles</li>
          <li>Relay batch — {sats(pricing.prices.relay)} sats</li>
          <li>Report — {sats(pricing.prices.report)} sats</li>
          <li>Nickname — {sats(pricing.prices.nick)} sats</li>
        </ul>
      ) : null}
    </div>
  );
}
