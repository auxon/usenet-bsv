import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BurnerWallet, clearWif, generateWif, loadWif, storeWif } from './wallet';

const WalletCtx = createContext(null);

export function WalletProvider({ children }) {
  const [wallet, setWallet] = useState(() => {
    const wif = loadWif();
    if (!wif) return null;
    try {
      return new BurnerWallet(wif);
    } catch {
      clearWif();
      return null;
    }
  });
  const [balance, setBalance] = useState(null);
  const [balanceError, setBalanceError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!wallet) {
      setBalance(null);
      return;
    }
    try {
      const b = await wallet.balance();
      setBalance(b);
      setBalanceError(null);
    } catch (e) {
      setBalanceError(e.message);
    }
  }, [wallet]);

  useEffect(() => {
    void refresh();
    if (!wallet) return undefined;
    const t = setInterval(() => void refresh(), 30000);
    return () => clearInterval(t);
  }, [wallet, refresh]);

  const connect = useCallback(() => {
    const wif = generateWif();
    storeWif(wif);
    setWallet(new BurnerWallet(wif));
  }, []);

  const disconnect = useCallback(() => {
    clearWif();
    setWallet(null);
    setBalance(null);
  }, []);

  const value = useMemo(
    () => ({
      wallet,
      address: wallet?.address ?? null,
      balance,
      balanceError,
      refresh,
      connect,
      disconnect,
      modalOpen,
      openModal: () => setModalOpen(true),
      closeModal: () => setModalOpen(false),
    }),
    [wallet, balance, balanceError, refresh, connect, disconnect, modalOpen],
  );

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider');
  return ctx;
}
