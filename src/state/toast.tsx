import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export interface ToastAction {
  label: string;
  run: () => void;
}

interface Toast {
  id: number;
  message: ReactNode;
  tone: 'success' | 'error' | 'info';
  action?: ToastAction;
  timeout: number;
}

interface ToastApi {
  show: (
    message: ReactNode,
    opts?: { tone?: Toast['tone']; action?: ToastAction; timeout?: number },
  ) => void;
  success: (message: ReactNode, action?: ToastAction) => void;
  error: (message: ReactNode) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback<ToastApi['show']>(
    (message, opts = {}) => {
      const id = nextId++;
      const timeout = opts.timeout ?? (opts.action ? 9000 : opts.tone === 'error' ? 8000 : 4000);
      setToasts((t) => [
        ...t.slice(-3),
        { id, message, tone: opts.tone ?? 'info', action: opts.action, timeout },
      ]);
      window.setTimeout(() => dismiss(id), timeout);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, action) => show(message, { tone: 'success', action }),
      error: (message) => show(message, { tone: 'error' }),
    }),
    [show],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.tone === 'success' ? (
              <CheckCircle2 size={18} aria-hidden />
            ) : t.tone === 'error' ? (
              <AlertTriangle size={18} aria-hidden />
            ) : (
              <Info size={18} aria-hidden />
            )}
            <div className="toast-body">{t.message}</div>
            {t.action && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
