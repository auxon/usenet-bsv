import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { WalletProvider } from './lib/wallet-context';
import { ToastProvider } from './lib/toast-context';
import Nav from './components/Nav';
import WalletModal from './components/WalletModal';
import Home from './pages/Home';
import Groups from './pages/Groups';
import Group from './pages/Group';
import Article from './pages/Article';
import Latest from './pages/Latest';
import ApiDocs from './pages/ApiDocs';
import NntpDocs from './pages/NntpDocs';
import NotFound from './pages/NotFound';

const BASENAME = window.location.pathname.startsWith('/usenetbsv') ? '/usenetbsv' : '/';

export default function App() {
  return (
    <WalletProvider>
      <ToastProvider>
        <BrowserRouter basename={BASENAME}>
          <Nav />
          <main className="wrap">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/groups" element={<Groups />} />
              <Route path="/g/:name" element={<Group />} />
              <Route path="/g/:name/a/:id" element={<Article />} />
              <Route path="/latest" element={<Latest />} />
              <Route path="/api" element={<ApiDocs />} />
              <Route path="/nntp" element={<NntpDocs />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <WalletModal />
          <footer className="foot">
            <div className="foot-inner">
              <span>
                UsenetBSV — newsgroups settled in sats over x402 on Bitcoin SV.
              </span>
              <a href="https://entangleit.com" target="_blank" rel="noreferrer">
                entangleit.com
              </a>
              <a href="https://x402.org" target="_blank" rel="noreferrer">
                x402
              </a>
              <span className="sp">No accounts · no ads · your address is your identity</span>
            </div>
          </footer>
        </BrowserRouter>
      </ToastProvider>
    </WalletProvider>
  );
}
