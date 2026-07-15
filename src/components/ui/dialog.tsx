"use client";

import {
  useEffect,
  useId,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

// Shares the generated title id so DialogTitle can wire up aria-labelledby.
const DialogTitleIdContext = createContext<string | undefined>(undefined);

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Dialog({ open, onClose, children, className }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    // Remember what had focus so we can restore it when the dialog closes.
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialogNode = dialogRef.current;

    // Move focus into the dialog (first focusable, else the dialog container).
    const focusables = dialogNode?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    if (focusables && focusables.length > 0) {
      focusables[0].focus();
    } else {
      dialogNode?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Trap Tab focus within the dialog.
      if (e.key === "Tab" && dialogNode) {
        const items = dialogNode.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (items.length === 0) {
          e.preventDefault();
          dialogNode.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !dialogNode.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      // Restore focus to whatever triggered the dialog.
      previouslyFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Content */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative z-50 w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-card p-6 shadow-lg",
          className
        )}
      >
        <DialogTitleIdContext.Provider value={titleId}>
          {children}
        </DialogTitleIdContext.Provider>
      </div>
    </div>
  );
}

export function DialogTitle({ children, className }: { children: ReactNode; className?: string }) {
  const titleId = useContext(DialogTitleIdContext);
  return (
    <h2 id={titleId} className={cn("text-lg font-semibold text-foreground", className)}>
      {children}
    </h2>
  );
}

export function DialogDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-2 text-sm text-muted-foreground", className)}>{children}</p>;
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end", className)}>
      {children}
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant={variant === "destructive" ? "destructive" : "default"}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? "..." : confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
