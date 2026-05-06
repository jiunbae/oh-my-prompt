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
  syncComplete: boolean;
}

export function usePwa(): PwaState {
  const [isOffline, setIsOffline] = useState(false);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [swRegistration, setSwRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [syncComplete, setSyncComplete] = useState(false);
  const deferredPromptRef =
    useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Check initial online status
    setIsOffline(!navigator.onLine);

    // Check if already installed (standalone display mode)
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari
      ((window.navigator as unknown as { standalone?: boolean }).standalone ===
        true);
    setIsInstalled(isStandalone);

    // Online/offline listeners
    const handleOnline = () => {
      setIsOffline(false);
      // Trigger background sync if available
      if (swRegistration && "sync" in swRegistration) {
        (swRegistration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register("omp-sync").catch(() => {});
      }
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
      if (e.data && e.data.type === "sync-complete") {
        setSyncComplete(true);
        setTimeout(() => setSyncComplete(false), 3000);
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleSwMessage);

    return () => {
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
  }, [swRegistration]);

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
    syncComplete,
  };
}
