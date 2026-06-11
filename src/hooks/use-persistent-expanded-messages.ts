"use client";

import { useCallback, useEffect, useState } from "react";
import {
  parseStoredExpandedMessageIds,
  serializeExpandedMessageIds,
} from "@/lib/session-ui";

export function usePersistentExpandedMessages(storageKey: string | null) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;

      if (!storageKey) {
        setExpandedIds(new Set());
        return;
      }

      try {
        setExpandedIds(parseStoredExpandedMessageIds(window.localStorage.getItem(storageKey)));
      } catch {
        setExpandedIds(new Set());
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [storageKey]);

  const updateExpandedIds = useCallback(
    (updater: (previous: Set<string>) => Set<string>) => {
      setExpandedIds((previous) => {
        const next = updater(new Set(previous));
        if (storageKey) {
          try {
            window.localStorage.setItem(storageKey, serializeExpandedMessageIds(next));
          } catch {
            // Local storage can be unavailable in private or restricted contexts.
          }
        }
        return next;
      });
    },
    [storageKey],
  );

  const setMessageExpanded = useCallback(
    (id: string, expanded: boolean) => {
      updateExpandedIds((previous) => {
        if (expanded) {
          previous.add(id);
        } else {
          previous.delete(id);
        }
        return previous;
      });
    },
    [updateExpandedIds],
  );

  const expandMessages = useCallback(
    (ids: string[]) => {
      updateExpandedIds((previous) => {
        ids.forEach((id) => previous.add(id));
        return previous;
      });
    },
    [updateExpandedIds],
  );

  const collapseMessages = useCallback(
    (ids?: string[]) => {
      updateExpandedIds((previous) => {
        if (!ids) return new Set();
        ids.forEach((id) => previous.delete(id));
        return previous;
      });
    },
    [updateExpandedIds],
  );

  return {
    expandedIds,
    setMessageExpanded,
    expandMessages,
    collapseMessages,
  };
}
