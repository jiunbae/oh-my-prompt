"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ShortcutsHelp } from "@/components/shortcuts-help";

/** How long (ms) to wait for the second key of a `g`-prefix chord. */
const CHORD_TIMEOUT = 1000;

/**
 * Returns `true` when the event target is an element that should capture
 * keystrokes instead of the global shortcut handler (inputs, textareas,
 * selects, contenteditable elements, or anything inside a combobox).
 */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  // Radix / cmdk combobox patterns
  if (el.getAttribute("role") === "combobox") return true;
  if (el.closest('[role="combobox"]')) return true;
  return false;
}

export function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [helpOpen, setHelpOpen] = useState(false);

  // Refs for the `g`-prefix chord state machine.
  const pendingG = useRef(false);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Clear any pending `g` chord without firing. */
  const clearChord = useCallback(() => {
    pendingG.current = false;
    if (chordTimer.current !== null) {
      clearTimeout(chordTimer.current);
      chordTimer.current = null;
    }
  }, []);

  /** Navigate to `path`, clearing chord state first. */
  const go = useCallback(
    (path: string) => {
      clearChord();
      router.push(path);
    },
    [router, clearChord],
  );

  /** Focus the search input if present on the current page. */
  const focusSearch = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    if (input) {
      input.focus();
      input.select();
      return true;
    }
    return false;
  }, []);

  /** Escape handler: close help, blur active element. */
  const handleEscape = useCallback(() => {
    if (helpOpen) {
      setHelpOpen(false);
      return;
    }
    // Blur the currently focused element (closes popovers, deselects, etc.)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [helpOpen]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Never intercept when modifier keys are held (browser shortcuts).
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const typing = isTypingTarget(e.target);

      // --- Escape always works, even while typing ---
      if (e.key === "Escape") {
        e.preventDefault();
        handleEscape();
        return;
      }

      // --- Everything else is skipped while typing ---
      if (typing) return;

      // --- Help toggle (works globally, even without `g` prefix) ---
      if (e.key === "?" && !pendingG.current) {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }

      // --- `g` prefix chord: first key ---
      if (e.key === "g" && !pendingG.current) {
        e.preventDefault();
        pendingG.current = true;
        chordTimer.current = setTimeout(() => {
          pendingG.current = false;
          chordTimer.current = null;
        }, CHORD_TIMEOUT);
        return;
      }

      // --- `g` prefix chord: second key ---
      if (pendingG.current) {
        e.preventDefault();
        switch (e.key) {
          case "d":
            go("/dashboard");
            return;
          case "s":
            go("/sessions");
            return;
          case "/":
            go("/search");
            return;
          case "a":
            go("/analytics");
            return;
          case "i":
            go("/insights");
            return;
          case "t":
            go("/templates");
            return;
          case "x":
            go("/settings");
            return;
          default:
            // Unrecognised second key -- cancel the chord silently.
            clearChord();
            return;
        }
      }

      // --- Single-key shortcuts (no `g` prefix needed) ---

      // `/` — Focus search input (or navigate to search page).
      if (e.key === "/") {
        // If we're already on the search page, just focus the input.
        if (pathname.startsWith("/search")) {
          if (focusSearch()) {
            e.preventDefault();
          }
        } else {
          e.preventDefault();
          router.push("/search");
        }
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearChord();
    };
  }, [
    pathname,
    router,
    go,
    clearChord,
    focusSearch,
    handleEscape,
    helpOpen,
  ]);

  return <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />;
}