import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastCtx = createContext(null);
let seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, kind = 'ok', title) => {
      const id = ++seq;
      setToasts((list) => [...list.slice(-3), { id, message, kind, title }]);
      const timer = setTimeout(() => dismiss(id), kind === 'err' ? 7000 : 4500);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const toast = {
    ok: (msg, title) => push(msg, 'ok', title),
    err: (msg, title) => push(msg, 'err', title),
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role="status" onClick={() => dismiss(t.id)}>
            <div>
              {t.title ? <div className="t-title">{t.title}</div> : null}
              <div>{t.message}</div>
            </div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
