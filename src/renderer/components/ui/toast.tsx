import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';

export interface ToastMessage {
  id: number;
  message: ReactNode;
}

export function useToastQueue(limit = 8) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);

  const notify = useCallback(
    (message: ReactNode) => {
      nextId.current += 1;
      const next = { id: nextId.current, message };
      setMessages((current) => [...current, next].slice(-limit));
    },
    [limit],
  );

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  return { messages, notify, dismiss };
}

interface ToastProps {
  toast: ToastMessage;
  closeLabel: string;
  duration?: number;
  onDismiss(id: number): void;
}

function Toast({ toast, closeLabel, duration = 5000, onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDismiss, toast.id]);

  return (
    <li
      data-slot="toast"
      role="status"
      aria-atomic="true"
      className="pointer-events-none flex min-w-72 max-w-[min(28rem,calc(100vw-2rem))] items-center gap-3 rounded-lg border bg-overlay px-3 py-2 text-sm text-foreground shadow-overlay"
    >
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="pointer-events-auto -mr-1 size-7"
        aria-label={closeLabel}
        onClick={() => onDismiss(toast.id)}
      >
        <XIcon className="size-3.5" />
      </Button>
    </li>
  );
}

interface ToastViewportProps {
  messages: ToastMessage[];
  label: string;
  closeLabel: string;
  className?: string;
  duration?: number;
  onDismiss(id: number): void;
}

export function ToastViewport({ messages, label, closeLabel, className, duration, onDismiss }: ToastViewportProps) {
  const viewport = (
    <ol
      data-slot="toast-viewport"
      aria-label={label}
      aria-live="polite"
      aria-relevant="additions text"
      className={cn(
        'pointer-events-none fixed top-28 right-4 z-[60] flex max-h-[calc(100vh-8rem)] flex-col items-end gap-2',
        className,
      )}
    >
      {messages[0] && <Toast toast={messages[0]} closeLabel={closeLabel} duration={duration} onDismiss={onDismiss} />}
    </ol>
  );
  return typeof document === 'undefined' ? viewport : createPortal(viewport, document.body);
}
