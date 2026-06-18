import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';

type ToastLevel = 'success' | 'warning' | 'error';

type Toast = {
  id: number;
  level: ToastLevel;
  message: string;
  exiting?: boolean;
};

type ToastContextType = {
  toast: (level: ToastLevel, message: string) => void;
};

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const PALETTE: Record<ToastLevel, { bg: string; border: string; color: string; icon: React.ComponentType<{ style?: React.CSSProperties }> }> = {
  success: { bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.24)', color: '#4ade80', icon: CheckCircle2 },
  warning: { bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.24)', color: '#fb923c', icon: AlertTriangle },
  error:   { bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.24)', color: '#f87171', icon: XCircle },
};

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
  }, []);

  const toast = useCallback((level: ToastLevel, message: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev.slice(-4), { id, level, message }]);
    setTimeout(() => dismissToast(id), 4000);
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        pointerEvents: 'none',
      }}>
        {toasts.map((t) => {
          const p = PALETTE[t.level];
          const Icon = p.icon;
          return (
            <div
              key={t.id}
              style={{
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 18px',
                borderRadius: 18,
                background: p.bg,
                border: `1px solid ${p.border}`,
                backdropFilter: 'blur(20px)',
                boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
                minWidth: 280,
                maxWidth: 420,
                animation: t.exiting ? 'toastOut 0.3s ease forwards' : 'toastIn 0.3s ease',
              }}
            >
              <Icon style={{ width: 18, height: 18, color: p.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--foreground)', lineHeight: 1.4 }}>{t.message}</span>
              <button
                onClick={() => dismissToast(t.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4, display: 'flex', flexShrink: 0 }}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
