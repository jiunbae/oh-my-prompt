"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  isOffline: boolean;
  isInstallable: boolean;
  isInstalled: boolean;
  installPrompt: () => Promise<void>;
  swRegistration: ServiceWorkerRegistration | null;
}

export function usePwa(): PwaState {
  const [isOffline, setIsOffline] = useState(false);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const swRegistration: ServiceWorkerRegistration | null = null;
  const deferredPromptRef =
    useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setIsOffline(!navigator.onLine);
      setIsInstalled(
        window.matchMedia("(display-mode: standalone)").matches ||
          ((window.navigator as unknown as { standalone?: boolean }).standalone === true),
      );
    });

    // Online/offline listeners
    const handleOnline = () => {
      setIsOffline(false);
    };
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Listen for display mode changes (install completion)
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleDisplayChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsInstalled(e.matches);
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleDisplayChange);
    } else {
      // Safari fallback
      mediaQuery.addListener(handleDisplayChange as EventListener);
    }

    // Listen for beforeinstallprompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setIsInstallable(true);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // Listen for appinstalled
    const handleAppInstalled = () => {
      setIsInstallable(false);
      setIsInstalled(true);
      deferredPromptRef.current = null;
    };
    window.addEventListener("appinstalled", handleAppInstalled);

    // Listen for SW messages
    const handleSwMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === "offline-status") {
        setIsOffline(e.data.data?.isOffline ?? false);
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSwMessage);

    return () => {
      active = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
      navigator.serviceWorker?.removeEventListener("message", handleSwMessage);
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", handleDisplayChange);
      } else {
        mediaQuery.removeListener(handleDisplayChange as EventListener);
      }
    };
  }, []);

  const installPrompt = useCallback(async () => {
    const deferredPrompt = deferredPromptRef.current;
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    setIsInstallable(false);
    deferredPromptRef.current = null;
  }, []);

  return {
    isOffline,
    isInstallable,
    isInstalled,
    installPrompt,
    swRegistration,
  };
}
