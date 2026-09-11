import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useWallet } from '../lib/wallet-context';
import { sats, shortAddr } from '../lib/format';

const LINKS = [
  ['/', 'Home', true],
  ['/groups', 'Groups'],
  ['/latest', 'Latest'],
  ['/api', 'API'],
  ['/nntp', 'NNTP'],
];

export default function Nav() {
  const { address, balance, openModal } = useWallet();

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link to="/" className="nav-logo">
          <span className="nav-logo-mark">@</span>
          usenet<span style={{ color: 'var(--accent)' }}>.bsv</span>
          <small>micropayment newsgroups</small>
        </Link>
        <div className="nav-links">
          {LINKS.map(([to, label, end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              {label}
            </NavLink>
          ))}
        </div>
        <div className="nav-actions">
          <button className="wallet-btn" onClick={openModal} title={address ?? 'Set up a wallet'}>
            {address ? <span className="wallet-dot" /> : null}
            {address ? (
              <>
                <span className="addr">{shortAddr(address, 6, 4)}</span>
                <span className="bal">{balance === null ? '…' : `${sats(balance)}`} sats</span>
              </>
            ) : (
              'Connect wallet'
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}
