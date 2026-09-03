"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/cn";
import { ExplorerLink } from "./primitives";

type ToastTone = "neutral" | "verified" | "danger";

interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  txHash?: string;
}

interface ToastContextValue {
  notify: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  neutral: "border-[var(--color-hairline-strong)]",
  verified: "border-[rgba(94,224,138,0.28)]",
  danger: "border-[rgba(255,107,107,0.3)]",
};

const TONE_MARKER: Record<ToastTone, string> = {
  neutral: "bg-[var(--color-accent)]",
  verified: "bg-[var(--color-verified)]",
  danger: "bg-[var(--color-danger)]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);

      // Errors stay until dismissed: a failure a saver missed is worse than a lingering card.
      if (toast.tone !== "danger") {
        window.setTimeout(() => dismiss(id), 6500);
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end sm:p-6"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "pointer-events-auto relative w-full max-w-[380px] overflow-hidden",
                "rounded-[var(--radius-md)] border bg-[var(--color-overlay)] p-4 pl-5",
                "shadow-[0_20px_50px_-20px_rgba(0,0,0,0.95)]",
                TONE_STYLES[toast.tone],
              )}
              role={toast.tone === "danger" ? "alert" : "status"}
            >
              <span
                aria-hidden="true"
                className={cn("absolute inset-y-0 left-0 w-[2px]", TONE_MARKER[toast.tone])}
              />

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[var(--color-primary)]">{toast.title}</p>
                  {toast.description ? (
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-secondary)]">
                      {toast.description}
                    </p>
                  ) : null}
                  {toast.txHash ? (
                    <ExplorerLink hash={toast.txHash} label="View on explorer" className="mt-2" />
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss notification"
                  className="-m-1 shrink-0 rounded p-1 text-[var(--color-quaternary)] transition-colors hover:text-[var(--color-primary)]"
                >
                  <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.4">
                    <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside a ToastProvider.");
  return context;
}
