"use client";

import { Dialog, DialogTitle } from "@/components/ui/dialog";

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string; description: string }[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: "g d", description: "Go to Dashboard" },
      { keys: "g s", description: "Go to Sessions" },
      { keys: "g /", description: "Go to Search" },
      { keys: "g a", description: "Go to Analytics" },
      { keys: "g i", description: "Go to AI Insights" },
      { keys: "g t", description: "Go to Templates" },
      { keys: "g x", description: "Go to Settings" },
    ],
  },
  {
    title: "Actions",
    shortcuts: [
      { keys: "/", description: "Focus search input" },
      { keys: "Escape", description: "Close modal / blur input" },
      { keys: "?", description: "Toggle this help overlay" },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded border border-border bg-surface text-xs font-mono font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsHelp({ open, onClose }: ShortcutsHelpProps) {
  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <div className="flex items-center justify-between mb-4">
        <DialogTitle>Keyboard Shortcuts</DialogTitle>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-5">
        {shortcutGroups.map((group) => (
          <div key={group.title}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
              {group.title}
            </h3>
            <div className="divide-y divide-border">
              {group.shortcuts.map((shortcut) => (
                <div
                  key={shortcut.keys}
                  className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                >
                  <span className="text-sm text-foreground">
                    {shortcut.description}
                  </span>
                  <div className="flex items-center gap-1">
                    {shortcut.keys.split(" ").map((key, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && (
                          <span className="text-xs text-muted-foreground/50">
                            then
                          </span>
                        )}
                        <Kbd>{key}</Kbd>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-5 pt-4 border-t border-border text-xs text-muted-foreground/60">
        Shortcuts are disabled when typing in text fields.
      </p>
    </Dialog>
  );
}